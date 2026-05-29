import { Page, Locator } from '@playwright/test';
import { Logger } from '../utils/Logger';
import { OpenAIClient } from '../utils/OpenAIClient';
import { ElementResolver } from './ElementResolver';
import { HealingResult, LocatorCandidate, MatchedElementDetails } from './HealingResult';

// Automatically attempts to fix broken element locators using priority-based fallback strategies and optional OpenAI assistance.
export class SelfHealingEngine {
  private page: Page;
  private locatorCache: Map<string, string> = new Map();
  private healingDetails: Map<string, HealingResult> = new Map();
  private xpathCache: Map<string, string[]> = new Map();
  private attachCallback: ((buffer: Buffer, mimeType: string) => Promise<void>) | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  public setAttachCallback(callback: (buffer: Buffer, mimeType: string) => Promise<void>): void {
    this.attachCallback = callback;
  }

  async findElementWithHealing(
    originalReference: string,
    action: string
  ): Promise<{ element: Locator | null; healingResult: HealingResult }> {
    Logger.debug(`SelfHealing: Finding element with reference: ${originalReference}`);

    const resolvedLocator = this._resolveReference(originalReference);

    if (this.locatorCache.has(originalReference)) {
      const cachedSelector = this.locatorCache.get(originalReference)!;
      const cachedElement = this._buildLocator(cachedSelector);
      try {
        if (await cachedElement.isVisible()) {
          return {
            element: cachedElement,
            healingResult: this._buildSuccessResult(
              originalReference,
              resolvedLocator,
              cachedSelector,
              'Cache hit: previously healed locator still works.'
            ),
          };
        }
      } catch {
        // Cache entry is stale, continue to healing
      }
    }

    const element = this._buildLocator(resolvedLocator);
    if (await this.isElementAccessible(element)) {
      return {
        element,
        healingResult: this._buildSuccessResult(
          originalReference,
          resolvedLocator,
          resolvedLocator,
          'Original resolved locator succeeded on first attempt.'
        ),
      };
    }

    Logger.warn(
      `Original locator failed: ${resolvedLocator} (from ref: ${originalReference}). Attempting self-healing...`
    );

    const xpathAlternatives = await this._extractAndCacheXPaths(originalReference, resolvedLocator);
    
    if (xpathAlternatives && xpathAlternatives.length > 0) {
      for (const xpath of xpathAlternatives) {
        try {
          const xpathElement = this._buildLocator(xpath);
          if (await this.isElementAccessible(xpathElement)) {
            Logger.info(`✓ Found element using generated XPath: ${xpath}`);
            
            return {
              element: xpathElement,
              healingResult: {
                referenceName: originalReference,
                originalLocator: resolvedLocator,
                healingStatus: 'SUCCESS',
                confidence: 90,
                reason: `Original locator "${resolvedLocator}" failed. Succeeded with generated XPath strategy.`,
                bestLocator: {
                  type: 'xpath',
                  locator: xpath,
                  rawSelector: xpath,
                  confidence: 90,
                },
                fallbackLocators: xpathAlternatives.slice(1).map(x => ({
                  type: 'xpath',
                  locator: x,
                  rawSelector: x,
                  confidence: 80,
                })),
                matchedElementDetails: null,
              },
            };
          }
        } catch {
          // This XPath didn't work, try next
        }
      }
    }

    const focusedDOM = await this._extractFocusedDOM(resolvedLocator);

    const openAISuggestions = await this._getOpenAISuggestionsWithCleanedDOM(
      originalReference,
      resolvedLocator,
      focusedDOM
    );

    const prioritizedCandidates = this._generatePrioritizedLocators(resolvedLocator, focusedDOM);

    const allCandidates = [...this._openAISuggestionsToCandidate(openAISuggestions), ...prioritizedCandidates];

    for (const candidate of allCandidates) {
      try {
        const candidateElement = this._buildLocator(candidate.rawSelector);
        if (await this.isElementAccessible(candidateElement)) {
          Logger.info(
            `✓ Self-healed! New locator: ${candidate.rawSelector} (type: ${candidate.type}) for action: ${action}`
          );

          this.locatorCache.set(originalReference, candidate.rawSelector);

          const matchedDetails = await this._extractElementDetails(candidateElement);

          const remainingCandidates = allCandidates.filter((c) => c !== candidate).slice(0, 5);

          const healingResult: HealingResult = {
            referenceName: originalReference,
            originalLocator: resolvedLocator,
            healingStatus: 'SUCCESS',
            confidence: candidate.confidence,
            reason: `Original locator "${resolvedLocator}" failed. Healed using ${candidate.type} strategy.`,
            bestLocator: candidate,
            fallbackLocators: remainingCandidates,
            matchedElementDetails: matchedDetails,
          };

          this.healingDetails.set(originalReference, healingResult);

          // Highlight the healed element and capture screenshot
          try {
            const selector = candidate.rawSelector;
            
            // Try to highlight using the selector
            const highlightResult = await this.page.evaluate((sel) => {
              try {
                const elements = document.querySelectorAll(sel);
                if (elements.length === 0) {
                  return { success: false, count: 0, error: 'No elements found' };
                }
                elements.forEach((el) => {
                  (el as HTMLElement).style.border = '4px solid #00FF00';
                  (el as HTMLElement).style.boxShadow = '0 0 15px rgba(0, 255, 0, 0.9), inset 0 0 10px rgba(0, 255, 0, 0.3)';
                  (el as HTMLElement).style.backgroundColor = 'rgba(0, 255, 0, 0.15)';
                });
                return { success: true, count: elements.length, error: null };
              } catch (e) {
                return { success: false, count: 0, error: String(e) };
              }
            }, selector);

            if (highlightResult.success) {
              Logger.info(`Highlighted ${highlightResult.count} element(s) with selector: ${selector}`);
            } else {
              Logger.warn(`Failed to highlight element: ${highlightResult.error}`);
            }

            // Wait for highlighting to be visible and rendered
            await this.page.waitForTimeout(500);

            // Capture screenshot with highlighted element BEFORE removing highlight
            const screenshotBuffer = await this.page.screenshot({ fullPage: true });
            Logger.info(`Screenshot captured for healed element: ${originalReference}`);

            // Attach to report if callback is available
            if (this.attachCallback) {
              await this.attachCallback(screenshotBuffer, 'image/png');
              Logger.info(`Screenshot attached to report for healed element: ${originalReference}`);
            }

            // NOW remove highlighting after screenshot is captured
            await this.page.evaluate((sel) => {
              try {
                const elements = document.querySelectorAll(sel);
                elements.forEach((el) => {
                  (el as HTMLElement).style.border = '';
                  (el as HTMLElement).style.boxShadow = '';
                  (el as HTMLElement).style.backgroundColor = '';
                });
              } catch (e) {
                // Ignore
              }
            }, selector);
          } catch (error) {
            Logger.warn(`Failed to capture screenshot for healed element: ${error}`);
          }

          return {
            element: candidateElement,
            healingResult,
          };
        }
      } catch {
        // Candidate failed, try next
      }
    }

    Logger.error(
      `Self-healing failed for locator: ${resolvedLocator} (ref: ${originalReference}). No alternative found.`
    );

    return {
      element: null,
      healingResult: {
        referenceName: originalReference,
        originalLocator: resolvedLocator,
        healingStatus: 'FAILED',
        confidence: 0,
        reason: `Could not find alternative locator for "${resolvedLocator}". Tried ${allCandidates.length} candidates.`,
        bestLocator: null,
        fallbackLocators: allCandidates.slice(0, 5),
        matchedElementDetails: null,
      },
    };
  }

