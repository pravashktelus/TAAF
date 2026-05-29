import { Page, Locator, expect } from '@playwright/test';
import { ElementResolver } from './ElementResolver';
import { SelfHealingEngine } from './SelfHealingEngine';
import { HealingResult } from './HealingResult';
import { DataStore } from '../utils/DataStore';
import { PersistentStore } from '../utils/PersistentStore';
import { RandomDataGenerator } from '../utils/RandomDataGenerator';
import { Logger } from '../utils/Logger';
import { FrameworkConfig } from '../config/FrameworkConfig';

export type WaitStrategy = 'visible' | 'hidden' | 'attached' | 'detached';
export type ScrollBehavior = 'auto' | 'smooth';

// Maps locator string prefixes to the correct Playwright page locator method and provides self-healing action wrappers.
export class ActionEngine {
  private page: Page;
  private selfHealingEngine: SelfHealingEngine | null = null;
  private visualTestingEngine: any = null;
  private _stepHealingResults: HealingResult[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  public setSelfHealingEngine(engine: SelfHealingEngine): void {
    this.selfHealingEngine = engine;
  }

  public setVisualTestingEngine(engine: any): void {
    this.visualTestingEngine = engine;
  }

  public getStepHealingResults(): HealingResult[] {
    return [...this._stepHealingResults];
  }

  public clearStepHealingResults(): void {
    this._stepHealingResults = [];
  }

  private async getLocatorWithHealing(elementRef: string, action: string): Promise<Locator> {
    const config = FrameworkConfig.getInstance();
    const locator = this.getLocator(elementRef);

    try {
      await locator.waitFor({ state: 'visible', timeout: config.selfHealing.locatorTimeout });
      return locator;
    } catch {
    }

    if (!config.selfHealing.enabled || !this.selfHealingEngine) {
      throw new Error(
        `Element not found: "${elementRef}" — locator timed out waiting for visible state.` +
        (!config.selfHealing.enabled ? ' (self-healing is disabled in framework.properties)' : '')
      );
    }

    Logger.warn(`Locator failed for "${elementRef}". Triggering self-healing...`);

    const { element, healingResult } = await this.selfHealingEngine.findElementWithHealing(
      elementRef,
      action
    );

    if (element && healingResult.healingStatus === 'SUCCESS') {
      Logger.info(
        `✓ Self-healed "${elementRef}": ${healingResult.bestLocator?.rawSelector} ` +
        `(confidence: ${healingResult.confidence}, type: ${healingResult.bestLocator?.type})`
      );
      this._stepHealingResults.push(healingResult);

      // Highlight the healed element and capture screenshot (only for web tests with visualTestingEngine)
      if (this.visualTestingEngine && this.page) {
        try {
          const healedLocator = healingResult.bestLocator?.rawSelector;
          if (healedLocator) {
            // Highlight the healed element with bright green border
            await this.page.evaluate((selector) => {
              try {
                const elements = document.querySelectorAll(selector);
                elements.forEach((el) => {
                  (el as HTMLElement).style.border = '4px solid #00FF00';
                  (el as HTMLElement).style.boxShadow = '0 0 15px rgba(0, 255, 0, 0.9), inset 0 0 10px rgba(0, 255, 0, 0.3)';
                  (el as HTMLElement).style.backgroundColor = 'rgba(0, 255, 0, 0.15)';
                });
              } catch (e) {
                // Ignore selector errors
              }
            }, healedLocator);

            // Wait for highlighting to be visible
            await this.page.waitForTimeout(300);

            // Capture screenshot with highlighted element
            const screenshotPath = await this.visualTestingEngine.captureFullPage(
              `healed_${elementRef.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`
            );
            Logger.info(`Screenshot captured for healed element: ${elementRef}`);

            // Remove highlighting
            await this.page.evaluate((selector) => {
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
          Logger.warn(`Failed to capture screenshot for healed element: ${error}`);
        }
      }

      return element;
    }

    throw new Error(
      `Element not found after self-healing: "${elementRef}"\n` +
      `Original locator failed, and self-healing could not recover.\n` +
      `Reason: ${healingResult.reason}`
    );
  }

  private async highlightAndCaptureHealing(): Promise<void> {
    if (!this.visualTestingEngine || this._stepHealingResults.length === 0) {
      return;
    }

    try {
      const healingResults = this._stepHealingResults;
      
      // Highlight all healed elements
      for (const hr of healingResults) {
        const healedLocator = hr.bestLocator?.rawSelector;
        if (healedLocator) {
          await this.page.evaluate((selector) => {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach((el) => {
                (el as HTMLElement).style.border = '4px solid #00FF00';
                (el as HTMLElement).style.boxShadow = '0 0 15px rgba(0, 255, 0, 0.9), inset 0 0 10px rgba(0, 255, 0, 0.3)';
                (el as HTMLElement).style.backgroundColor = 'rgba(0, 255, 0, 0.15)';
              });
            } catch (e) {
              // Ignore selector errors
            }
          }, healedLocator);
        }
      }

      // Wait for highlighting to be visible
      await this.page.waitForTimeout(300);

      // Capture screenshot with highlighted elements
      const screenshotPath = await this.visualTestingEngine.captureFullPage(
        `healed_action_${Date.now()}`
      );
      Logger.info(`Screenshot captured after action on healed element(s)`);

      // Remove highlighting
      for (const hr of healingResults) {
        const healedLocator = hr.bestLocator?.rawSelector;
        if (healedLocator) {
          await this.page.evaluate((selector) => {
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
      }
    } catch (error) {
      Logger.warn(`Failed to capture screenshot for healed element: ${error}`);
    }
  }

  public getLocator(elementRef: string): Locator {
    const isDotReference = /^[A-Z][A-Za-z0-9\-]+\.[A-Za-z0-9.]+$/.test(elementRef);
    const rawLocator = isDotReference
      ? ElementResolver.resolve(elementRef)
      : elementRef;

    return this.buildLocator(rawLocator);
  }

  private buildLocator(locator: string): Locator {
    if (locator.includes(' >> ')) {
      const parts = locator.split(' >> ');
      let result: Locator = this.resolveSingleLocator(parts[0].trim());
      for (let i = 1; i < parts.length; i++) {
        result = result.locator(this.resolveSingleLocator(parts[i].trim()));
      }
      return result;
    }

    return this.resolveSingleLocator(locator);
  }

  private resolveSingleLocator(locator: string): Locator {
    if (locator.startsWith('//') || locator.startsWith('(//')) {
      return this.page.locator(locator);
    }

    if (locator.startsWith('text=')) {
      return this.page.locator(locator);
    }

    if (locator.startsWith('placeholder=')) {
      return this.page.getByPlaceholder(locator.replace('placeholder=', ''));
    }

    if (locator.startsWith('role=')) {
      const roleMatch = locator.match(/^role=([a-z]+)(?:\[name='(.+?)'\])?/i);
      if (roleMatch) {
        const role = roleMatch[1] as any;
        const name = roleMatch[2];
        return name
          ? this.page.getByRole(role, { name })
          : this.page.getByRole(role);
      }
    }

    if (locator.startsWith('data-testid=')) {
      return this.page.getByTestId(locator.replace('data-testid=', ''));
    }

    return this.page.locator(locator);
  }

  private resolveValue(value: string): string {
    let resolved = value;
    resolved = RandomDataGenerator.resolve(resolved);
    resolved = PersistentStore.resolve(resolved);
    resolved = resolved.replace(/\{(\w+)\}/g, (_, key) => {
      const stored = DataStore.get(key);
      if (stored === undefined) {
        Logger.warn(`DataStore variable "${key}" not found. Using literal text.`);
        return `{${key}}`;
      }
      return String(stored);
    });
    return resolved;
  }

  // Highlights element with green border for visual verification feedback
  private async highlightElement(locator: Locator): Promise<void> {
    try {
      await locator.evaluate((el) => {
        const prev = el.style.cssText;
        el.style.outline = '3px solid #4CAF50';
        el.style.outlineOffset = '2px';
        el.setAttribute('data-highlighted', prev);
        setTimeout(() => {
          el.style.cssText = el.getAttribute('data-highlighted') || '';
          el.removeAttribute('data-highlighted');
        }, 1500);
      });
    } catch {
      // Highlight is best-effort, don't fail the test
    }
  }

  public async click(elementRef: string): Promise<void> {
    Logger.info(`Clicking: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'click');
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }

  public async doubleClick(elementRef: string): Promise<void> {
    Logger.info(`Double-clicking: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'doubleClick');
    await locator.scrollIntoViewIfNeeded();
    await locator.dblclick();
  }

  public async rightClick(elementRef: string): Promise<void> {
    Logger.info(`Right-clicking: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'rightClick');
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ button: 'right' });
  }

  public async enter(value: string, elementRef: string): Promise<void> {
    const resolvedValue = this.resolveValue(value);
    Logger.info(`Entering "${resolvedValue}" into: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'enter');
    await locator.scrollIntoViewIfNeeded();
    await locator.clear();
    await locator.fill(resolvedValue);
  }

  public async clearAndType(value: string, elementRef: string): Promise<void> {
    const resolvedValue = this.resolveValue(value);
    Logger.info(`Typing "${resolvedValue}" into: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'type');
    await locator.scrollIntoViewIfNeeded();
    await locator.clear();
    await locator.type(resolvedValue, { delay: 50 });
  }

  public async pressKey(key: string, elementRef?: string): Promise<void> {
    Logger.info(`Pressing key "${key}"${elementRef ? ` on: ${elementRef}` : ''}`);
    if (elementRef) {
      await this.getLocator(elementRef).press(key);
    } else {
      await this.page.keyboard.press(key);
    }
  }

  public async selectOption(value: string, elementRef: string): Promise<void> {
    const resolvedValue = this.resolveValue(value);
    Logger.info(`Selecting "${resolvedValue}" in: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'select');
    const options = await locator.locator('option').allTextContents();
    const matchByLabel = options.some(
      (opt) => opt.trim().toLowerCase() === resolvedValue.toLowerCase()
    );
    if (matchByLabel) {
      await locator.selectOption({ label: resolvedValue });
    } else {
      await locator.selectOption(resolvedValue);
    }
  }

  public async selectComboboxOption(optionText: string, dropdownRef: string): Promise<void> {
    const resolvedOption = this.resolveValue(optionText);
    Logger.info(`Selecting "${resolvedOption}" from combobox: ${dropdownRef}`);
    
    const dropdown = await this.getLocatorWithHealing(dropdownRef, 'select');
    
    try {
      // Try selectOption first - works with <select> and many combobox implementations
      await dropdown.selectOption({ label: resolvedOption });
      Logger.info(`✓ Selected "${optionText}" using selectOption API`);
      return;
    } catch (error) {
      // If not a select element, fall back to click approach for custom comboboxes
      const errorMsg = String(error);
      if (!errorMsg.includes('not a <select> element')) {
        // If it's a different error, throw it
        throw error;
      }
      Logger.info(`Element is not a standard <select>, using click approach...`);
    }
    
    // For custom combobox elements (divs, buttons, etc), use click approach
    try {
      await dropdown.scrollIntoViewIfNeeded();
      await dropdown.click();
      await this.page.waitForTimeout(300);
      
      const option = this.page.locator(`text=${optionText}`).first();
      await expect(option).toBeVisible({ timeout: 5000 });
      await option.click();
      await this.page.waitForTimeout(300);
      
      Logger.info(`✓ Selected "${optionText}" using click approach`);
    } catch (error) {
      throw new Error(`Failed to select "${optionText}" from combobox "${dropdownRef}". Error: ${error}`);
    }
  }

  public async check(elementRef: string): Promise<void> {
    Logger.info(`Checking: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'check');
    await locator.check();
  }

  public async uncheck(elementRef: string): Promise<void> {
    Logger.info(`Unchecking: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'uncheck');
    await locator.uncheck();
  }

  public async hover(elementRef: string): Promise<void> {
    Logger.info(`Hovering over: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'hover');
    await locator.hover();
  }

  public async scrollTo(elementRef: string): Promise<void> {
    Logger.info(`Scrolling to: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'scroll');
    await locator.scrollIntoViewIfNeeded();
  }

  public async uploadFile(filePath: string, elementRef: string): Promise<void> {
    Logger.info(`Uploading file "${filePath}" to: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'upload');
    
    // Try standard file input first
    const inputFile = locator.locator('input[type="file"]').first();
    const hasFileInput = await inputFile.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (hasFileInput) {
      // Standard <input type="file"> element
      await inputFile.setInputFiles(filePath);
    } else {
      // Custom upload element (div/button that opens file dialog)
      // Promise.all() to handle the file chooser dialog that might appear
      await Promise.all([
        this.page.waitForEvent('filechooser'),
        locator.click(),
      ]).then(async ([fileChooser]) => {
        await fileChooser.setFiles(filePath);
      });
    }
    
    Logger.info(`✓ File uploaded: ${filePath}`);
  }

  public async dragAndDrop(sourceRef: string, targetRef: string): Promise<void> {
    Logger.info(`Dragging "${sourceRef}" to "${targetRef}"`);
    const source = await this.getLocatorWithHealing(sourceRef, 'drag');
    const target = await this.getLocatorWithHealing(targetRef, 'drop');
    await source.dragTo(target);
  }

  public async navigateTo(url: string): Promise<void> {
    const resolvedUrl = this.resolveValue(url);
    Logger.info(`Navigating to: ${resolvedUrl}`);
    const config = FrameworkConfig.getInstance();
    if (config.get('app.maximizeBrowser', 'true') === 'true') {
      await this.page.evaluate(() => {
        window.moveTo(0, 0);
        window.resizeTo(screen.availWidth, screen.availHeight);
      }).catch(() => {});
      await this.page.setViewportSize({ width: 1920, height: 1080 });
    }
    await this.page.goto(resolvedUrl, { waitUntil: 'domcontentloaded' });
  }

  public async goBack(): Promise<void> {
    Logger.info('Navigating back');
    await this.page.goBack();
  }

  public async goForward(): Promise<void> {
    Logger.info('Navigating forward');
    await this.page.goForward();
  }

  public async refreshPage(): Promise<void> {
    Logger.info('Refreshing page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  public async waitForElement(
    elementRef: string,
    state: WaitStrategy = 'visible',
    timeout?: number
  ): Promise<void> {
    Logger.info(`Waiting for "${elementRef}" to be ${state}`);
    if (state === 'visible' && this.selfHealingEngine) {
      const locator = await this.getLocatorWithHealing(elementRef, 'waitFor');
      await locator.waitFor({ state, timeout });
    } else {
      await this.getLocator(elementRef).waitFor({ state, timeout });
    }
  }

  public async waitForNavigation(url?: string): Promise<void> {
    Logger.info(`Waiting for navigation${url ? ` to ${url}` : ''}`);
    await this.page.waitForURL(url || /.*/, { waitUntil: 'domcontentloaded' });
  }

  public async waitForSeconds(seconds: number): Promise<void> {
    Logger.warn(`Explicit wait for ${seconds}s — consider replacing with a proper wait`);
    await this.page.waitForTimeout(seconds * 1000);
  }

  public async assertVisible(elementRef: string): Promise<void> {
    Logger.info(`Asserting visible: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertVisible');
    await expect(locator).toBeVisible();
    await this.highlightElement(locator);
  }

  public async assertHidden(elementRef: string): Promise<void> {
    Logger.info(`Asserting hidden: ${elementRef}`);
    await expect(this.getLocator(elementRef)).toBeHidden();
  }

  public async assertText(elementRef: string, expectedText: string): Promise<void> {
    const resolved = this.resolveValue(expectedText);
    Logger.info(`Asserting text "${resolved}" on: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertText');
    await expect(locator).toHaveText(resolved);
    await this.highlightElement(locator);
  }

  public async assertContainsText(elementRef: string, expectedText: string): Promise<void> {
    const resolved = this.resolveValue(expectedText);
    Logger.info(`Asserting contains text "${resolved}" on: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertContainsText');
    await expect(locator).toContainText(resolved);
    await this.highlightElement(locator);
  }

  public async assertValue(elementRef: string, expectedValue: string): Promise<void> {
    const resolved = this.resolveValue(expectedValue);
    Logger.info(`Asserting value "${resolved}" on: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertValue');
    await expect(locator).toHaveValue(resolved);
    await this.highlightElement(locator);
  }

  public async assertEnabled(elementRef: string): Promise<void> {
    Logger.info(`Asserting enabled: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertEnabled');
    await expect(locator).toBeEnabled();
    await this.highlightElement(locator);
  }

  public async assertDisabled(elementRef: string): Promise<void> {
    Logger.info(`Asserting disabled: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertDisabled');
    await expect(locator).toBeDisabled();
    await this.highlightElement(locator);
  }

  public async assertChecked(elementRef: string): Promise<void> {
    Logger.info(`Asserting checked: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertChecked');
    await expect(locator).toBeChecked();
    await this.highlightElement(locator);
  }

  public async assertCount(elementRef: string, count: number): Promise<void> {
    Logger.info(`Asserting count ${count} for: ${elementRef}`);
    await expect(this.getLocator(elementRef)).toHaveCount(count);
  }

  public async assertPageTitle(expectedTitle: string): Promise<void> {
    const resolved = this.resolveValue(expectedTitle);
    Logger.info(`Asserting page title: "${resolved}"`);
    await expect(this.page).toHaveTitle(resolved);
  }

  public async assertPageUrl(expectedUrl: string): Promise<void> {
    const resolved = this.resolveValue(expectedUrl);
    Logger.info(`Asserting page URL contains: "${resolved}"`);
    await expect(this.page).toHaveURL(new RegExp(resolved));
  }

  public async assertAttribute(
    elementRef: string,
    attribute: string,
    expectedValue: string
  ): Promise<void> {
    const resolved = this.resolveValue(expectedValue);
    Logger.info(`Asserting attr "${attribute}"="${resolved}" on: ${elementRef}`);
    const locator = await this.getLocatorWithHealing(elementRef, 'assertAttribute');
    await expect(locator).toHaveAttribute(attribute, resolved);
    await this.highlightElement(locator);
  }

  public async getText(elementRef: string): Promise<string> {
    const locator = await this.getLocatorWithHealing(elementRef, 'getText');
    const text = await locator.innerText();
    Logger.debug(`Got text from "${elementRef}": "${text}"`);
    return text;
  }

  public async getAttribute(elementRef: string, attribute: string): Promise<string | null> {
    const locator = await this.getLocatorWithHealing(elementRef, 'getAttribute');
    const value = await locator.getAttribute(attribute);
    Logger.debug(`Got attribute "${attribute}" from "${elementRef}": "${value}"`);
    return value;
  }

  public async storeText(elementRef: string, variableName: string): Promise<void> {
    const text = await this.getText(elementRef);
    DataStore.set(variableName, text);
    Logger.info(`Stored text "${text}" as variable "${variableName}"`);
  }

  public async storeAttribute(
    elementRef: string,
    attribute: string,
    variableName: string
  ): Promise<void> {
    const value = await this.getAttribute(elementRef, attribute);
    DataStore.set(variableName, value ?? '');
    Logger.info(`Stored attribute "${attribute}" value "${value}" as variable "${variableName}"`);
  }

  public async takeScreenshot(name?: string): Promise<Buffer> {
    const screenshotName = name || `screenshot-${Date.now()}`;
    Logger.info(`Taking screenshot: ${screenshotName}`);
    return await this.page.screenshot({
      path: `reports/screenshots/${screenshotName}.png`,
      fullPage: false,
    });
  }

  public async executeScript<T>(script: string, ...args: any[]): Promise<T> {
    Logger.info(`Executing script: ${script.substring(0, 80)}...`);
    return await this.page.evaluate(script, ...args) as T;
  }

  public async scrollToBottom(): Promise<void> {
    Logger.info('Scrolling to bottom of page');
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  public async scrollToTop(): Promise<void> {
    Logger.info('Scrolling to top of page');
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  public async switchToFrame(frameLocator: string): Promise<void> {
    Logger.info(`Switching to frame: ${frameLocator}`);
  }

  public async acceptAlert(): Promise<void> {
    Logger.info('Accepting alert dialog');
    this.page.once('dialog', (dialog) => dialog.accept());
  }

  public async dismissAlert(): Promise<void> {
    Logger.info('Dismissing alert dialog');
    this.page.once('dialog', (dialog) => dialog.dismiss());
  }

  public async getAlertText(): Promise<string> {
    return new Promise((resolve) => {
      this.page.once('dialog', (dialog) => {
        resolve(dialog.message());
        dialog.accept();
      });
    });
  }
}
