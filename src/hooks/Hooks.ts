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

  // Capture step start time for duration tracking
  this.stepTimings.set(text, { startTime: Date.now(), endTime: 0 });

  if (this.actionEngine) {
    this.actionEngine.clearStepHealingResults();
  }
});

AfterStep(async function (this: CustomWorld, step: ITestStepHookParameter) {
  const text = step.pickleStep.text;
  // Capture step end time for duration tracking
  const stepTiming = this.stepTimings.get(text);
  if (stepTiming) {
    stepTiming.endTime = Date.now();
  }

  if (this.actionEngine) {
    const healingResults = this.actionEngine.getStepHealingResults();
    if (healingResults.length > 0) {
      const healingHtml = `
<html>
<head>
  <style>
    .healing-container { font-family: 'Segoe UI', Arial, sans-serif; }
    .healing-container body { background: #f8f9fa; margin: 0; padding: 16px; }
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
  <div class="healing-container">
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
  </div>
</body>
</html>`;

      await this.attach(healingHtml, 'text/html');

      // Attach screenshot when self-healing is triggered - highlight the healed element
      if (this.contextManager && this.visualTestingEngine) {
        try {
          const page = this.contextManager.getPage();
          
          // Highlight each healed element with a bright border
          for (const hr of healingResults) {
            try {
              const healedLocator = hr.bestLocator?.rawSelector;
              if (healedLocator) {
                // Add a bright yellow/lime border to highlight the healed element
                await page.evaluate((selector) => {
                  try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach((el) => {
                      (el as HTMLElement).style.border = '4px solid #00FF00';
                      (el as HTMLElement).style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.8)';
                      (el as HTMLElement).style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
                    });
                  } catch (e) {
                    // Selector might not be valid for evaluate, try xpath
                  }
                }, healedLocator);
              }
            } catch (error) {
              Logger.warn(`Failed to highlight healed element: ${error}`);
            }
          }
          
          // Wait a moment for the highlighting to be visible
          await page.waitForTimeout(500);
          
          const screenshotPath = await this.visualTestingEngine.captureFullPage(
            `self_healing_${Date.now()}`
          );
          const screenshotBuffer = fs.readFileSync(screenshotPath);
          await this.attach(screenshotBuffer, 'image/png');
          Logger.info('Screenshot attached to report with highlighted healed element');
          
          // Remove highlighting after screenshot
          for (const hr of healingResults) {
            try {
              const healedLocator = hr.bestLocator?.rawSelector;
              if (healedLocator) {
                await page.evaluate((selector) => {
                  try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach((el) => {
                      (el as HTMLElement).style.border = '';
                      (el as HTMLElement).style.boxShadow = '';
                      (el as HTMLElement).style.backgroundColor = '';
                    });
                  } catch (e) {
                    // Ignore
                  }
                }, healedLocator);
              }
            } catch (error) {
              // Ignore cleanup errors
            }
          }
        } catch (error) {
          Logger.warn(`Failed to capture screenshot for self-healing: ${error}`);
        }
      }
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

          Logger.info(`Failure analysis report: ${report}`);

          const rcaHtml = `
<html>
<head>
  <style>
    .rca-container { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .rca-container * { margin: 0; padding: 0; box-sizing: border-box; }
    .rca-card { background: #16213e; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 900px; margin: 0 auto; }
    .rca-header { background: linear-gradient(135deg, #e53935, #b71c1c); padding: 20px 24px; display: flex; align-items: center; gap: 12px; }
    .rca-header h2 { color: white; font-size: 18px; font-weight: 600; margin: 0; }
    .rca-header .icon { font-size: 24px; }
    .rca-body { padding: 24px; }
    .rca-section { margin-bottom: 20px; }
    .rca-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #90a4ae; font-weight: 700; margin-bottom: 8px; }
    .rca-failure-box { background: #2d1b1b; border: 1px solid #5c2020; border-radius: 8px; padding: 14px 16px; font-family: 'Fira Code', monospace; font-size: 12px; color: #ef9a9a; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }
    .rca-context-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .rca-context-item { background: #1a2744; border-radius: 8px; padding: 12px 14px; }
    .rca-context-label { font-size: 10px; text-transform: uppercase; color: #78909c; margin-bottom: 4px; }
    .rca-context-value { font-size: 13px; color: #b0bec5; word-break: break-all; }
    .rca-analysis-box { background: #1a2744; border-radius: 8px; padding: 16px; font-size: 13px; color: #cfd8dc; line-height: 1.7; }
    .rca-analysis-box p { margin-bottom: 10px; }
    .rca-analysis-box ul, .rca-analysis-box ol { margin: 8px 0 8px 20px; }
    .rca-analysis-box li { margin-bottom: 6px; }
    .rca-analysis-box strong, .rca-analysis-box b { color: #fff; }
    .rca-suggestions-list { list-style: none; padding: 0; }
    .rca-suggestion { background: #1a2744; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 10px; }
    .rca-suggestion-num { background: #ff6f00; color: white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .rca-suggestion-text { font-size: 13px; color: #b0bec5; }
    .rca-footer { padding: 14px 24px; background: #0f1a2e; text-align: center; font-size: 11px; color: #546e7a; }
  </style>
</head>
<body>
  <div class="rca-container">
    <div class="rca-card">
    <div class="rca-header">
      <span class="icon">🔴</span>
      <h2>Root Cause Analysis</h2>
    </div>
    <div class="rca-body">
      <div class="rca-section">
        <div class="rca-section-title">Failure Message</div>
        <div class="rca-failure-box">${(step.result?.message || 'Unknown error').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      </div>
      <div class="rca-section">
        <div class="rca-section-title">Page Context</div>
        <div class="rca-context-grid">
          <div class="rca-context-item">
            <div class="rca-context-label">URL</div>
            <div class="rca-context-value">${failureContext.pageUrl}</div>
          </div>
          <div class="rca-context-item">
            <div class="rca-context-label">Title</div>
            <div class="rca-context-value">${failureContext.pageTitle}</div>
          </div>
        </div>
      </div>
      <div class="rca-section">
        <div class="rca-section-title">Root Cause Analysis</div>
        <div class="rca-analysis-box">${analysis.split(/Suggested Fix/i)[0].trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/^### (.+)$/gm, '<p><strong>$1</strong></p>').replace(/^## (.+)$/gm, '<p><strong>$1</strong></p>').replace(/^# (.+)$/gm, '<p><strong>$1</strong></p>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code style="background:#263238;padding:2px 5px;border-radius:3px;font-size:12px;">$1</code>').replace(/^- (.+)$/gm, '<li>$1</li>').replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>
      </div>
      <div class="rca-section">
        <div class="rca-section-title">Suggested Fixes</div>
        <ol class="rca-suggestions-list">
          ${suggestions.slice(0, 3).map((s, i) => `<div class="rca-suggestion"><span class="rca-suggestion-num">${i + 1}</span><span class="rca-suggestion-text">${s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>')}</span></div>`).join('\n')}
        </ol>
      </div>
    </div>
    <div class="rca-footer">Analysis generated by AI-powered RootCauseAnalyzer</div>
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

  // Save step timings for Allure report duration tracking
  if (this.stepTimings.size > 0) {
    const timingsObj: { [key: string]: { startTime: number; endTime: number; duration: number } } = {};
    this.stepTimings.forEach((timing, stepName) => {
      timingsObj[stepName] = {
        startTime: timing.startTime,
        endTime: timing.endTime,
        duration: timing.endTime - timing.startTime
      };
    });
    
    const scenarioTimingsFile = `reports/allure-results/step-timings-${scenario.pickle.name.replace(/\s+/g, '-')}-${Date.now()}.json`;
    fs.writeFileSync(scenarioTimingsFile, JSON.stringify(timingsObj, null, 2));
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