  async isElementAccessible(element: Locator): Promise<boolean> {
    try {
      const count = await element.count();
      if (count === 0) return false;

      return await element.first().isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.locatorCache.clear();
    this.healingDetails.clear();
    this.xpathCache.clear();
    Logger.debug('Self-healing cache cleared');
  }

  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.locatorCache.size,
      entries: Array.from(this.locatorCache.keys()),
    };
  }

  getDetailedHealingStats(): Array<{
    reference: string;
    originalLocator: string;
    healedLocator: string;
    type: string;
    confidence: number;
    reason: string;
    elementTag?: string;
    elementText?: string;
  }> {
    const results: Array<{
      reference: string;
      originalLocator: string;
      healedLocator: string;
      type: string;
      confidence: number;
      reason: string;
      elementTag?: string;
      elementText?: string;
    }> = [];

    for (const [reference, healingResult] of this.healingDetails.entries()) {
      if (healingResult.healingStatus === 'SUCCESS' && healingResult.bestLocator) {
        results.push({
          reference,
          originalLocator: healingResult.originalLocator,
          healedLocator: healingResult.bestLocator.rawSelector,
          type: healingResult.bestLocator.type,
          confidence: healingResult.bestLocator.confidence,
          reason: healingResult.reason,
          elementTag: healingResult.matchedElementDetails?.tag,
          elementText: healingResult.matchedElementDetails?.text,
        });
      }
    }

    return results;
  }

  private async _extractAndCacheXPaths(reference: string, locator: string): Promise<string[]> {
    try {
      const xpaths = await this.page.evaluate(
        (selector: string) => {
          let element: HTMLElement | null = null;

          try {
            element = document.querySelector(selector) as HTMLElement;
          } catch {
            const xpathResult = document.evaluate(
              selector,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = xpathResult.singleNodeValue as HTMLElement;
          }

          if (!element) {
            return null;
          }

          const paths = new Set<string>();

          if (element.id) {
            paths.add(`//*[@id='${element.id}']`);
          }

          const testId = element.getAttribute('data-testid');
          if (testId) {
            paths.add(`//*[@data-testid='${testId}']`);
          }

          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) {
            paths.add(`//*[@aria-label='${ariaLabel}']`);
          }

          const className = element.className;
          if (className && typeof className === 'string' && className.trim()) {
            const classes = className.trim().split(/\s+/);
            if (classes.length > 0) {
              const classCondition = classes
                .map(c => `contains(@class, '${c}')`)
                .join(' and ');
              paths.add(`//${element.tagName.toLowerCase()}[${classCondition}]`);
            }
          }

          const text = (element.textContent || '').trim();
          if (text && text.length < 100 && text.length > 0) {
            paths.add(
              `//${element.tagName.toLowerCase()}[contains(text(), '${text.substring(0, 50)}')]`
            );
          }

          const name = element.getAttribute('name');
          if (name) {
            paths.add(`//${element.tagName.toLowerCase()}[@name='${name}']`);
          }

          const placeholder = element.getAttribute('placeholder');
          if (placeholder) {
            paths.add(
              `//${element.tagName.toLowerCase()}[@placeholder='${placeholder}']`
            );
          }

          const parent = element.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(
              (el) => el.tagName === element.tagName
            );
            const index = siblings.indexOf(element) + 1;
            if (siblings.length > 1) {
              paths.add(
                `//${element.tagName.toLowerCase()}[${index}]`
              );
            }
          }

          return Array.from(paths);
        },
        locator
      );

      if (xpaths) {
        this.xpathCache.set(reference, xpaths);
        Logger.debug(`Extracted ${xpaths.length} XPath alternatives for reference: ${reference}`);
        return xpaths;
      }

      return [];
    } catch (error) {
      Logger.debug(`Failed to extract XPaths for reference ${reference}: ${error}`);
      return [];
    }
  }

  private async _getOpenAISuggestionsWithCleanedDOM(
    reference: string,
    originalLocator: string,
    cleanedDOM: string
  ): Promise<string[]> {
    try {
      const suggestion = await OpenAIClient.suggestSelfHeal(
        originalLocator,
        `Reference: ${reference}\nCleaned HTML Context:\n${cleanedDOM.substring(0, 3000)}`,
        'Element not found with original locator'
      );

      if (!suggestion) {
        return [];
      }

      const suggestions = suggestion
        .split('\n')
        .map((line: string) => {
          const cleaned = line
            .replace(/^[-*•]\s*/, '')
            .replace(/^(CSS|XPath):\s*/i, '')
            .trim();
          return cleaned;
        })
        .filter((s: string) => s && s.length > 0);

      Logger.debug(`LLM suggested ${suggestions.length} locators for ${reference}`);
      return suggestions;
    } catch (error) {
      Logger.warn(`Failed to get LLM suggestions: ${error}`);
      return [];
    }
  }

  _resolveReference(reference: string): string {
    const isDotReference = /^[A-Z][A-Za-z0-9]+\.[A-Za-z0-9.]+$/.test(reference);
    if (isDotReference) {
      try {
        return ElementResolver.resolve(reference);
      } catch (error) {
        Logger.warn(`Failed to resolve reference "${reference}": ${error}`);
        return reference;
      }
    }
    return reference;
  }

  _buildLocator(rawLocator: string): Locator {
    if (rawLocator.startsWith('//') || rawLocator.startsWith('(//')) {
      return this.page.locator(rawLocator);
    }

    if (rawLocator.startsWith('text=')) {
      return this.page.locator(rawLocator);
    }

    if (rawLocator.startsWith('placeholder=')) {
      return this.page.getByPlaceholder(rawLocator.replace('placeholder=', ''));
    }

    if (rawLocator.startsWith('role=')) {
      const roleMatch = rawLocator.match(/^role=([a-z]+)(?:\[name='(.+?)'\])?/i);
      if (roleMatch) {
        const role = roleMatch[1] as any;
        const name = roleMatch[2];
        return name
          ? this.page.getByRole(role, { name })
          : this.page.getByRole(role);
      }
    }

    if (rawLocator.startsWith('data-testid=')) {
      return this.page.getByTestId(rawLocator.replace('data-testid=', ''));
    }

    return this.page.locator(rawLocator);
  }

  async _extractFocusedDOM(_resolvedLocator: string): Promise<string> {
    try {
      const result = await this.page.evaluate(() => {
        const body = document.body;
        if (!body) return '';

        const allElements = Array.from(body.querySelectorAll('*'));
        const relevant: string[] = [];

        for (const el of allElements) {
          const attrs: string[] = [];
          const testId = el.getAttribute('data-testid');
          const id = el.id;
          const role = el.getAttribute('role');
          const ariaLabel = el.getAttribute('aria-label');
          const placeholder = el.getAttribute('placeholder');

          if (testId) attrs.push(`data-testid="${testId}"`);
          if (id) attrs.push(`id="${id}"`);
          if (role) attrs.push(`role="${role}"`);
          if (ariaLabel) attrs.push(`aria-label="${ariaLabel}"`);
          if (placeholder) attrs.push(`placeholder="${placeholder}"`);

          if (attrs.length > 0) {
            const tag = el.tagName.toLowerCase();
            const text = (el.textContent || '').trim().substring(0, 50);
            const className = el.className && typeof el.className === 'string'
              ? ` class="${el.className}"`
              : '';
            relevant.push(`<${tag}${className} ${attrs.join(' ')}>${text}</${tag}>`);
          }

          if (relevant.join('\n').length > 2000) break;
        }

        return relevant.join('\n').substring(0, 2000);
      });

      return result || '';
    } catch (error) {
      Logger.warn(`Failed to extract focused DOM: ${error}`);
      return '';
    }
  }

  _generatePrioritizedLocators(resolvedLocator: string, focusedDOM: string): LocatorCandidate[] {
    const candidates: LocatorCandidate[] = [];

    if (!focusedDOM) return candidates;

    const expectedTag = resolvedLocator.match(/^\/\/(\w+)/)?.[1] || '';

    const testIdMatches = focusedDOM.matchAll(/<(\w+)[^>]*data-testid="([^"]+)"[^>]*>([^<]*)/g);
    for (const match of testIdMatches) {
      const tag = match[1];
      const testId = match[2];
      if (expectedTag && tag !== expectedTag) continue;
      candidates.push({
        type: 'data-testid',
        locator: `page.getByTestId('${testId}')`,
        rawSelector: `data-testid=${testId}`,
        confidence: 97,
      });
    }

    const idMatches = focusedDOM.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g);
    for (const match of idMatches) {
      const idTag = match[1];
      const idVal = match[2];
      if (expectedTag && idTag !== expectedTag) continue;
      if (!this._isUnstableId(idVal)) {
        candidates.push({
          type: 'id',
          locator: `page.locator('#${idVal}')`,
          rawSelector: `#${idVal}`,
          confidence: 90,
        });
      }
    }

    const roleMatches = focusedDOM.matchAll(/role="([^"]+)"/g);
    for (const match of roleMatches) {
      const role = match[1];
      const nameMatch = focusedDOM.match(
        new RegExp(`role="${role}"[^>]*aria-label="([^"]+)"`)
      );
      if (nameMatch) {
        candidates.push({
          type: 'role',
          locator: `page.getByRole('${role}', { name: '${nameMatch[1]}' })`,
          rawSelector: `role=${role}[name='${nameMatch[1]}']`,
          confidence: 85,
        });
      } else {
        candidates.push({
          type: 'role',
          locator: `page.getByRole('${role}')`,
          rawSelector: `role=${role}`,
          confidence: 80,
        });
      }
    }

    const ariaLabelMatches = focusedDOM.matchAll(/aria-label="([^"]+)"/g);
    for (const match of ariaLabelMatches) {
      const label = match[1];
      candidates.push({
        type: 'label',
        locator: `page.getByLabel('${label}')`,
        rawSelector: `[aria-label="${label}"]`,
        confidence: 80,
      });
    }

    const placeholderMatches = focusedDOM.matchAll(/placeholder="([^"]+)"/g);
    for (const match of placeholderMatches) {
      const placeholder = match[1];
      candidates.push({
        type: 'placeholder',
        locator: `page.getByPlaceholder('${placeholder}')`,
        rawSelector: `placeholder=${placeholder}`,
        confidence: 75,
      });
    }

    const textMatches = focusedDOM.matchAll(/>([^<]{3,50})</g);
    const seenTexts = new Set<string>();
    for (const match of textMatches) {
      const text = match[1].trim();
      if (text && text.length >= 3 && text.length <= 50 && !seenTexts.has(text)) {
        seenTexts.add(text);
        candidates.push({
          type: 'text',
          locator: `page.locator('text=${text}')`,
          rawSelector: `text=${text}`,
          confidence: 70,
        });
      }
    }

    const classMatches = focusedDOM.matchAll(/class="([^"]+)"/g);
    const seenClasses = new Set<string>();
    for (const match of classMatches) {
      const classes = match[1].split(/\s+/);
      for (const cls of classes) {
        if (cls && !this._isUnstableClass(cls) && !seenClasses.has(cls)) {
          seenClasses.add(cls);
          const selector = `.${cls}`;
          if (!this._isUnstableSelector(selector)) {
            candidates.push({
              type: 'css',
              locator: `page.locator('.${cls}')`,
              rawSelector: selector,
              confidence: 55,
            });
          }
        }
      }
    }

    if (expectedTag === 'button') {
      const buttonTextMatches = focusedDOM.matchAll(/<button[^>]*>([^<]{2,50})<\/button>/g);
      for (const match of buttonTextMatches) {
        const text = match[1].trim();
        if (text) {
          candidates.push({
            type: 'role',
            locator: `page.getByRole('button', { name: '${text}' })`,
            rawSelector: `role=button[name='${text}']`,
            confidence: 88,
          });
        }
      }
    }

    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.rawSelector)) return false;
      seen.add(c.rawSelector);
      return true;
    });

    return deduped.sort((a, b) => b.confidence - a.confidence);
  }

  _isUnstableId(id: string): boolean {
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)) return true;
    if (/^\d{10,}$/.test(id)) return true;
    if (/^[a-f0-9]{8,}$/i.test(id) && !/[a-z]{3,}/i.test(id)) return true;
    return false;
  }

  _isUnstableClass(className: string): boolean {
    if (/^(css|sc|emotion|styled)-[a-z0-9]+$/i.test(className)) return true;
    if (/^[a-z]+-[a-z0-9]{5,}$/i.test(className)) return true;
    return false;
  }

  _isUnstableSelector(selector: string): boolean {
    if (/nth-(child|of-type)/i.test(selector)) return true;
    if ((selector.match(/>/g) || []).length > 4) return true;
    if (selector.length > 150) return true;
    return false;
  }

  async _extractElementDetails(element: Locator): Promise<MatchedElementDetails> {
    try {
      const details = await element.first().evaluate((el) => {
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 100),
          role: el.getAttribute('role') || '',
          id: el.id || '',
          dataTestId: el.getAttribute('data-testid') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          className: el.className && typeof el.className === 'string' ? el.className : '',
        };
      });

      const attributesUsed: string[] = [];
      if (details.dataTestId) attributesUsed.push('data-testid');
      if (details.id) attributesUsed.push('id');
      if (details.role) attributesUsed.push('role');
      if (details.ariaLabel) attributesUsed.push('aria-label');
      if (details.placeholder) attributesUsed.push('placeholder');
      if (details.text) attributesUsed.push('text');
      if (details.className) attributesUsed.push('class');

      return { ...details, attributesUsed };
    } catch {
      return {
        tag: '',
        text: '',
        role: '',
        id: '',
        dataTestId: '',
        ariaLabel: '',
        placeholder: '',
        className: '',
        attributesUsed: [],
      };
    }
  }

  private _openAISuggestionsToCandidate(suggestions: string[]): LocatorCandidate[] {
    return suggestions.map((s, index) => {
      let type: LocatorCandidate['type'] = 'css';
      if (s.startsWith('//') || s.startsWith('(//')) type = 'xpath';
      else if (s.startsWith('text=')) type = 'text';
      else if (s.startsWith('[data-testid')) type = 'data-testid';
      else if (s.startsWith('#')) type = 'id';
      else if (s.startsWith('role=')) type = 'role';
      else if (s.startsWith('placeholder=')) type = 'placeholder';

      return {
        type,
        locator: `page.locator('${s}')`,
        rawSelector: s,
        confidence: Math.max(92 - index * 5, 70),
      };
    });
  }

  private async _getPageState(): Promise<string> {
    try {
      const title = await this.page.title();
      const url = this.page.url();
      return `Page: ${title}, URL: ${url}`;
    } catch {
      return 'Unable to determine page state';
    }
  }

  private _buildSuccessResult(
    referenceName: string,
    originalLocator: string,
    usedSelector: string,
    reason: string
  ): HealingResult {
    return {
      referenceName,
      originalLocator,
      healingStatus: 'SUCCESS',
      confidence: 100,
      reason,
      bestLocator: {
        type: 'css',
        locator: `page.locator('${usedSelector}')`,
        rawSelector: usedSelector,
        confidence: 100,
      },
      fallbackLocators: [],
      matchedElementDetails: null,
    };
  }
}
