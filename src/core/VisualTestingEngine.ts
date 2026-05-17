import { Page } from '@playwright/test';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { OpenAIClient } from '../utils/OpenAIClient';

/**
 * VisualTestingEngine
 * ────────────────────────────────────────────────────────────────────────────
 * Captures screenshots, performs visual regression testing, and uses OpenAI
 * for intelligent visual validation and anomaly detection.
 */
export class VisualTestingEngine {
  private page: Page;
  private screenshotDir: string;
  private baselineDir: string;

  constructor(page: Page) {
    this.page = page;
    this.screenshotDir = 'reports/screenshots';
    this.baselineDir = 'test-baselines/screenshots';
    this._ensureDirectories();
  }

  /**
   * Capture full page screenshot
   */
  async captureFullPage(testName: string): Promise<string> {
    try {
      const filename = `${testName}_${Date.now()}.png`;
      const filepath = path.join(this.screenshotDir, filename);

      await this.page.screenshot({ path: filepath, fullPage: true });
      Logger.info(`Screenshot captured: ${filename}`);
      return filepath;
    } catch (error) {
      Logger.error(`Failed to capture screenshot: ${error}`);
      throw error;
    }
  }

  /**
   * Capture element screenshot
   */
  async captureElement(elementSelector: string, testName: string): Promise<string> {
    try {
      const element = this.page.locator(elementSelector);
      const filename = `${testName}_element_${Date.now()}.png`;
      const filepath = path.join(this.screenshotDir, filename);

      await element.screenshot({ path: filepath });
      Logger.info(`Element screenshot captured: ${filename}`);
      return filepath;
    } catch (error) {
      Logger.error(`Failed to capture element screenshot: ${error}`);
      throw error;
    }
  }

  /**
   * Analyze screenshot for visual issues using OpenAI
   */
  async analyzeScreenshotForIssues(
    screenshotPath: string,
    context: string = ''
  ): Promise<string> {
    try {
      const imageBase64 = await this._readImageAsBase64(screenshotPath);
      const analysis = await OpenAIClient.analyzeScreenshot(imageBase64, context);
      Logger.info(`Visual Analysis: ${analysis.substring(0, 100)}...`);
      return analysis;
    } catch (error) {
      Logger.error(`Failed to analyze screenshot: ${error}`);
      return 'Analysis unavailable';
    }
  }

  /**
   * Visual regression test - compare with baseline
   */
  async visualRegressionTest(
    currentScreenshotPath: string,
    testName: string,
    tolerance: number = 0.95
  ): Promise<{ passed: boolean; difference: number; message: string }> {
    try {
      const baselinePath = path.join(this.baselineDir, `${testName}_baseline.png`);

      // If no baseline exists, create it
      if (!fs.existsSync(baselinePath)) {
        this._ensureDirectories();
        fs.copyFileSync(currentScreenshotPath, baselinePath);
        Logger.info(`Baseline created for ${testName}`);
        return {
          passed: true,
          difference: 0,
          message: 'Baseline created (first run)',
        };
      }

      // Compare images using OpenAI
      const currentBase64 = await this._readImageAsBase64(currentScreenshotPath);
      const baselineBase64 = await this._readImageAsBase64(baselinePath);

      const comparison = await OpenAIClient.validateVisuals(
        currentBase64,
        baselineBase64,
        testName
      );

      const passed = comparison.match;
      Logger.info(
        `Visual Regression: ${passed ? '✓ PASSED' : '✗ FAILED'} - ${comparison.feedback}`
      );

      return {
        passed,
        difference: passed ? 0 : 1,
        message: comparison.feedback,
      };
    } catch (error) {
      Logger.error(`Visual regression test failed: ${error}`);
      return {
        passed: false,
        difference: 1,
        message: 'Visual regression test error',
      };
    }
  }

  /**
   * Detect visual anomalies in screenshot
   */
  async detectAnomalies(screenshotPath: string): Promise<string[]> {
    try {
      const imageBase64 = await this._readImageAsBase64(screenshotPath);
      const analysis = await OpenAIClient.analyzeScreenshot(
        imageBase64,
        'Detect any visual anomalies, errors, or unexpected elements in this UI screenshot. List each issue.'
      );

      // Parse anomalies from response
      const anomalies = analysis
        .split('\n')
        .filter((line) => line.trim().length > 0);
      Logger.warn(`Detected ${anomalies.length} potential anomalies`);
      return anomalies;
    } catch (error) {
      Logger.error(`Anomaly detection failed: ${error}`);
      return [];
    }
  }

