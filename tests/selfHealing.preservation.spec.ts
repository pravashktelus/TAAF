/**
 * Preservation Property Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Property 2: Non-Self-Healing Paths Remain Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests verify EXISTING correct behavior that must be preserved after
 * the self-healing locator fix is implemented. They encode the observation-first
 * methodology: observe what works now, then ensure it still works after the fix.
 *
 * On UNFIXED code, these tests PASS — confirming baseline behavior.
 * After the fix, these tests must STILL PASS — confirming no regressions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ElementResolver } from '../src/core/ElementResolver';

// Mock OpenAI to avoid real API calls
vi.mock('../src/utils/OpenAIClient', () => ({
  OpenAIClient: {
    suggestSelfHeal: vi.fn().mockResolvedValue(''),
    analyzeFailure: vi.fn().mockResolvedValue(''),
    analyzeScreenshot: vi.fn().mockResolvedValue(''),
    validateVisuals: vi.fn().mockResolvedValue({ match: false, feedback: '' }),
  },
}));

// Mock Logger to suppress output during tests
vi.mock('../src/utils/Logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    scenario: vi.fn(),
  },
}));

import { SelfHealingEngine } from '../src/core/SelfHealingEngine';
import { ActionEngine } from '../src/core/ActionEngine';
import { OpenAIClient } from '../src/utils/OpenAIClient';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Get all valid Page.Element references from .properties files
 */
function getValidPageElementReferences(): Array<{ reference: string; resolvedLocator: string }> {
  const pages = ElementResolver.listAvailablePages();
  const references: Array<{ reference: string; resolvedLocator: string }> = [];

  for (const page of pages) {
    const properties = ElementResolver.loadPage(page);
    for (const [key, locator] of Object.entries(properties)) {
      references.push({ reference: `${page}.${key}`, resolvedLocator: locator });
    }
  }

  return references;
}

/**
 * Create a mock Playwright Page where the element IS found (accessible)
 */
function createMockPageWithElementFound() {
  const locatorCalls: string[] = [];

  const mockLocator = {
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnThis(),
    isVisible: vi.fn().mockResolvedValue(true),
    waitFor: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnThis(),
    allTextContents: vi.fn().mockResolvedValue([]),
  };

  const mockPage = {
    locator: vi.fn((selector: string) => {
      locatorCalls.push(selector);
      return mockLocator;
    }),
    getByPlaceholder: vi.fn(() => mockLocator),
    getByRole: vi.fn(() => mockLocator),
    getByTestId: vi.fn(() => mockLocator),
    content: vi.fn().mockResolvedValue('<html><body><div class="app_logo">Logo</div></body></html>'),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: vi.fn().mockResolvedValue('<div class="app_logo">Logo</div>'),
  };

  return { mockPage, locatorCalls, mockLocator };
}

/**
 * Create a mock Playwright Page where the element is NOT found
 */
function createMockPageWithElementNotFound() {
  const locatorCalls: string[] = [];

  const mockLocator = {
    count: vi.fn().mockResolvedValue(0),
    first: vi.fn().mockReturnThis(),
    isVisible: vi.fn().mockResolvedValue(false),
    waitFor: vi.fn().mockResolvedValue(undefined),
  };

  const mockPage = {
    locator: vi.fn((selector: string) => {
      locatorCalls.push(selector);
      return mockLocator;
    }),
    getByPlaceholder: vi.fn(() => mockLocator),
    getByRole: vi.fn(() => mockLocator),
    getByTestId: vi.fn(() => mockLocator),
    content: vi.fn().mockResolvedValue('<html><body></body></html>'),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: vi.fn().mockResolvedValue(''),
  };

  return { mockPage, locatorCalls, mockLocator };
}

// ─── Property-Based Tests ────────────────────────────────────────────────────

