import { Browser, BrowserContext, Page, chromium, firefox, webkit } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { FrameworkConfig } from '../config/FrameworkConfig';

const ENV = (process.env.ENV as string) || 'qa';
const configPath = path.join(__dirname, '../config/environments.json');
const environments = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const environmentConfig = environments[ENV];

if (!environmentConfig) {
  throw new Error(`Environment "${ENV}" not found in environments.json`);
}

const frameworkConfig = FrameworkConfig.getInstance();

const config = {
  env: ENV,
  browser: frameworkConfig.browser,
  headless: frameworkConfig.headless,
  screenshotOnFail: frameworkConfig.screenshotOnFail,
  video: frameworkConfig.get('video', 'retain-on-failure') as 'on' | 'off' | 'retain-on-failure',
  ...environmentConfig,
};

/**
 * Manages Playwright Browser, BrowserContext, and Page lifecycle.
 */
export class ContextManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  public async launch(): Promise<void> {
    Logger.info(`Launching ${config.browser} browser (headless: ${config.headless})`);

    const browserMap = { chromium, firefox, webkit };
    const browserEngine = browserMap[config.browser as keyof typeof browserMap];
    if (!browserEngine) {
      throw new Error(`Unsupported browser: "${config.browser}". Use chromium, firefox, or webkit.`);
    }

    this.browser = await browserEngine.launch({
      headless: config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    if (!this.browser) {
      throw new Error('Failed to launch browser');
    }

    this.context = await this.browser.newContext({
      baseURL: config.baseUrl,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      recordVideo:
        config.video !== 'off'
          ? {
              dir: 'reports/videos',
              size: { width: 1280, height: 720 },
            }
          : undefined,
    });

    this.context.setDefaultTimeout(config.timeout);
    this.context.setDefaultNavigationTimeout(config.navigationTimeout);

    this.page = await this.context.newPage();
    Logger.info('Browser context and page created successfully');
  }

  public async close(testFailed: boolean = false): Promise<void> {
    if (config.screenshotOnFail && testFailed && this.page) {
      try {
        const screenshotDir = 'reports/screenshots';
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const filename = `failure-${Date.now()}.png`;
        await this.page.screenshot({
          path: path.join(screenshotDir, filename),
          fullPage: true,
        });
        Logger.info(`Failure screenshot saved: ${filename}`);
      } catch (err) {
        Logger.warn(`Could not take failure screenshot: ${err}`);
      }
    }

    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }

    if (this.context) {
      if (config.video === 'retain-on-failure' && !testFailed) {
        await this.context.close().catch(() => {});
      } else {
        await this.context.close().catch(() => {});
      }
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    Logger.info('Browser closed');
  }

  public getPage(): Page {
    if (!this.page) {
      throw new Error(
        'Page is not initialized. Ensure the browser was launched in the Before hook.'
      );
    }
    return this.page;
  }

  public getContext(): BrowserContext {
    if (!this.context) {
      throw new Error('BrowserContext is not initialized.');
    }
    return this.context;
  }

  public getBrowser(): Browser {
    if (!this.browser) {
      throw new Error('Browser is not initialized.');
    }
    return this.browser;
  }

  public async clearCookies(): Promise<void> {
    await this.getContext().clearCookies();
    Logger.info('Cookies cleared');
  }

  public async clearStorage(): Promise<void> {
    await this.getPage().evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    Logger.info('Local & session storage cleared');
  }

  public async saveStorageState(filePath: string): Promise<void> {
    await this.getContext().storageState({ path: filePath });
    Logger.info(`Storage state saved to: ${filePath}`);
  }

  public async loadStorageState(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      Logger.warn(`Storage state file not found: ${filePath}`);
      return;
    }
    Logger.info(`Storage state will be loaded from: ${filePath}`);
  }
}
