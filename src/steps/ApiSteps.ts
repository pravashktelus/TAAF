import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { ApiEngine } from '../core/ApiEngine';
import { ResponseValidator } from '../utils/ResponseValidator';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';
import { PropertiesLoader } from '../utils/PropertiesLoader';

// =============================================================================
// API STEP DEFINITIONS
// =============================================================================
// These step definitions drive HTTP requests using ApiEngine.
//
// STEP SYNTAX GUIDE:
// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE REQUEST:
//   When I send a GET request to '/api/users/2'
//   When I send a POST request to '/api/users' with body:
//     | key      | value     |
//     | name     | John      |
//     | job      | Dev       |
//
// AUTH:
//   Given I set bearer token '{authToken}'
//   Given I set api key 'mykey' in header 'x-api-key'
//
// ASSERTIONS:
//   Then the response status should be 200
//   Then the response body field 'data.first_name' should equal 'Janet'
//   Then the response body field 'data' should be an array
//   Then the response time should be less than 2000ms
//
// CAPTURE:
//   And I store response field 'id' as 'userId'
//   Then I send a PUT request to '/api/users/{userId}'
// =============================================================================

// ─── Request Configuration ────────────────────────────────────────────────────

Given(
  /^I set (?:the )?base (?:url|URL) to ['"](.+)['"]$/,
  async function (this: CustomWorld, baseUrl: string) {
    // Resolve properties like {api.baseUrl}
    const resolvedUrl = baseUrl.replace(/\{([^}]+)\}/g, (_, key) => {
      return PropertiesLoader.get(key) || `{${key}}`;
    });
    this.apiEngine = new ApiEngine(resolvedUrl);
    Logger.info(`API base URL set to: ${resolvedUrl}`);
  }
);