describe('Preservation Property Tests: Non-Self-Healing Paths', () => {
  const validReferences = getValidPageElementReferences();

  // Arbitrary that generates valid Page.Element references
  const pageElementReferenceArb = fc.constantFrom(
    ...validReferences.map((r) => r.reference)
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Property 1: ActionEngine.getLocator() resolves Page.Element references
  // ─────────────────────────────────────────────────────────────────────────

  describe('Property 1: ActionEngine.getLocator() resolves Page.Element references correctly', () => {
    it('for all valid Page.Element references, getLocator() resolves through ElementResolver and builds a Playwright locator', () => {
      fc.assert(
        fc.property(pageElementReferenceArb, (reference) => {
          const { mockPage } = createMockPageWithElementFound();
          const engine = new ActionEngine(mockPage as any);

          // Get the expected resolved locator from ElementResolver
          const expectedLocator = ElementResolver.resolve(reference);

          // ActionEngine.getLocator should resolve the reference
          const locator = engine.getLocator(reference);

          // The locator should have been created (not throw)
          expect(locator).toBeDefined();

          // Verify the mock page was called with the resolved locator (not the raw reference)
          // ActionEngine uses buildLocator which may call page.locator, getByPlaceholder, etc.
          // depending on the prefix of the resolved locator
          if (expectedLocator.startsWith('//') || expectedLocator.startsWith('(//')) {
            expect(mockPage.locator).toHaveBeenCalledWith(expectedLocator);
          } else if (expectedLocator.startsWith('text=')) {
            expect(mockPage.locator).toHaveBeenCalledWith(expectedLocator);
          } else if (expectedLocator.startsWith('placeholder=')) {
            expect(mockPage.getByPlaceholder).toHaveBeenCalledWith(
              expectedLocator.replace('placeholder=', '')
            );
          } else if (expectedLocator.startsWith('role=')) {
            expect(mockPage.getByRole).toHaveBeenCalled();
          } else if (expectedLocator.startsWith('data-testid=')) {
            expect(mockPage.getByTestId).toHaveBeenCalledWith(
              expectedLocator.replace('data-testid=', '')
            );
          } else if (expectedLocator.includes(' >> ')) {
            // Chained locators are split into multiple calls
            const parts = expectedLocator.split(' >> ');
            expect(mockPage.locator).toHaveBeenCalledWith(parts[0].trim());
          } else {
            // CSS selector (default)
            expect(mockPage.locator).toHaveBeenCalledWith(expectedLocator);
          }
        }),
        { numRuns: validReferences.length, seed: 42 }
      );
    });

    it('getLocator() does NOT pass raw Page.Element reference to page.locator()', () => {
      fc.assert(
        fc.property(pageElementReferenceArb, (reference) => {
          const { mockPage, locatorCalls } = createMockPageWithElementFound();
          const engine = new ActionEngine(mockPage as any);

          engine.getLocator(reference);

          // The raw reference (e.g., "Home.Logo") should never be passed directly
          expect(locatorCalls).not.toContain(reference);
        }),
        { numRuns: validReferences.length, seed: 42 }
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Property 2: SelfHealingEngine cache operations work correctly
  // ─────────────────────────────────────────────────────────────────────────

  describe('Property 2: SelfHealingEngine cache operations work correctly', () => {
    it('clearCache() empties the locator cache', () => {
      // Arbitrary for cache entries: key-value pairs of locator strings
      const cacheEntryArb = fc.array(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.string({ minLength: 1, maxLength: 50 })
        ),
        { minLength: 0, maxLength: 10 }
      );

      fc.assert(
        fc.property(cacheEntryArb, (entries) => {
          const { mockPage } = createMockPageWithElementFound();
          const engine = new SelfHealingEngine(mockPage as any);

          // Manually populate the cache via the private locatorCache map
          const cacheMap = (engine as any).locatorCache as Map<string, string>;
          for (const [key, value] of entries) {
            cacheMap.set(key, value);
          }

          // Verify cache has entries (if we added any)
          expect(engine.getCacheStats().size).toBe(entries.length);

          // Clear the cache
          engine.clearCache();

          // After clearing, cache must be empty
          expect(engine.getCacheStats().size).toBe(0);
          expect(engine.getCacheStats().entries).toEqual([]);
        }),
        { numRuns: 50, seed: 42 }
      );
    });

    it('getCacheStats() returns { size: 0, entries: [] } on a fresh instance', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new SelfHealingEngine(mockPage as any);

      const stats = engine.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it('after caching a locator, getCacheStats().size increases', () => {
      const locatorKeyArb = fc.string({ minLength: 1, maxLength: 30 });
      const locatorValueArb = fc.string({ minLength: 1, maxLength: 50 });

      fc.assert(
        fc.property(locatorKeyArb, locatorValueArb, (key, value) => {
          const { mockPage } = createMockPageWithElementFound();
          const engine = new SelfHealingEngine(mockPage as any);

          // Initial state
          expect(engine.getCacheStats().size).toBe(0);

          // Add to cache
          const cacheMap = (engine as any).locatorCache as Map<string, string>;
          cacheMap.set(key, value);

          // Cache size should increase
          expect(engine.getCacheStats().size).toBe(1);
          expect(engine.getCacheStats().entries).toContain(key);
        }),
        { numRuns: 50, seed: 42 }
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Property 3: When original locator succeeds, no healing logic is invoked
  // ─────────────────────────────────────────────────────────────────────────

  describe('Property 3: When original locator succeeds, no healing logic is invoked', () => {
    it('when isElementAccessible returns true, engine returns element without calling OpenAI', async () => {
      // Use a raw CSS selector (not a Page.Element reference) so the current
      // unfixed code can find it directly via page.locator()
      const rawLocatorArb = fc.constantFrom(
        '.app_logo',
        '#user-name',
        '#password',
        '#login-button',
        '.shopping_cart_link',
        '.inventory_list',
        '[data-test="error"]'
      );

      const actionArb = fc.constantFrom('click', 'fill', 'hover', 'check', 'type');

      await fc.assert(
        fc.asyncProperty(rawLocatorArb, actionArb, async (locator, action) => {
          const { mockPage } = createMockPageWithElementFound();
          const engine = new SelfHealingEngine(mockPage as any);

          // Reset the OpenAI mock call count
          vi.mocked(OpenAIClient.suggestSelfHeal).mockClear();

          // Call findElementWithHealing with a raw locator that will be found
          const result = await engine.findElementWithHealing(locator, action);

          // Element should be found
          expect(result).not.toBeNull();

          // OpenAI should NOT have been called (no healing needed)
          expect(OpenAIClient.suggestSelfHeal).not.toHaveBeenCalled();
        }),
        { numRuns: 20, seed: 42 }
      );
    });

    it('when element is found on first try, page.content() is NOT called for DOM extraction', async () => {
      const rawLocatorArb = fc.constantFrom(
        '.app_logo',
        '#user-name',
        '#login-button'
      );

      await fc.assert(
        fc.asyncProperty(rawLocatorArb, async (locator) => {
          const { mockPage } = createMockPageWithElementFound();
          const engine = new SelfHealingEngine(mockPage as any);

          // Clear any previous calls
          mockPage.content.mockClear();

          await engine.findElementWithHealing(locator, 'click');

          // page.content() should NOT be called when element is found immediately
          expect(mockPage.content).not.toHaveBeenCalled();
        }),
        { numRuns: 10, seed: 42 }
      );
    });

    it('when element is found via cache, no healing logic is invoked', async () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new SelfHealingEngine(mockPage as any);

      // Pre-populate cache with a known mapping
      const cacheMap = (engine as any).locatorCache as Map<string, string>;
      cacheMap.set('some-broken-locator', '.app_logo');

      // Reset mocks
      vi.mocked(OpenAIClient.suggestSelfHeal).mockClear();
      mockPage.content.mockClear();

      // Call with the cached key
      const result = await engine.findElementWithHealing('some-broken-locator', 'click');

      // Should find element via cache
      expect(result).not.toBeNull();

      // No healing should be invoked
      expect(OpenAIClient.suggestSelfHeal).not.toHaveBeenCalled();
      expect(mockPage.content).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Concrete Preservation Cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('Concrete Preservation Cases', () => {
    it('ActionEngine.getLocator("Home.Logo") resolves to .app_logo locator', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new ActionEngine(mockPage as any);

      const locator = engine.getLocator('Home.Logo');

      expect(locator).toBeDefined();
      expect(mockPage.locator).toHaveBeenCalledWith('.app_logo');
    });

    it('ActionEngine.getLocator("Login.UsernameField") resolves to #user-name locator', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new ActionEngine(mockPage as any);

      const locator = engine.getLocator('Login.UsernameField');

      expect(locator).toBeDefined();
      expect(mockPage.locator).toHaveBeenCalledWith('#user-name');
    });

    it('ActionEngine.getLocator("Home.FooterText") resolves to .footer_copy locator', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new ActionEngine(mockPage as any);

      const locator = engine.getLocator('Home.FooterText');

      expect(locator).toBeDefined();
      expect(mockPage.locator).toHaveBeenCalledWith('.footer_copy');
    });

    it('ActionEngine.getLocator("Home.Title") resolves to text=Swag Labs locator', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new ActionEngine(mockPage as any);

      const locator = engine.getLocator('Home.Title');

      expect(locator).toBeDefined();
      // text= prefix goes through page.locator()
      expect(mockPage.locator).toHaveBeenCalledWith('text=Swag Labs');
    });

    it('SelfHealingEngine.getCacheStats() returns correct structure', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new SelfHealingEngine(mockPage as any);

      const stats = engine.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('entries');
      expect(typeof stats.size).toBe('number');
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it('SelfHealingEngine.clearCache() is idempotent', () => {
      const { mockPage } = createMockPageWithElementFound();
      const engine = new SelfHealingEngine(mockPage as any);

      // Clear on empty cache should not throw
      engine.clearCache();
      expect(engine.getCacheStats().size).toBe(0);

      // Clear again
      engine.clearCache();
      expect(engine.getCacheStats().size).toBe(0);
    });
  });
});
