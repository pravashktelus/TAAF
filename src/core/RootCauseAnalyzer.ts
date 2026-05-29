import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { OpenAIClient } from '../utils/OpenAIClient';

// Context object describing a test failure for root cause analysis.
export interface TestFailureContext {
  scenarioName: string;
  failureMessage: string;
  errorStack?: string;
  lastActions: string[];
  pageUrl: string;
  pageTitle: string;
  elements?: { selector: string; error: string }[];
  apiResponses?: { endpoint: string; status: number; error?: string }[];
  screenshot?: string;
}

/**
 * Analyzes test failures using OpenAI to determine root causes and suggest fixes.
 */
export class RootCauseAnalyzer {
  private page: Page;
  private actionHistory: string[] = [];
  private failureReportDir: string;
  private maxHistorySize: number = 20;

  constructor(page: Page) {
    this.page = page;
    this.failureReportDir = 'reports/failure-analysis';
    this._ensureReportDir();
  }

  recordAction(action: string): void {
    this.actionHistory.push(`${new Date().toISOString()}: ${action}`);
    if (this.actionHistory.length > this.maxHistorySize) {
      this.actionHistory.shift();
    }
  }

  async analyzeFailure(
    context: TestFailureContext
  ): Promise<{ analysis: string; suggestions: string[]; report: string }> {
    try {
      Logger.info(`Analyzing failure: ${context.scenarioName}`);

      const pageState = await this._capturePageState();

      const enhancedContext = {
        ...context,
        pageState,
        actionHistory: this.actionHistory,
      };

      let analysis: string;
      try {
        analysis = await OpenAIClient.analyzeFailure(
          context.failureMessage,
          context.lastActions,
          context.screenshot
        );
      } catch {
        // Fallback to local analysis when OpenAI is unavailable
        analysis = this._generateLocalAnalysis(context);
      }

      // If OpenAI returned empty or unavailable, use local analysis
      if (!analysis || analysis.includes('unavailable') || analysis.includes('could not connect')) {
        analysis = this._generateLocalAnalysis(context);
      }

      const suggestions = await this._generateSuggestions(enhancedContext, analysis);

      const report = await this._generateReport(
        context,
        analysis,
        suggestions
      );

      Logger.info(`Failure analysis complete. Report: ${report}`);

      return { analysis, suggestions, report };
    } catch (error) {
      Logger.error(`Failure analysis error: ${error}`);
      // Even on error, generate a local analysis report
      const localAnalysis = this._generateLocalAnalysis(context);
      const suggestions = this._extractLocalSuggestions(context);
      const report = await this._generateReport(context, localAnalysis, suggestions);
      return {
        analysis: localAnalysis,
        suggestions,
        report,
      };
    }
  }

  private _generateLocalAnalysis(context: TestFailureContext): string {
    const msg = context.failureMessage.toLowerCase();
    const parts: string[] = [];

    parts.push('Error Explanation:');

    if (msg.includes('timeout') || msg.includes('waiting for')) {
      parts.push('The element was not found within the configured timeout period. This typically indicates the element is not present on the page, is hidden, or the page has not fully loaded.');
    } else if (msg.includes('not an <input>') || msg.includes('not an <textarea>') || msg.includes('contenteditable')) {
      parts.push('The locator resolved to a non-editable element (not an input, textarea, select, or contenteditable). The self-healing engine likely matched the wrong element on the page.');
    } else if (msg.includes('locator resolved to') && msg.includes('fill')) {
      parts.push('The fill/clear action was attempted on an element that does not support text input. The locator is pointing to the wrong element.');
    } else if (msg.includes('not found') || msg.includes('no element')) {
      parts.push('The target element could not be found on the page. The locator may be outdated or the page structure has changed.');
    } else if (msg.includes('detached') || msg.includes('removed from')) {
      parts.push('The element was removed from the DOM during interaction. This often happens with dynamic content or page transitions.');
    } else if (msg.includes('intercepted') || msg.includes('click')) {
      parts.push('The click action was intercepted by another element (overlay, modal, or tooltip). The target element may be obscured.');
    } else {
      parts.push(`A test failure occurred: ${context.failureMessage.substring(0, 200)}`);
    }

    parts.push('');
    parts.push('Possible Root Causes:');

    if (msg.includes('self-heal') || msg.includes('healed') || msg.includes('text=')) {
      parts.push('1. Self-healing resolved to an incorrect element (low confidence match)');
      parts.push('2. The original locator in the properties file is outdated');
      parts.push('3. The page structure has changed since the locator was defined');
    } else if (msg.includes('timeout')) {
      parts.push('1. Element is dynamically loaded and not yet rendered');
      parts.push('2. Network latency causing slow page load');
      parts.push('3. Element is conditionally rendered and the condition is not met');
    } else {
      parts.push('1. Locator mismatch — the element selector does not match the current DOM');
      parts.push('2. Page structure or UI has been updated');
      parts.push('3. Test data or application state is not as expected');
    }

    parts.push('');
    parts.push('Suggested Fixes:');
    parts.push('1. Update the locator in the properties file to match the current page structure');
    parts.push('2. Add explicit waits or verify the element is visible before interacting');
    parts.push('3. Run the test in headed mode to visually confirm the page state');

    return parts.join('\n');
  }

