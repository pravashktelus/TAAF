import { ApiResponseContext } from '../core/ApiEngine';
import { Logger } from './Logger';

/**
 * ResponseValidator
 * ────────────────────────────────────────────────────────────────────────────
 * Provides rich assertion helpers for API responses.
 * Used by ApiSteps to validate response status, headers, body fields, etc.
 */
export class ResponseValidator {
  private response: ApiResponseContext;

  constructor(response: ApiResponseContext) {
    this.response = response;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Status
  // ───────────────────────────────────────────────────────────────────────────

  assertStatus(expectedStatus: number): void {
    Logger.info(`Asserting response status: ${expectedStatus}`);
    if (this.response.status !== expectedStatus) {
      throw new Error(
        `Expected status ${expectedStatus} but got ${this.response.status}.\n` +
          `Response body: ${JSON.stringify(this.response.body, null, 2)}`
      );
    }
  }

  assertStatusRange(min: number, max: number): void {
    Logger.info(`Asserting response status in range: ${min}-${max}`);
    if (this.response.status < min || this.response.status > max) {
      throw new Error(
        `Expected status between ${min}-${max} but got ${this.response.status}`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Headers
  // ───────────────────────────────────────────────────────────────────────────

  assertHeader(headerName: string, expectedValue: string): void {
    Logger.info(`Asserting header "${headerName}": "${expectedValue}"`);
    const actual = this.response.headers[headerName.toLowerCase()];
    if (!actual?.includes(expectedValue)) {
      throw new Error(
        `Header "${headerName}" expected "${expectedValue}" but got "${actual}"`
      );
    }
  }

  assertHeaderExists(headerName: string): void {
    if (!(headerName.toLowerCase() in this.response.headers)) {
      throw new Error(`Expected header "${headerName}" to be present in response`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Body
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get a nested field value using dot notation: "data.first_name"
   */
  getField(fieldPath: string): unknown {
    const parts = fieldPath.split('.');
    let current: unknown = this.response.body;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        throw new Error(
          `Cannot access field "${fieldPath}" — path "${part}" is not traversable.\n` +
            `Body: ${JSON.stringify(this.response.body, null, 2)}`
        );
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  assertField(fieldPath: string, expectedValue: unknown): void {
    Logger.info(`Asserting body field "${fieldPath}" equals "${expectedValue}"`);
    const actual = this.getField(fieldPath);
    const expected =
      typeof expectedValue === 'string'
        ? this.tryCoerce(expectedValue)
        : expectedValue;

    if (actual !== expected) {
      throw new Error(
        `Field "${fieldPath}": expected "${expected}" but got "${actual}"`
      );
    }
  }

  assertFieldContains(fieldPath: string, expectedSubstring: string): void {
    Logger.info(`Asserting body field "${fieldPath}" contains "${expectedSubstring}"`);
    const actual = String(this.getField(fieldPath));
    if (!actual.includes(expectedSubstring)) {
      throw new Error(
        `Field "${fieldPath}": expected to contain "${expectedSubstring}" but got "${actual}"`
      );
    }
  }

  assertFieldExists(fieldPath: string): void {
    Logger.info(`Asserting body field "${fieldPath}" exists`);
    const value = this.getField(fieldPath);
    if (value === undefined || value === null) {
      throw new Error(`Field "${fieldPath}" is null or undefined`);
    }
  }

  assertFieldNotEmpty(fieldPath: string): void {
    Logger.info(`Asserting body field "${fieldPath}" is not empty`);
    const value = this.getField(fieldPath);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Field "${fieldPath}" is empty or undefined`);
    }
  }

  assertArrayLength(fieldPath: string, expectedLength: number): void {
    Logger.info(`Asserting array at "${fieldPath}" has length ${expectedLength}`);
    const arr = this.getField(fieldPath);
    if (!Array.isArray(arr)) {
      throw new Error(`Field "${fieldPath}" is not an array`);
    }
    if (arr.length !== expectedLength) {
      throw new Error(
        `Array "${fieldPath}" expected length ${expectedLength} but got ${arr.length}`
      );
    }
  }

  assertArrayNotEmpty(fieldPath: string): void {
    Logger.info(`Asserting array at "${fieldPath}" is not empty`);
    const arr = this.getField(fieldPath);
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`Array "${fieldPath}" is empty or not an array`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Response Time
  // ───────────────────────────────────────────────────────────────────────────

  assertResponseTimeLessThan(maxMs: number): void {
    Logger.info(`Asserting response time < ${maxMs}ms (actual: ${this.response.responseTime}ms)`);
    if (this.response.responseTime >= maxMs) {
      throw new Error(
        `Response time ${this.response.responseTime}ms exceeds threshold ${maxMs}ms`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private tryCoerce(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (!isNaN(Number(value)) && value !== '') return Number(value);
    return value;
  }
}
