import { Given, When, Then } from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { TestDataLoader } from '../utils/TestDataLoader';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';

// =============================================================================
// COMMON STEPS
// =============================================================================
// Shared steps usable in both @web and @api scenarios.
// Covers: test data loading, variable management, logging, and assertions
// on DataStore values.
// =============================================================================

// ─── Test Data ────────────────────────────────────────────────────────────────

Given(
  /^I load test data ['"](.+)['"]$/,
  async function (this: CustomWorld, datasetName: string) {
    const data = TestDataLoader.load<Record<string, unknown>>(datasetName);
    // Inject all keys into DataStore
    for (const [key, value] of Object.entries(data)) {
      DataStore.set(key, value);
    }
    Logger.info(`Test data "${datasetName}" loaded. Keys: ${Object.keys(data).join(', ')}`);
  }
);

Given(
  /^I load test data ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, datasetName: string, storeKey: string) {
    const data = TestDataLoader.load(datasetName);
    DataStore.set(storeKey, data);
    Logger.info(`Test data "${datasetName}" stored as "${storeKey}"`);
  }
);

Given(
  /^I set variable ['"](.+)['"] to ['"](.+)['"]$/,
  async function (this: CustomWorld, variableName: string, value: string) {
    DataStore.set(variableName, value);
    Logger.info(`Variable "${variableName}" = "${value}"`);
  }
);

// ─── Variable Assertions ──────────────────────────────────────────────────────

Then(
  /^variable ['"](.+)['"] should (?:be|equal) ['"](.+)['"]$/,
  async function (this: CustomWorld, variableName: string, expectedValue: string) {
    const actual = DataStore.getOrThrow(variableName);
    if (String(actual) !== expectedValue) {
      throw new Error(
        `Variable "${variableName}": expected "${expectedValue}" but got "${actual}"`
      );
    }
  }
);

Then(
  /^variable ['"](.+)['"] should exist$/,
  async function (this: CustomWorld, variableName: string) {
    if (!DataStore.has(variableName)) {
      throw new Error(`Variable "${variableName}" is not set in DataStore`);
    }
  }
);

// ─── Logging / Debug ─────────────────────────────────────────────────────────

When(
  /^I (?:log|print) ['"](.+)['"]$/,
  async function (this: CustomWorld, message: string) {
    // Resolve any {variables}
    const resolved = message.replace(/\{(\w+)\}/g, (_, key) => {
      const val = DataStore.get(key);
      return val !== undefined ? String(val) : `{${key}}`;
    });
    Logger.info(`[SCENARIO LOG] ${resolved}`);
    await this.attach(resolved, 'text/plain');
  }
);

When(
  /^I dump (?:the )?data store$/,
  async function (this: CustomWorld) {
    const dump = JSON.stringify(DataStore.dump(), null, 2);
    Logger.info(`DataStore dump:\n${dump}`);
    await this.attach(dump, 'text/plain');
  }
);
