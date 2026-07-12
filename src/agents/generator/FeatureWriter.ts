import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';

/**
 * FeatureWriter
 * -------------
 * Writes the generated .feature file.
 *
 * Default: writes to generated/features/{page}_from_{source}.feature (review copy)
 * --apply:  writes directly to features/web/{page}_from_{source}.feature
 *
 * The review copy allows QA to inspect before committing to the features/ folder.
 */
export class FeatureWriter {
  private config: AgentsConfig;
  private generatedFeaturesDir: string;
  private featuresWebDir: string;

  constructor() {
    this.config = AgentsConfig.getInstance();
    this.generatedFeaturesDir = path.resolve(process.cwd(), this.config.outputDir, 'features');
    this.featuresWebDir = path.resolve(process.cwd(), 'features', 'web');
  }

  /**
   * Writes the feature file content.
   *
   * @param content    - Full .feature file content
   * @param pageName   - Page name (e.g. "Support")
   * @param sourceFile - Source plan file name (for traceability)
   * @param apply      - If true, writes directly to features/web/
   * @returns          - Path to written file
   */
  write(
    content: string,
    pageName: string,
    sourceFile: string,
    apply: boolean = false
  ): string {
    const fileName = this._buildFileName(pageName, sourceFile);

    if (apply) {
      return this._writeToFeatures(content, fileName);
    } else {
      return this._writeToGenerated(content, fileName);
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _buildFileName(pageName: string, sourceFile: string): string {
    const baseName = path.basename(sourceFile, path.extname(sourceFile))
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${pageName.toLowerCase()}_from_${baseName}.feature`;
  }

  private _writeToGenerated(content: string, fileName: string): string {
    if (!fs.existsSync(this.generatedFeaturesDir)) {
      fs.mkdirSync(this.generatedFeaturesDir, { recursive: true });
    }
    const filePath = path.join(this.generatedFeaturesDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[FeatureWriter] Review copy written: ${filePath}`);
    return filePath;
  }

  private _writeToFeatures(content: string, fileName: string): string {
    if (!fs.existsSync(this.featuresWebDir)) {
      fs.mkdirSync(this.featuresWebDir, { recursive: true });
    }
    const filePath = path.join(this.featuresWebDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[FeatureWriter] Applied directly to features/web/: ${filePath}`);
    return filePath;
  }
}
