import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';

// Load config from JSON
const ENV = (process.env.ENV as string) || 'qa';
const configPath = path.join(__dirname, '../config/environments.json');
const environments = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const environmentConfig = environments[ENV];

if (!environmentConfig) {
  throw new Error(`Environment "${ENV}" not found in environments.json`);
}

const config = {
  env: ENV,
  browser: (process.env.BROWSER as string) || 'chromium',
  headless: process.env.HEADLESS !== 'false',
  screenshotOnFail: process.env.SCREENSHOT_ON_FAIL !== 'false',
  video: (process.env.VIDEO as 'on' | 'off' | 'retain-on-failure') || 'retain-on-failure',
  ...environmentConfig,
};

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  body?: unknown;
  formData?: Record<string, string>;
  timeout?: number;
}

export interface ApiResponseContext {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  responseTime: number;
}

/**
 * ApiEngine
 * ────────────────────────────────────────────────────────────────────────────
 * Wraps Axios to provide a clean, BDD-aware HTTP client with:
 *  - Request/Response logging
 *  - Runtime variable substitution (DataStore)
 *  - Auto JSON & form-data handling
 *  - Response storage for chained assertions
 */
export class ApiEngine {
  private client: AxiosInstance;
  private lastResponse: ApiResponseContext | null = null;

  constructor(baseUrl?: string) {
    const resolvedBase = baseUrl || config.apiBaseUrl;
    Logger.info(`ApiEngine initialized with base URL: ${resolvedBase}`);

    this.client = axios.create({
      baseURL: resolvedBase,
      timeout: config.apiTimeout,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.setupInterceptors();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Interceptors
  // ───────────────────────────────────────────────────────────────────────────

  private setupInterceptors(): void {
    this.client.interceptors.request.use((reqConfig: InternalAxiosRequestConfig) => {
      Logger.info(`→ ${reqConfig.method?.toUpperCase()} ${reqConfig.baseURL}${reqConfig.url}`);
      if (reqConfig.data) {
        Logger.debug(`  Request Body: ${JSON.stringify(reqConfig.data)}`);
      }
      if (reqConfig.params) {
        Logger.debug(`  Query Params: ${JSON.stringify(reqConfig.params)}`);
      }
      return reqConfig;
    });

    this.client.interceptors.response.use(
      (response) => {
        Logger.info(`← ${response.status} ${response.statusText}`);
        Logger.debug(`  Response Body: ${JSON.stringify(response.data)}`);
        return response;
      },
      (error) => {
        if (error.response) {
          Logger.warn(`← ${error.response.status} ${error.response.statusText}`);
          Logger.debug(`  Error Body: ${JSON.stringify(error.response.data)}`);
          return Promise.resolve(error.response); // Don't throw; let assertions handle it
        }
        Logger.error(`API Error: ${error.message}`);
        throw error;
      }
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Variable Substitution
  // ───────────────────────────────────────────────────────────────────────────

  private resolveString(value: string): string {
    return value.replace(/\{(\w+)\}/g, (_, key) => {
      const stored = DataStore.get(key);
      return stored !== undefined ? String(stored) : `{${key}}`;
    });
  }

  private resolveObject(obj: unknown): unknown {
    if (typeof obj === 'string') return this.resolveString(obj);
    if (Array.isArray(obj)) return obj.map((item) => this.resolveObject(item));
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.resolveObject(v);
      }
      return result;
    }
    return obj;
  }

  private buildConfig(options?: ApiRequestOptions): AxiosRequestConfig {
    const axiosConfig: AxiosRequestConfig = {};

    if (options?.headers) {
      axiosConfig.headers = options.headers;
    }

    if (options?.queryParams) {
      axiosConfig.params = options.queryParams;
    }

    if (options?.timeout) {
      axiosConfig.timeout = options.timeout;
    }

    return axiosConfig;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HTTP Methods
  // ───────────────────────────────────────────────────────────────────────────

  public async get(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponseContext> {
    const url = this.resolveString(endpoint);
    const start = Date.now();
    const response = await this.client.get(url, this.buildConfig(options));
    return this.storeResponse(response, start);
  }

  public async post(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponseContext> {
    const url = this.resolveString(endpoint);
    const body = options?.body ? this.resolveObject(options.body) : undefined;
    const start = Date.now();
    const response = await this.client.post(url, body, this.buildConfig(options));
    return this.storeResponse(response, start);
  }

  public async put(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponseContext> {
    const url = this.resolveString(endpoint);
    const body = options?.body ? this.resolveObject(options.body) : undefined;
    const start = Date.now();
    const response = await this.client.put(url, body, this.buildConfig(options));
    return this.storeResponse(response, start);
  }

  public async patch(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponseContext> {
    const url = this.resolveString(endpoint);
    const body = options?.body ? this.resolveObject(options.body) : undefined;
    const start = Date.now();
    const response = await this.client.patch(url, body, this.buildConfig(options));
    return this.storeResponse(response, start);
  }

  public async delete(endpoint: string, options?: ApiRequestOptions): Promise<ApiResponseContext> {
    const url = this.resolveString(endpoint);
    const start = Date.now();
    const response = await this.client.delete(url, this.buildConfig(options));
    return this.storeResponse(response, start);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Response Management
  // ───────────────────────────────────────────────────────────────────────────

  private storeResponse(response: AxiosResponse, startTime: number): ApiResponseContext {
    const ctx: ApiResponseContext = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
      body: response.data,
      responseTime: Date.now() - startTime,
    };
    this.lastResponse = ctx;
    DataStore.set('__lastApiResponse', ctx);
    Logger.info(`Response time: ${ctx.responseTime}ms`);
    return ctx;
  }

  public getLastResponse(): ApiResponseContext {
    if (!this.lastResponse) {
      throw new Error('No API response stored. Make sure a request was made first.');
    }
    return this.lastResponse;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Authentication Helpers
  // ───────────────────────────────────────────────────────────────────────────

  public setAuthToken(token: string): void {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    Logger.info('Bearer token set on API client');
  }

  public setApiKey(key: string, headerName: string = 'x-api-key'): void {
    this.client.defaults.headers.common[headerName] = key;
    Logger.info(`API key set on header: ${headerName}`);
  }

  public clearAuth(): void {
    delete this.client.defaults.headers.common['Authorization'];
    Logger.info('Authorization header removed');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // JSON Body Builder (for feature file table-driven requests)
  // ───────────────────────────────────────────────────────────────────────────

  public static tableToObject(table: { rawTable: string[][] }): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const [headers, ...rows] = table.rawTable;
    if (headers[0].toLowerCase() === 'key' && headers[1].toLowerCase() === 'value') {
      for (const row of rows) {
        const key = row[0];
        const rawValue = row[1];
        // Try to parse booleans and numbers
        let value: unknown = rawValue;
        if (rawValue === 'true') value = true;
        else if (rawValue === 'false') value = false;
        else if (!isNaN(Number(rawValue)) && rawValue !== '') value = Number(rawValue);
        result[key] = value;
      }
    }
    return result;
  }
}