Given(
  /^I set bearer token ['"](.+)['"]$/,
  async function (this: CustomWorld, token: string) {
    const resolvedToken = token.replace(/\{(\w+)\}/g, (_, k) => {
      const val = DataStore.get(k);
      return val !== undefined ? String(val) : process.env[k] || `{${k}}`;
    });
    this.apiEngine.setAuthToken(resolvedToken);
    Logger.info(`Bearer token set: ${resolvedToken.substring(0, 20)}...`);
  }
);

Given(
  /^I set api key ['"](.+)['"](?:(?: in| on) header ['"](.+)['"])?$/,
  async function (this: CustomWorld, key: string, headerName?: string) {
    const resolvedKey = key.replace(/\{(\w+)\}/g, (_, k) => {
      const val = DataStore.get(k);
      return val !== undefined ? String(val) : process.env[k] || `{${k}}`;
    });
    this.apiEngine.setApiKey(resolvedKey, headerName);
  }
);

Given(
  /^I clear (?:the )?auth(?:orization)?$/,
  async function (this: CustomWorld) {
    this.apiEngine.clearAuth();
  }
);

// ─── Simple Requests (no body) ────────────────────────────────────────────────

When(
  /^I send a (GET|DELETE|HEAD) request to ['"](.+)['"]$/,
  async function (this: CustomWorld, method: string, endpoint: string) {
    switch (method.toUpperCase()) {
      case 'GET':
        await this.apiEngine.get(endpoint);
        break;
      case 'DELETE':
        await this.apiEngine.delete(endpoint);
        break;
      default:
        await this.apiEngine.get(endpoint);
    }
  }
);

When(
  /^I send a GET request to ['"](.+)['"] with query params:$/,
  async function (this: CustomWorld, endpoint: string, dataTable: DataTable) {
    const params = dataTable.rowsHash() as Record<string, string>;
    await this.apiEngine.get(endpoint, { queryParams: params });
  }
);

// ─── Requests with Body (DataTable) ──────────────────────────────────────────

When(
  /^I send a (POST|PUT|PATCH) request to ['"](.+)['"] with body:$/,
  async function (this: CustomWorld, method: string, endpoint: string, dataTable: DataTable) {
    const body = ApiEngine.tableToObject({ rawTable: dataTable.raw() });

    switch (method.toUpperCase()) {
      case 'POST':
        await this.apiEngine.post(endpoint, { body });
        break;
      case 'PUT':
        await this.apiEngine.put(endpoint, { body });
        break;
      case 'PATCH':
        await this.apiEngine.patch(endpoint, { body });
        break;
    }
  }
);

// ─── Requests with inline JSON ────────────────────────────────────────────────

When(
  /^I send a (POST|PUT|PATCH) request to ['"](.+)['"] with JSON:$/,
  async function (this: CustomWorld, method: string, endpoint: string, jsonString: string) {
    let body: unknown;
    try {
      body = JSON.parse(jsonString);
    } catch {
      throw new Error(`Invalid JSON provided in step:\n${jsonString}`);
    }

    switch (method.toUpperCase()) {
      case 'POST':
        await this.apiEngine.post(endpoint, { body });
        break;
      case 'PUT':
        await this.apiEngine.put(endpoint, { body });
        break;
      case 'PATCH':
        await this.apiEngine.patch(endpoint, { body });
        break;
    }
  }
);

// ─── Response Status Assertions ───────────────────────────────────────────────

Then(
  /^the response status (?:code )?should be (\d+)$/,
  async function (this: CustomWorld, statusCode: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertStatus(parseInt(statusCode));
  }
);

Then(
  /^the response status should be in range (\d+) to (\d+)$/,
  async function (this: CustomWorld, min: string, max: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertStatusRange(parseInt(min), parseInt(max));
  }
);

// ─── Response Header Assertions ───────────────────────────────────────────────

Then(
  /^the response header ['"](.+)['"] should (?:be|equal|contain) ['"](.+)['"]$/,
  async function (this: CustomWorld, headerName: string, expectedValue: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertHeader(headerName, expectedValue);
  }
);

Then(
  /^the response should have header ['"](.+)['"]$/,
  async function (this: CustomWorld, headerName: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertHeaderExists(headerName);
  }
);

// ─── Response Body Assertions ─────────────────────────────────────────────────

Then(
  /^the response body field ['"](.+)['"] should (?:be|equal) ['"](.+)['"]$/,
  async function (this: CustomWorld, fieldPath: string, expectedValue: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertField(fieldPath, expectedValue);
  }
);

Then(
  /^the response body field ['"](.+)['"] should contain ['"](.+)['"]$/,
  async function (this: CustomWorld, fieldPath: string, expectedSubstring: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertFieldContains(fieldPath, expectedSubstring);
  }
);

Then(
  /^the response body field ['"](.+)['"] should exist$/,
  async function (this: CustomWorld, fieldPath: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertFieldExists(fieldPath);
  }
);

Then(
  /^the response body field ['"](.+)['"] should not be empty$/,
  async function (this: CustomWorld, fieldPath: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertFieldNotEmpty(fieldPath);
  }
);

Then(
  /^the response body field ['"](.+)['"] should (?:be an array with|have) (\d+) items?$/,
  async function (this: CustomWorld, fieldPath: string, count: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertArrayLength(fieldPath, parseInt(count));
  }
);

Then(
  /^the response body field ['"](.+)['"] should (?:be a non-empty array|not be empty array)$/,
  async function (this: CustomWorld, fieldPath: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertArrayNotEmpty(fieldPath);
  }
);

// ─── Response Time ────────────────────────────────────────────────────────────

Then(
  /^the response time should be less than (\d+)\s?ms$/,
  async function (this: CustomWorld, maxMs: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    validator.assertResponseTimeLessThan(parseInt(maxMs));
  }
);

// ─── Capture / Chain Responses ────────────────────────────────────────────────

Then(
  /^I store (?:the )?response (?:body )?field ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, fieldPath: string, variableName: string) {
    const validator = new ResponseValidator(this.apiEngine.getLastResponse());
    const value = validator.getField(fieldPath);
    DataStore.set(variableName, value);
    Logger.info(`Stored response field "${fieldPath}" as variable "${variableName}": ${value}`);
  }
);

Then(
  /^I store (?:the )?response status as ['"](.+)['"]$/,
  async function (this: CustomWorld, variableName: string) {
    const status = this.apiEngine.getLastResponse().status;
    DataStore.set(variableName, status);
    Logger.info(`Stored response status ${status} as variable "${variableName}"`);
  }
);

// ─── Print response for debugging ─────────────────────────────────────────────

Then(
  /^I (?:print|log|debug) (?:the )?response$/,
  async function (this: CustomWorld) {
    const response = this.apiEngine.getLastResponse();
    const output = JSON.stringify(
      { status: response.status, body: response.body },
      null,
      2
    );
    Logger.info(`Response:\n${output}`);
    await this.attach(output, 'text/plain');
  }
);
