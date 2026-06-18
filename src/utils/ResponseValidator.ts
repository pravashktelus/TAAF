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

  // Asserts the response status code matches exactly
  // Usage: validator.assertStatus(200)
  assertStatus(expectedStatus: number): void {
    Logger.info(`Asserting response status: ${expectedStatus}`);
    if (this.response.status !== expectedStatus) {
      throw new Error(
        `Expected status ${expectedStatus} but got ${this.response.status}.\n` +
          `Response body: ${JSON.stringify(this.response.body, null, 2)}`
      );
    }
  }

  // Asserts the response status code falls within a range (inclusive)
  // Usage: validator.assertStatusRange(200, 299)
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

  // Asserts a response header has the expected value
  // Usage: validator.assertHeader("content-type", "application/json")
  assertHeader(headerName: string, expectedValue: string): void {
    Logger.info(`Asserting header "${headerName}": "${expectedValue}"`);
    const actual = this.response.headers[headerName.toLowerCase()];
    if (!actual?.includes(expectedValue)) {
      throw new Error(
        `Header "${headerName}" expected "${expectedValue}" but got "${actual}"`
      );
    }
  }

  // Asserts a response header exists (regardless of value)
  // Usage: validator.assertHeaderExists("x-request-id")
  assertHeaderExists(headerName: string): void {
    if (!(headerName.toLowerCase() in this.response.headers)) {
      throw new Error(`Expected header "${headerName}" to be present in response`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Body
  // ───────────────────────────────────────────────────────────────────────────

  // Gets a nested field value from response body using dot notation
  // Usage: validator.getField("data.user.email")
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

  // Asserts a body field equals the expected value (supports dot notation)
  // Usage: validator.assertField("data.name", "John")
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

  // Asserts a body field contains a substring
  // Usage: validator.assertFieldContains("data.message", "success")
  assertFieldContains(fieldPath: string, expectedSubstring: string): void {
    Logger.info(`Asserting body field "${fieldPath}" contains "${expectedSubstring}"`);
    const actual = String(this.getField(fieldPath));
    if (!actual.includes(expectedSubstring)) {
      throw new Error(
        `Field "${fieldPath}": expected to contain "${expectedSubstring}" but got "${actual}"`
      );
    }
  }

  // Asserts a body field exists (not null/undefined)
  // Usage: validator.assertFieldExists("data.id")
  assertFieldExists(fieldPath: string): void {
    Logger.info(`Asserting body field "${fieldPath}" exists`);
    const value = this.getField(fieldPath);
    if (value === undefined || value === null) {
      throw new Error(`Field "${fieldPath}" is null or undefined`);
    }
  }

  // Asserts a body field is not empty (not null, undefined, or "")
  // Usage: validator.assertFieldNotEmpty("data.token")
  assertFieldNotEmpty(fieldPath: string): void {
    Logger.info(`Asserting body field "${fieldPath}" is not empty`);
    const value = this.getField(fieldPath);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Field "${fieldPath}" is empty or undefined`);
    }
  }

  // Asserts an array field has a specific length
  // Usage: validator.assertArrayLength("data.items", 5)
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

  // Asserts an array field is not empty
  // Usage: validator.assertArrayNotEmpty("data.results")
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

  // Asserts the API response time is below a threshold in milliseconds
  // Usage: validator.assertResponseTimeLessThan(3000)
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
