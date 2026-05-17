import {
  Before,
  After,
  BeforeAll,
  AfterAll,
  BeforeStep,
  AfterStep,
  Status,
  ITestCaseHookParameter,
  ITestStepHookParameter,
  setDefaultTimeout,
} from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';
import { ElementResolver } from '../core/ElementResolver';
import { TestFailureContext } from '../core/RootCauseAnalyzer';
import * as fs from 'fs';

setDefaultTimeout(60_000);

BeforeAll(async function () {
  const dirs = [
    'reports',
    'reports/html',
    'reports/cucumber-json',
    'reports/allure-results',
    'reports/screenshots',
    'reports/videos',
    'reports/logs',
    'reports/failure-analysis',
  ];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  Logger.info('=== Test Suite Started ===');
});

AfterAll(async function () {
  Logger.info('=== Test Suite Completed ===');
});

Before(async function (this: CustomWorld, scenario: ITestCaseHookParameter) {
  this.scenarioName = scenario.pickle.name;
  this.scenarioTags = scenario.pickle.tags.map((t) => t.name);

  Logger.scenario(this.scenarioName);
  Logger.info(`Tags: ${this.scenarioTags.join(', ') || 'none'}`);

  const isApiOnly =
    this.scenarioTags.includes('@api') && !this.scenarioTags.includes('@web');

  if (!isApiOnly) {
    await this.contextManager.launch();
    this.initActionEngine();
    Logger.info('Browser ready for scenario');
  } else {
    Logger.info('API-only scenario — skipping browser launch');
  }
});

BeforeStep(async function (this: CustomWorld, step: ITestStepHookParameter) {
  const text = step.pickleStep.text;
  Logger.step(text);
  this.recordAction(`Step: ${text}`);

  if (this.actionEngine) {
    this.actionEngine.clearStepHealingResults();
  }
});

