import OpenAI from 'openai';
import { Logger } from './Logger';
import * as dotenv from 'dotenv';

dotenv.config();

// Centralized OpenAI API client for self-healing, visual testing, and root cause analysis.
export class OpenAIClient {
  private static instance: OpenAI;

  static getInstance(): OpenAI {
    if (!this.instance) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        Logger.warn('OPENAI_API_KEY not set in environment. OpenAI features will be limited.');
      }
      this.instance = new OpenAI({ apiKey });
    }
    return this.instance;
  }

  static async analyzeScreenshot(
    imageBase64: string,
    context: string
  ): Promise<string> {
    try {
      const client = this.getInstance() as any;
      const response = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Analyze this UI screenshot in the context of automated testing. ${context}. 
                       Provide insights about visual issues, layout problems, or unexpected elements.`,
          },
        ],
      });

      const analysisResult = response.choices[0]?.message?.content || '';
      Logger.info(`Screenshot Analysis: ${analysisResult.substring(0, 100)}...`);
      return analysisResult;
    } catch (error) {
      Logger.error(`Failed to analyze screenshot: ${error}`);
      return 'Screenshot analysis unavailable - could not connect to OpenAI API';
    }
  }

  static async suggestSelfHeal(
    originalLocator: string,
    elementContext: string,
    pageState: string
  ): Promise<string> {
    try {
      const client = this.getInstance() as any;
      const response = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `The following element locator failed in automated testing:
Original Locator: ${originalLocator}
Element Context: ${elementContext}
Current Page State: ${pageState}

Please suggest alternative locators or fixes. Return ONLY the new locator string, nothing else.
Consider using: XPath, CSS selectors, Playwright role= selectors, data-testid, or text= selectors.`,
          },
        ],
      });

      const suggestion = response.choices[0]?.message?.content || '';
      Logger.info(`Self-heal suggestion: ${suggestion}`);
      return suggestion.trim();
    } catch (error) {
      Logger.error(`Failed to generate self-heal suggestion: ${error}`);
      return '';
    }
  }

  static async analyzeFailure(
    failureMessage: string,
    lastActions: string[],
    screenshot?: string
  ): Promise<string> {
    try {
      const client = this.getInstance() as any;

      const response = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Analyze this test automation failure concisely.

Test Error: ${failureMessage}
Recent Actions: ${lastActions.join(' -> ')}

Respond in this EXACT format (no markdown headers, no extra text):

Error Explanation (max 100 words):
<brief explanation of what went wrong>

Possible Root Causes:
1. <cause 1>
2. <cause 2>
3. <cause 3>

Suggested Fixes:
1. <fix 1>
2. <fix 2>
3. <fix 3>`,
          },
        ],
      });

      const analysis = response.choices[0]?.message?.content || '';
      Logger.info(`Failure Analysis: ${analysis.substring(0, 150)}...`);
      return analysis;
    } catch (error) {
      Logger.error(`Failed to analyze failure: ${error}`);
      return 'Failure analysis unavailable - could not connect to OpenAI API';
    }
  }

  static async validateVisuals(
    currentImageBase64: string,
    expectedImageBase64: string,
    testContext: string
  ): Promise<{ match: boolean; feedback: string }> {
    try {
      const client = this.getInstance() as any;
      const response = await client.chat.completions.create({
        model: 'gpt-4-turbo',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Compare the current and expected states. Context: ${testContext}
            
Current visual state vs Expected state. Check if they match visually.
Respond in JSON format: {"match": boolean, "differences": "description of visual differences if any"}`,
          },
        ],
      });

      const result = response.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(result);
        return {
          match: parsed.match || false,
          feedback: parsed.differences || 'No differences detected',
        };
      } catch {
        return {
          match: false,
          feedback: 'Visual validation could not be completed',
        };
      }
    } catch (error) {
      Logger.error(`Failed to validate visuals: ${error}`);
      return { match: false, feedback: 'Visual validation failed - could not connect to OpenAI API' };
    }
  }
}
