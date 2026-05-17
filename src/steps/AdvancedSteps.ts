import { Given, When, Then } from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { Logger } from '../utils/Logger';

When(
  /^I click ['"](.+)['"] with self-healing$/,
  async function (this: CustomWorld, elementRef: string) {
    Logger.info(`Attempting to click element with self-healing: ${elementRef}`);
    
    const { element, healingResult } = await this.selfHealingEngine.findElementWithHealing(
      elementRef,
      'click'
    );
    
    Logger.info(`Healing result: ${JSON.stringify(healingResult)}`);
    
    if (element) {
      await element.click();
      this.recordAction(`Clicked ${elementRef} (healed: ${healingResult.healingStatus}, confidence: ${healingResult.confidence})`);
    } else {
      throw new Error(
        `Element not found after self-healing: ${elementRef}\n` +
        `Healing details: ${healingResult.reason}`
      );
    }
  }
);

When(
  /^I enter ['"](.+)['"] into ['"](.+)['"] with self-healing$/,
  async function (this: CustomWorld, value: string, elementRef: string) {
    Logger.info(
      `Attempting to enter text with self-healing into: ${elementRef}`
    );
    
    const { element, healingResult } = await this.selfHealingEngine.findElementWithHealing(
      elementRef,
      'type'
    );
    
    Logger.info(`Healing result: ${JSON.stringify(healingResult)}`);
    
    if (element) {
      await element.fill(value);
      this.recordAction(`Entered text into ${elementRef} (healed: ${healingResult.healingStatus}, confidence: ${healingResult.confidence})`);
    } else {
      throw new Error(
        `Element not found after self-healing: ${elementRef}\n` +
        `Healing details: ${healingResult.reason}`
      );
    }
  }
);

When(
  /^I capture full page screenshot as ['"](.+)['"]$/,
  async function (this: CustomWorld, testName: string) {
    const screenshotPath = await this.visualTestingEngine.captureFullPage(
      testName
    );
    Logger.info(`Full page screenshot captured: ${screenshotPath}`);
  }
);

When(
  /^I capture screenshot of ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, elementSelector: string, testName: string) {
    const screenshotPath = await this.visualTestingEngine.captureElement(
      elementSelector,
      testName
    );
    Logger.info(`Element screenshot captured: ${screenshotPath}`);
  }
);

Then(
  /^the page should have no visual anomalies$/,
  async function (this: CustomWorld) {
    const screenshot = await this.visualTestingEngine.captureFullPage('anomaly-check');
    const anomalies = await this.visualTestingEngine.detectAnomalies(screenshot);
    
    if (anomalies.length > 0) {
      Logger.warn(`Found ${anomalies.length} potential visual anomalies`);
      throw new Error(
        `Visual anomalies detected:\n${anomalies.join('\n')}`
      );
    }
    
    Logger.info('✓ No visual anomalies detected');
  }
);

Then(
  /^the page visual state should match baseline ['"](.+)['"]$/,
  async function (this: CustomWorld, testName: string) {
    const currentScreenshot = await this.visualTestingEngine.captureFullPage(
      testName
    );
    
    const result = await this.visualTestingEngine.visualRegressionTest(
      currentScreenshot,
      testName
    );
    
    if (!result.passed) {
      Logger.error(`Visual regression detected: ${result.message}`);
      throw new Error(
        `Visual regression test failed: ${result.message}`
      );
    }
    
    Logger.info(`✓ Visual test passed: ${testName}`);
  }
);

When(
  /^I analyze screenshot for issues$/,
  async function (this: CustomWorld) {
    const screenshot = await this.visualTestingEngine.captureFullPage('analysis');
    const analysis = await this.visualTestingEngine.analyzeScreenshotForIssues(
      screenshot,
      'General visual analysis'
    );
    
    Logger.info(`Visual Analysis Results:\n${analysis}`);
    
    const { DataStore } = await import('../utils/DataStore');
    DataStore.set('lastVisualAnalysis', analysis);
  }
);

When(
  /^I crop screenshot area \((\d+), (\d+), (\d+), (\d+)\)$/,
  async function (this: CustomWorld, x: string, y: string, width: string, height: string) {
    const screenshot = await this.visualTestingEngine.captureFullPage('temp');
    const croppedPath = await this.visualTestingEngine.cropImage(
      screenshot,
      parseInt(x),
      parseInt(y),
      parseInt(width),
      parseInt(height)
    );
    Logger.info(`Screenshot area cropped: ${croppedPath}`);
  }
);

When(
  /^I convert screenshot to grayscale$/,
  async function (this: CustomWorld) {
    const screenshot = await this.visualTestingEngine.captureFullPage('temp');
    const grayscalePath = await this.visualTestingEngine.toGrayscale(
      screenshot
    );
    Logger.info(`Screenshot converted to grayscale: ${grayscalePath}`);
  }
);

When(
  /^I analyze the current failure context$/,
  async function (this: CustomWorld) {
    try {
      const screenshot = await this.visualTestingEngine.captureFullPage('failure');
      const analysis = await this.rootCauseAnalyzer.analyzeFailure({
        scenarioName: this.scenarioName,
        failureMessage: 'Manual failure analysis requested',
        lastActions: ['User initiated manual analysis'],
        pageUrl: this.getPage().url(),
        pageTitle: await this.getPage().title(),
        screenshot: require('fs').readFileSync(screenshot, 'base64'),
      });
      
      Logger.info(`Root Cause Analysis:\n${analysis.analysis}`);
      Logger.info(`Suggestions:\n${analysis.suggestions.join('\n')}`);
    } catch (error) {
      Logger.error(`Failed to analyze failure: ${error}`);
    }
  }
);

When(
  /^I get common failure patterns from previous test runs$/,
  async function (this: CustomWorld) {
    const patterns = this.rootCauseAnalyzer.getCommonPatterns();
    
    if (patterns.length === 0) {
      Logger.info('No failure patterns found');
      return;
    }
    
    Logger.info('Common Failure Patterns:');
    patterns.forEach((p, index) => {
      Logger.info(`  ${index + 1}. ${p.pattern} (${p.count} occurrences)`);
    });
  }
);

Then(
  /^self-healing cache should have (\d+) entries?$/,
  async function (this: CustomWorld, expectedCount: string) {
    const stats = this.selfHealingEngine.getCacheStats();
    const count = parseInt(expectedCount);
    
    if (stats.size !== count) {
      throw new Error(
        `Expected ${count} cache entries, but found ${stats.size}`
      );
    }
    
    Logger.info(`✓ Self-healing cache has ${count} entries as expected`);
  }
);

When(
  /^I clear the self-healing cache$/,
  async function (this: CustomWorld) {
    this.selfHealingEngine.clearCache();
    Logger.info('Self-healing cache cleared');
  }
);

When(
  /^I display self-healing cache statistics$/,
  async function (this: CustomWorld) {
    const stats = this.selfHealingEngine.getCacheStats();
    Logger.info(`Self-Healing Cache Statistics:`);
    Logger.info(`  Total Entries: ${stats.size}`);
    if (stats.entries.length > 0) {
      Logger.info(`  Cached Elements:`);
      stats.entries.forEach((entry) => {
        Logger.info(`    - ${entry}`);
      });
    }
  }
);

Then(
  /^I perform comprehensive visual validation of the current page$/,
  async function (this: CustomWorld) {
    Logger.info('Starting comprehensive visual validation...');
    
    const screenshot = await this.visualTestingEngine.captureFullPage(
      'comprehensive-validation'
    );
    
    const anomalies = await this.visualTestingEngine.detectAnomalies(screenshot);
    if (anomalies.length > 0) {
      Logger.warn(`Detected ${anomalies.length} potential visual issues`);
    }
    
    const analysis = await this.visualTestingEngine.analyzeScreenshotForIssues(
      screenshot,
      'Comprehensive validation'
    );
    Logger.info(`Analysis: ${analysis.substring(0, 200)}...`);
    
    Logger.info('✓ Comprehensive visual validation completed');
  }
);

When(
  /^I test element accessibility with self-healing for ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    Logger.info(`Testing element accessibility: ${elementRef}`);
    
    const { element, healingResult } = await this.selfHealingEngine.findElementWithHealing(
      elementRef,
      'accessibility-check'
    );
    
    if (element) {
      const isAccessible = await this.selfHealingEngine.isElementAccessible(element);
      if (isAccessible) {
        Logger.info(`✓ Element ${elementRef} is accessible`);
      } else {
        throw new Error(`Element ${elementRef} is not accessible`);
      }
    } else {
      throw new Error(`Could not find element: ${elementRef}\nHealing details: ${healingResult.reason}`);
    }
  }
);

When(
  /^I record action ['"](.+)['"] for failure analysis$/,
  async function (this: CustomWorld, action: string) {
    this.recordAction(action);
    Logger.info(`Action recorded: ${action}`);
  }
);