AfterStep(async function (this: CustomWorld, step: ITestStepHookParameter) {
  if (this.actionEngine) {
    const healingResults = this.actionEngine.getStepHealingResults();
    if (healingResults.length > 0) {
      const healingHtml = `
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 16px; }
    .healing-card { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 16px; overflow: hidden; }
    .healing-header { background: linear-gradient(135deg, #2e7d32, #43a047); color: white; padding: 14px 20px; display: flex; align-items: center; gap: 10px; }
    .healing-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .healing-badge { background: rgba(255,255,255,0.2); padding: 3px 10px; border-radius: 12px; font-size: 11px; }
    .healing-body { padding: 16px 20px; }
    .locator-row { display: flex; align-items: center; margin: 10px 0; gap: 12px; }
    .locator-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #666; min-width: 90px; }
    .locator-old { background: #ffebee; border: 1px solid #ef9a9a; border-radius: 4px; padding: 6px 12px; font-family: 'Fira Code', monospace; font-size: 13px; color: #c62828; text-decoration: line-through; flex: 1; }
    .locator-new { background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 4px; padding: 6px 12px; font-family: 'Fira Code', monospace; font-size: 13px; color: #2e7d32; font-weight: 600; flex: 1; }
    .arrow { font-size: 20px; color: #43a047; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid #eee; }
    .meta-item { text-align: center; }
    .meta-value { font-size: 18px; font-weight: 700; color: #1b5e20; }
    .meta-label { font-size: 10px; text-transform: uppercase; color: #888; margin-top: 2px; }
    .fallbacks { margin-top: 14px; padding-top: 14px; border-top: 1px solid #eee; }
    .fallbacks h4 { margin: 0 0 8px; font-size: 12px; color: #666; text-transform: uppercase; }
    .fallback-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
    .fallback-type { background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .fallback-selector { font-family: 'Fira Code', monospace; color: #555; }
    .fallback-confidence { color: #888; font-size: 11px; }
  </style>
</head>
<body>
${healingResults.map((hr, idx) => `
  <div class="healing-card">
    <div class="healing-header">
      <span>🩹</span>
      <h3>Self-Healing Activated</h3>
      <span class="healing-badge">${hr.bestLocator?.type || 'unknown'}</span>
    </div>
    <div class="healing-body">
      <div class="locator-row">
        <span class="locator-label">Failed:</span>
        <code class="locator-old">${hr.originalLocator}</code>
      </div>
      <div class="locator-row">
        <span class="locator-label">Healed:</span>
        <code class="locator-new">${hr.bestLocator?.rawSelector || 'N/A'}</code>
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-value">${hr.confidence}%</div>
          <div class="meta-label">Confidence</div>
        </div>
        <div class="meta-item">
          <div class="meta-value">${hr.bestLocator?.type || '-'}</div>
          <div class="meta-label">Strategy</div>
        </div>
        <div class="meta-item">
          <div class="meta-value">${hr.fallbackLocators.length}</div>
          <div class="meta-label">Fallbacks</div>
        </div>
      </div>
      ${hr.fallbackLocators.length > 0 ? `
      <div class="fallbacks">
        <h4>Fallback Locators</h4>
        ${hr.fallbackLocators.slice(0, 5).map(fb => `
        <div class="fallback-item">
          <span class="fallback-type">${fb.type}</span>
          <span class="fallback-selector">${fb.rawSelector}</span>
          <span class="fallback-confidence">(${fb.confidence}%)</span>
        </div>
        `).join('')}
      </div>
      ` : ''}
    </div>
  </div>
`).join('')}
</body>
</html>`;

      await this.attach(healingHtml, 'text/html');

      const textSummary = healingResults.map(hr =>
        `🩹 SELF-HEALED: "${hr.referenceName}"\n` +
        `   Old: ${hr.originalLocator}\n` +
        `   New: ${hr.bestLocator?.rawSelector || 'N/A'}\n` +
        `   Type: ${hr.bestLocator?.type || '-'} | Confidence: ${hr.confidence}%\n` +
        `   Reason: ${hr.reason}`
      ).join('\n\n');
      await this.attach(textSummary, 'text/plain');
    }
  }

  if (step.result.status === Status.FAILED) {
    this.testFailed = true;
    Logger.error(`Step failed: ${step.pickleStep.text}`);

    if (this.contextManager && this.visualTestingEngine) {
      try {
        const screenshotPath = await this.visualTestingEngine.captureFullPage(
          `failure_${Date.now()}`
        );
        const screenshotBuffer = fs.readFileSync(screenshotPath);
        
        await this.attach(screenshotBuffer, 'image/png');
        Logger.info('Screenshot attached to report on step failure');

        if (this.rootCauseAnalyzer) {
          const failureContext: TestFailureContext = {
            scenarioName: this.scenarioName,
            failureMessage: step.result?.message || 'Unknown error',
            errorStack: step.result?.message,
            lastActions: step.pickleStep.text ? [step.pickleStep.text] : [],
            pageUrl: await this.contextManager.getPage().url(),
            pageTitle: await this.contextManager.getPage().title(),
            screenshot: screenshotBuffer.toString('base64'),
          };

          Logger.info('Initiating root cause analysis for failure...');
          const { analysis, suggestions, report } = await this.rootCauseAnalyzer.analyzeFailure(
            failureContext
          );

          const rcaReport = `
═══════════════════════════════════════════════════════════════════
               ROOT CAUSE ANALYSIS REPORT
═══════════════════════════════════════════════════════════════════

FAILURE MESSAGE:
${step.result?.message || 'Unknown error'}

PAGE CONTEXT:
  URL: ${failureContext.pageUrl}
  Title: ${failureContext.pageTitle}

ROOT CAUSE ANALYSIS:
${analysis}

SUGGESTED FIXES:
${suggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

DETAILED REPORT: ${report}

═══════════════════════════════════════════════════════════════════
          Analysis generated by OpenAI RootCauseAnalyzer
═══════════════════════════════════════════════════════════════════
`;

          await this.attach(rcaReport, 'text/plain');
          Logger.info(`Failure analysis report: ${report}`);

          const rcaHtml = `
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 1000px; margin: 20px auto; background: white; padding: 20px; border-radius: 5px; }
    .header { background-color: #d32f2f; color: white; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
    .section { margin: 15px 0; padding: 10px; background: #f9f9f9; border-left: 4px solid #d32f2f; }
    .section-title { font-weight: bold; font-size: 14px; color: #d32f2f; margin-bottom: 8px; }
    .failure-msg { background: #ffebee; padding: 10px; border-radius: 3px; color: #c62828; }
    .suggestions { list-style-position: inside; }
    .suggestion-item { padding: 8px; margin: 5px 0; background: #fff3e0; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>🔴 Root Cause Analysis Report</h2>
    </div>
    
    <div class="section">
      <div class="section-title">Failure Message</div>
      <div class="failure-msg">${step.result?.message || 'Unknown error'}</div>
    </div>
    
    <div class="section">
      <div class="section-title">Page Context</div>
      <p><strong>URL:</strong> ${failureContext.pageUrl}</p>
      <p><strong>Title:</strong> ${failureContext.pageTitle}</p>
    </div>
    
    <div class="section">
      <div class="section-title">Root Cause Analysis</div>
      <p>${analysis.replace(/\n/g, '<br>')}</p>
    </div>
    
    <div class="section">
      <div class="section-title">Suggested Fixes</div>
      <ol class="suggestions">
        ${suggestions.map(s => `<li class="suggestion-item">${s}</li>`).join('\n')}
      </ol>
    </div>
  </div>
</body>
</html>
`;
          await this.attach(rcaHtml, 'text/html');
        }
      } catch (error) {
        Logger.warn(`Failed to capture screenshot or analyze failure: ${error}`);
      }
    }
  }
});

