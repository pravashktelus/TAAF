import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Loads framework configuration from src/config/framework.properties.
export class FrameworkConfig {
  private static instance: FrameworkConfig;
  private properties: Record<string, string> = {};

  public readonly env: string;
  public readonly browser: 'chromium' | 'firefox' | 'webkit';
  public readonly headless: boolean;
  public readonly defaultTimeout: number;
  public readonly navigationTimeout: number;
  public readonly apiTimeout: number;
  public readonly retryCount: number;
  public readonly screenshotOnFail: boolean;
  public readonly video: 'on' | 'off' | 'retain-on-failure';

  public readonly selfHealing: {
    enabled: boolean;
    locatorTimeout: number;
    maxCandidates: number;
    useOpenAI: boolean;
    attachReport: boolean;
  };

  public readonly testUser: {
    password: string;
    name: string;
    emailDomain: string;
  };

  private constructor() {
    this.loadProperties();

    this.env = this.get('env', 'qa');
    this.browser = this.get('browser', 'chromium') as any;
    this.headless = this.getBool('headless', false);
    this.defaultTimeout = this.getNumber('defaultTimeout', 30000);
    this.navigationTimeout = this.getNumber('navigationTimeout', 60000);
    this.apiTimeout = this.getNumber('apiTimeout', 15000);
    this.retryCount = this.getNumber('retryCount', 2);
    this.screenshotOnFail = this.getBool('screenshotOnFail', true);
    this.video = this.get('video', 'retain-on-failure') as any;

    this.selfHealing = {
      enabled: this.getBool('selfHealing.enabled', true),
      locatorTimeout: this.getNumber('selfHealing.locatorTimeout', 5000),
      maxCandidates: this.getNumber('selfHealing.maxCandidates', 10),
      useOpenAI: this.getBool('selfHealing.useOpenAI', true),
      attachReport: this.getBool('selfHealing.attachReport', true),
    };

    this.testUser = {
      password: this.get('test.user.password', 'TestUser@123'),
      name: this.get('test.user.name', 'Test User'),
      emailDomain: this.get('test.user.emailDomain', 'teleconnect.local'),
    };
  }

  public static getInstance(): FrameworkConfig {
    if (!this.instance) {
      this.instance = new FrameworkConfig();
    }
    return this.instance;
  }

  public static reload(): FrameworkConfig {
    this.instance = new FrameworkConfig();
    return this.instance;
  }

  private loadProperties(): void {
    const filePath = path.resolve(__dirname, 'framework.properties');
    if (!fs.existsSync(filePath)) {
      console.warn(`[FrameworkConfig] Properties file not found: ${filePath}. Using defaults.`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      if (key) {
        this.properties[key] = value;
      }
    }
  }

  public get(key: string, defaultValue: string): string {
    const envKey = key.replace(/\./g, '_').toUpperCase();
    return process.env[envKey] || this.properties[key] || defaultValue;
  }

  private getBool(key: string, defaultValue: boolean): boolean {
    const value = this.get(key, String(defaultValue));
    return value === 'true' || value === '1' || value === 'yes';
  }

  private getNumber(key: string, defaultValue: number): number {
    const value = this.get(key, String(defaultValue));
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
}