  private _extractLocalSuggestions(context: TestFailureContext): string[] {
    const msg = context.failureMessage.toLowerCase();
    const suggestions: string[] = [];

    if (msg.includes('not an <input>') || msg.includes('fill')) {
      suggestions.push('Update the locator to target the correct input/textarea element');
      suggestions.push('Check if the self-healing engine matched the wrong element');
      suggestions.push('Verify the element type in browser DevTools before updating the locator');
    } else if (msg.includes('timeout')) {
      suggestions.push('Increase the element timeout or add an explicit wait');
      suggestions.push('Verify the element exists on the page in the current state');
      suggestions.push('Check if a preceding step failed to navigate to the correct page');
    } else {
      suggestions.push('Review and update the element locator in the properties file');
      suggestions.push('Run the test in headed mode to observe the actual page state');
      suggestions.push('Check recent application changes that may have affected the UI');
    }

    return suggestions;
  }

  private async _generateSuggestions(
    context: any,
    analysis: string
  ): Promise<string[]> {
    const suggestions: string[] = [];

    const lines = analysis.split('\n');
    let inSuggestions = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('suggested fix') || line.toLowerCase().includes('fix:')) {
        inSuggestions = true;
        continue;
      }
      if (inSuggestions && /^\d+\./.test(line.trim())) {
        suggestions.push(line.trim().replace(/^\d+\.\s*/, ''));
      }
    }

    if (suggestions.length === 0) {
      const failureMsg = context.failureMessage.toLowerCase();
      if (failureMsg.includes('timeout')) suggestions.push('Increase wait timeout or check if element is dynamically loaded');
      if (failureMsg.includes('not found')) suggestions.push('Verify element locator is still valid on the page');
      if (failureMsg.includes('401')) suggestions.push('Check authentication — session may have expired');
    }

    return suggestions.slice(0, 3);
  }

  private async _generateReport(
    context: TestFailureContext,
    analysis: string,
    suggestions: string[]
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    const reportName = `failure_${Date.now()}.md`;
    const reportPath = path.join(this.failureReportDir, reportName);

    const report = `# Test Failure Report
Generated: ${timestamp}

## Scenario
${context.scenarioName}

## Failure Message
\`\`\`
${context.failureMessage}
\`\`\`

${context.errorStack ? `## Stack Trace
\`\`\`
${context.errorStack}
\`\`\`

` : ''}## Page Context
- **URL**: ${context.pageUrl}
- **Title**: ${context.pageTitle}

## Recent Actions
${context.lastActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

## Root Cause Analysis
${analysis}

## Suggested Fixes
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${context.elements && context.elements.length > 0 ? `
## Element Issues
${context.elements.map((e) => `- **${e.selector}**: ${e.error}`).join('\n')}
` : ''}${context.apiResponses && context.apiResponses.length > 0 ? `
## API Response Issues
${context.apiResponses
  .map(
    (r) => `- **${r.endpoint}**: Status ${r.status}${r.error ? ` - ${r.error}` : ''}`
  )
  .join('\n')}
` : ''}## Additional Debugging Steps
1. Review the screenshot capture for visual context
2. Check console logs for JavaScript errors
3. Verify network requests in browser DevTools
4. Run the scenario in isolation to confirm issue
5. Check recent code changes that might affect this test

---
*Report generated by RootCauseAnalyzer*`;

    fs.writeFileSync(reportPath, report);
    Logger.info(`Failure report generated: ${reportName}`);
    return reportName;
  }

  private async _capturePageState(): Promise<string> {
    try {
      const title = await this.page.title();
      const url = this.page.url();
      const elementCount = await this.page.locator('*').count();

      const logs: string[] = [];
      this.page.on('console', (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
      });

      return `Title: ${title}\nURL: ${url}\nElements: ${elementCount}\nLogs: ${logs.join('; ') || 'None'}`;
    } catch (error) {
      return 'Unable to capture page state';
    }
  }

  async analyzeAPIFailure(
    endpoint: string,
    statusCode: number,
    response: any,
    expectedBehavior: string
  ): Promise<string> {
    try {
      const failureContext: TestFailureContext = {
        scenarioName: 'API Test',
        failureMessage: `API call to ${endpoint} returned ${statusCode}`,
        lastActions: [
          `POST/GET ${endpoint}`,
          `Status Code: ${statusCode}`,
          `Response: ${JSON.stringify(response).substring(0, 200)}`,
        ],
        pageUrl: endpoint,
        pageTitle: `API - ${statusCode}`,
        apiResponses: [
          {
            endpoint,
            status: statusCode,
            error: JSON.stringify(response),
          },
        ],
      };

      const { analysis, suggestions } = await this.analyzeFailure(
        failureContext
      );
      return `${analysis}\n\nSuggestions: ${suggestions.join(', ')}`;
    } catch (error) {
      Logger.error(`API failure analysis error: ${error}`);
      return 'API analysis failed';
    }
  }

  getCommonPatterns(): { pattern: string; count: number }[] {
    const reports = fs.readdirSync(this.failureReportDir);
    const patterns: Map<string, number> = new Map();

    reports.forEach((file) => {
      try {
        const content = fs.readFileSync(
          path.join(this.failureReportDir, file),
          'utf-8'
        );
        const lines = content.split('\n');
        const failureMsg = lines.find((l) => l.includes('Failure Message'));
        if (failureMsg) {
          const pattern = failureMsg.substring(0, 50);
          patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
        }
      } catch {
      }
    });

    return Array.from(patterns)
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count);
  }

  clearHistory(): void {
    this.actionHistory = [];
    Logger.debug('Action history cleared');
  }

  private _ensureReportDir(): void {
    if (!fs.existsSync(this.failureReportDir)) {
      fs.mkdirSync(this.failureReportDir, { recursive: true });
    }
  }
}