After(async function (this: CustomWorld, scenario: ITestCaseHookParameter) {
  const status = scenario.result?.status;
  const failed = status === Status.FAILED;

  if (failed) {
    Logger.testFailed(this.scenarioName, scenario.result?.message);
    
    if (this.contextManager && this.visualTestingEngine) {
      try {
        const screenshotPath = await this.visualTestingEngine.captureFullPage(
          `final_failure_${Date.now()}`
        );
        const screenshotBuffer = fs.readFileSync(screenshotPath);
        await this.attach(screenshotBuffer, 'image/png');
        Logger.info('Final screenshot attached to report on scenario failure');
      } catch (error) {
        Logger.warn(`Failed to capture final screenshot: ${error}`);
      }
    }
  } else {
    Logger.testPassed(this.scenarioName);
  }

  if (failed) {
    const dump = JSON.stringify(DataStore.dump(), null, 2);
    await this.attach(`DataStore State:\n${dump}`, 'text/plain');
  }

  if (this.selfHealingEngine) {
    const stats = this.selfHealingEngine.getCacheStats();
    if (stats && stats.size > 0 && stats.entries) {
      Logger.info(
        `Self-healing cache statistics: ${stats.size} entries cached`
      );
      
      const detailedStats = this.selfHealingEngine.getDetailedHealingStats();
      
      const shReport = `
═══════════════════════════════════════════════════════════════════════════════
                    SELF-HEALING ENGINE DETAILED REPORT
═══════════════════════════════════════════════════════════════════════════════

Total Locators Healed: ${stats.size}

${detailedStats.map((healing, idx) => `
${idx + 1}. ELEMENT REFERENCE: ${healing.reference}
   ┌─────────────────────────────────────────────────────────────────────
   │ Original (Broken) Locator:  ${healing.originalLocator}
   │ Healed (New) Locator:       ${healing.healedLocator}
   │ Locator Type:               ${healing.type}
   │ Confidence Score:           ${healing.confidence}%
   │ Description:                ${healing.reason}
   ${healing.elementTag ? `│ Element Tag:                <${healing.elementTag}>` : ''}
   ${healing.elementText ? `│ Element Text:               "${healing.elementText}"` : ''}
   └─────────────────────────────────────────────────────────────────────
`).join('')}

Status: ✓ Self-healing successfully recovered ${stats.size} broken locator(s)

═══════════════════════════════════════════════════════════════════════════════
`;
      await this.attach(shReport, 'text/plain');

      const shHtml = `
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background-color: #f5f5f5; 
      color: #333;
    }
    .container { 
      max-width: 1200px; 
      margin: 20px auto; 
      background: white; 
      padding: 20px; 
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header { 
      background-color: #2e7d32; 
      color: white; 
      padding: 20px; 
      border-radius: 5px; 
      margin-bottom: 20px;
    }
    .header h2 { margin: 0; }
    .stats { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
      gap: 15px; 
      margin: 20px 0;
    }
    .stat-box { 
      background: #e8f5e9; 
      padding: 15px; 
      border-radius: 5px; 
      border-left: 4px solid #2e7d32; 
      text-align: center;
    }
    .stat-number { 
      font-size: 32px; 
      font-weight: bold; 
      color: #2e7d32; 
    }
    .stat-label { 
      color: #666; 
      font-size: 13px; 
      margin-top: 5px;
    }
    .healing-item {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin: 15px 0;
      border-left: 5px solid #2e7d32;
    }
    .healing-item h4 {
      color: #2e7d32;
      margin: 0 0 10px 0;
    }
    .locator-pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 10px 0;
    }
    .locator-box {
      padding: 10px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .old-locator {
      background: #ffebee;
      border: 1px solid #ef5350;
      color: #c62828;
    }
    .new-locator {
      background: #e8f5e9;
      border: 1px solid #66bb6a;
      color: #2e7d32;
    }
    .label {
      font-size: 11px;
      font-weight: bold;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .meta-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
      font-size: 13px;
    }
    .meta-item {
      padding: 8px;
      background: white;
      border-radius: 3px;
    }
    .meta-label {
      font-weight: bold;
      color: #2e7d32;
    }
    .confidence-bar {
      height: 20px;
      background: #e0e0e0;
      border-radius: 3px;
      overflow: hidden;
      margin: 5px 0;
    }
    .confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #66bb6a 0%, #2e7d32 100%);
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 11px;
      font-weight: bold;
    }
    .description {
      background: white;
      padding: 10px;
      border-radius: 3px;
      border-left: 3px solid #2196F3;
      font-size: 13px;
      margin-top: 10px;
      font-style: italic;
      color: #555;
    }
    .summary {
      background: #e8f5e9;
      padding: 15px;
      border-radius: 5px;
      margin-top: 20px;
      text-align: center;
      color: #2e7d32;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>✓ Self-Healing Engine Report</h2>
    </div>
    
    <div class="stats">
      <div class="stat-box">
        <div class="stat-number">${stats.size || 0}</div>
        <div class="stat-label">Elements Healed</div>
      </div>
      <div class="stat-box">
        <div class="stat-number">100%</div>
        <div class="stat-label">Recovery Rate</div>
      </div>
    </div>
    
    <h3>Healed Locators Details:</h3>
    ${detailedStats.map((healing, idx) => `
    <div class="healing-item">
      <h4>${idx + 1}. ${healing.reference}</h4>
      
      <div class="locator-pair">
        <div>
          <div class="label">❌ Original (Broken) Locator</div>
          <div class="locator-box old-locator">${healing.originalLocator}</div>
        </div>
        <div>
          <div class="label">✓ Healed (New) Locator</div>
          <div class="locator-box new-locator">${healing.healedLocator}</div>
        </div>
      </div>
      
      <div class="meta-info">
        <div class="meta-item">
          <span class="meta-label">Healing Strategy:</span> ${healing.type}
        </div>
        <div class="meta-item">
          <span class="meta-label">Confidence:</span> ${healing.confidence}%
        </div>
      </div>
      
      <div class="confidence-bar">
        <div class="confidence-fill" style="width: ${healing.confidence}%">${healing.confidence}%</div>
      </div>
      
      <div class="description">
        <strong>Why:</strong> ${healing.reason}
      </div>
      
      ${healing.elementTag ? `
      <div class="meta-info" style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px;">
        <div class="meta-item">
          <span class="meta-label">Element Tag:</span> &lt;${healing.elementTag}&gt;
        </div>
        ${healing.elementText ? `<div class="meta-item"><span class="meta-label">Text Content:</span> "${healing.elementText}"</div>` : ''}
      </div>
      ` : ''}
    </div>
    `).join('')}
    
    <div class="summary">
      <strong>✓ Self-healing successfully recovered ${stats.size} broken locator${stats.size !== 1 ? 's' : ''}!</strong>
    </div>
  </div>
</body>
</html>
`;
      await this.attach(shHtml, 'text/html');
    }
  }

  if (this.visualTestingEngine && this.scenarioTags && this.scenarioTags.includes('@visual')) {
    const visualReport = `
═══════════════════════════════════════════════════════════════════
            VISUAL TESTING REPORT
═══════════════════════════════════════════════════════════════════

Scenario: ${this.scenarioName || 'Unknown'}
Status: ${status === Status.PASSED ? '✓ PASSED' : '✗ FAILED'}

Screenshots captured and stored in: reports/screenshots/

Visual Testing Performed:
  ✓ Full page screenshot capture
  ✓ Anomaly detection
  ✓ Visual regression testing

═══════════════════════════════════════════════════════════════════
`;
    await this.attach(visualReport, 'text/plain');

    const visualHtml = `
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 1000px; margin: 20px auto; background: white; padding: 20px; border-radius: 5px; }
    .header { background-color: #1976d2; color: white; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
    .status { padding: 10px; border-radius: 3px; margin: 10px 0; }
    .passed { background: #e8f5e9; color: #2e7d32; }
    .failed { background: #ffebee; color: #d32f2f; }
    .checks { list-style: none; padding: 0; }
    .check-item { padding: 10px; margin: 5px 0; background: #e3f2fd; border-left: 4px solid #1976d2; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>📸 Visual Testing Report</h2>
    </div>
    
    <div class="status ${status === Status.PASSED ? 'passed' : 'failed'}">
      Status: ${status === Status.PASSED ? '✓ PASSED' : '✗ FAILED'}
    </div>
    
    <h3>Visual Tests Performed:</h3>
    <ul class="checks">
      <li class="check-item">✓ Full page screenshot capture</li>
      <li class="check-item">✓ AI-powered anomaly detection</li>
      <li class="check-item">✓ Visual regression testing</li>
      <li class="check-item">✓ Element comparison</li>
    </ul>
    
    <p><strong>Screenshots Location:</strong> reports/screenshots/</p>
  </div>
</body>
</html>
`;
    await this.attach(visualHtml, 'text/html');
  }

  if (failed) {
    try {
      const logsDir = 'reports/logs';
      if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir)
          .filter(f => f.endsWith('.log'))
          .sort()
          .reverse()
          .slice(0, 1);

        if (logFiles.length > 0) {
          const logPath = `${logsDir}/${logFiles[0]}`;
          const logContent = fs.readFileSync(logPath, 'utf8');
          await this.attach(`Error Logs (${logFiles[0]}):\n${logContent}`, 'text/plain');
          Logger.info('Error logs attached to report');
        }
      }
    } catch (error) {
      Logger.warn(`Could not attach error logs: ${error}`);
    }
  }

  if (this.contextManager) {
    await this.contextManager.close(failed).catch(() => {});
  }

  DataStore.clear();
  ElementResolver.clearCache();
  if (this.selfHealingEngine) {
    this.selfHealingEngine.clearCache();
  }
  if (this.rootCauseAnalyzer) {
    this.rootCauseAnalyzer.clearHistory();
  }
});

Before({ tags: '@ignore' }, async function (this: CustomWorld) {
  return 'skipped' as any;
});

Before({ tags: '@slow' }, async function (this: CustomWorld) {
  Logger.warn('Running a @slow scenario — timeout extended');
});

Before({ tags: '@visual' }, async function (this: CustomWorld) {
  Logger.info('Visual testing enabled for this scenario');
});

Before({ tags: '@self-healing' }, async function (this: CustomWorld) {
  Logger.info('Self-healing enabled for this scenario');
});
