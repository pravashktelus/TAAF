import * as fs from 'fs';
import * as path from 'path';

/**
 * TestDataLoader
 * ────────────────────────────────────────────────────────────────────────────
 * Loads test data from JSON files in the testdata/ directory.
 * Supports environment-specific data files.
 *
 * File naming convention:
 *   testdata/<datasetName>.json            ← environment-agnostic
 *   testdata/<datasetName>.<env>.json      ← environment-specific
 */
export class TestDataLoader {
  private static readonly DATA_DIR = path.resolve(__dirname, '../../testdata');

  /**
   * Load a test data file. Environment-specific file takes precedence.
   * @param datasetName  e.g. "users" → loads testdata/users.qa.json or testdata/users.json
   */
  public static load<T = Record<string, unknown>>(datasetName: string): T {
    const env = process.env.ENV || 'qa';
    const envFile = path.join(this.DATA_DIR, `${datasetName}.${env}.json`);
    const baseFile = path.join(this.DATA_DIR, `${datasetName}.json`);

    const filePath = fs.existsSync(envFile) ? envFile : baseFile;

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Test data file not found: "${filePath}". ` +
          `Create testdata/${datasetName}.json or testdata/${datasetName}.${env}.json`
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  }

  /**
   * Get a specific field from a dataset.
   */
  public static get<T = unknown>(datasetName: string, key: string): T {
    const data = this.load<Record<string, unknown>>(datasetName);
    if (!(key in data)) {
      throw new Error(`Key "${key}" not found in dataset "${datasetName}"`);
    }
    return data[key] as T;
  }
}