  /**
   * Crop image to specific region for testing
   */
  async cropImage(
    screenshotPath: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<string> {
    try {
      const filename = `crop_${Date.now()}.png`;
      const outputPath = path.join(this.screenshotDir, filename);

      await sharp(screenshotPath)
        .extract({ left: x, top: y, width, height })
        .toFile(outputPath);

      Logger.info(`Image cropped and saved: ${filename}`);
      return outputPath;
    } catch (error) {
      Logger.error(`Failed to crop image: ${error}`);
      throw error;
    }
  }

  /**
   * Convert image to grayscale for comparison (removes color variations)
   */
  async toGrayscale(screenshotPath: string): Promise<string> {
    try {
      const filename = `grayscale_${Date.now()}.png`;
      const outputPath = path.join(this.screenshotDir, filename);

      await sharp(screenshotPath)
        .grayscale()
        .toFile(outputPath);

      Logger.info(`Grayscale image created: ${filename}`);
      return outputPath;
    } catch (error) {
      Logger.error(`Failed to convert to grayscale: ${error}`);
      throw error;
    }
  }

  /**
   * Compare two images pixel-by-pixel
   */
  async pixelPerfectCompare(
    image1Path: string,
    image2Path: string
  ): Promise<{ identical: boolean; diffPercentage: number }> {
    try {
      const img1 = sharp(image1Path);
      const img2 = sharp(image2Path);

      const meta1 = await img1.metadata();
      const meta2 = await img2.metadata();

      // Size mismatch is a difference
      if (meta1.width !== meta2.width || meta1.height !== meta2.height) {
        return {
          identical: false,
          diffPercentage: 100,
        };
      }

      // Get raw pixel data
      const data1 = await img1.raw().toBuffer();
      const data2 = await img2.raw().toBuffer();

      let differences = 0;
      const pixelCount = Math.min(data1.length, data2.length) / 4; // 4 bytes per pixel (RGBA)

      for (let i = 0; i < data1.length; i += 4) {
        const r1 = data1[i];
        const g1 = data1[i + 1];
        const b1 = data1[i + 2];
        const a1 = data1[i + 3];

        const r2 = data2[i];
        const g2 = data2[i + 1];
        const b2 = data2[i + 2];
        const a2 = data2[i + 3];

        // Calculate color difference
        if (
          r1 !== r2 ||
          g1 !== g2 ||
          b1 !== b2 ||
          a1 !== a2
        ) {
          differences++;
        }
      }

      const diffPercentage = (differences / pixelCount) * 100;
      const identical = diffPercentage < 0.1; // Less than 0.1% difference

      Logger.info(
        `Pixel comparison: ${identical ? 'IDENTICAL' : `${diffPercentage.toFixed(2)}% different`}`
      );

      return { identical, diffPercentage };
    } catch (error) {
      Logger.error(`Pixel perfect comparison failed: ${error}`);
      return { identical: false, diffPercentage: 100 };
    }
  }

  /**
   * Create visual diff overlay
   */
  async createDiffOverlay(
    baselinePath: string,
    currentPath: string
  ): Promise<string> {
    try {
      const img1 = sharp(baselinePath);
      const img2 = sharp(currentPath);

      const meta1 = await img1.metadata();
      const meta2 = await img2.metadata();

      const width = Math.max(meta1.width || 0, meta2.width || 0);
      const height = Math.max(meta1.height || 0, meta2.height || 0);

      // Create side-by-side comparison
      const filename = `diff_${Date.now()}.png`;
      const outputPath = path.join(this.screenshotDir, filename);

      await sharp({
        create: {
          width: (width || 1) * 2 + 20,
          height: height || 1,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: baselinePath, left: 0, top: 0 },
          { input: currentPath, left: (width || 1) + 20, top: 0 },
        ])
        .toFile(outputPath);

      Logger.info(`Diff overlay created: ${filename}`);
      return outputPath;
    } catch (error) {
      Logger.error(`Failed to create diff overlay: ${error}`);
      throw error;
    }
  }

  /**
   * Read image file as base64
   */
  private async _readImageAsBase64(imagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(imagePath, (err, data) => {
        if (err) reject(err);
        resolve(data.toString('base64'));
      });
    });
  }

  /**
   * Ensure directories exist
   */
  private _ensureDirectories(): void {
    [this.screenshotDir, this.baselineDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
}
