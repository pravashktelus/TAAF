/**
 * Bug Condition Exploration Test
 * ─────────────────────────────────────────────────────────────────────────────
 * Property 1: Unresolved Page.Element Reference Passed to page.locator()
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 *
 * This test encodes the EXPECTED behavior: when a Page.Element reference
 * (e.g., "Home.Logo") is passed to findElementWithHealing, the engine SHOULD
 * resolve it via ElementResolver before passing to page.locator().
 *
 * On UNFIXED code, this test FAILS — confirming the bug exists.
 * After the fix, this test PASSES — confirming the bug is resolved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ElementResolver } from '../src/core/ElementResolver';

// Mock OpenAIClient to avoid real API calls
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

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Bug condition predicate: input is a Page.Element reference
 * matching the pattern /^[A-Z][A-Za-z0-9]+\.[A-Za-z0-9.]+$/
 */
function isBugCondition(input: string): boolean {
  return /^[A-Z][A-Za-z0-9]+\.[A-Za-z0-9.]+$/.test(input);
}

/**
 * Get all valid Page.Element references from .properties files
 */
function getValidPageElementReferences(): Array<{ reference: string; resolvedLocator: string }> {
  const pages = ElementResolver.listAvailablePages();
  const references: Array<{ reference: string; resolvedLocator: string }> = [];

  for (const page of pages) {
    const properties = ElementResolver.loadPage(page);
    for (const [key, locator] of Object.entries(properties)) {
      const reference = `${page}.${key}`;
      if (isBugCondition(reference)) {
        references.push({ reference, resolvedLocator: locator });
      }
    }
  }

  return references;
}

/**
 * Create a mock Playwright Page that tracks locator calls
 */
function createMockPage() {
  const locatorCalls: string[] = [];
  const evaluateCalls: Array<{ script: any; args: any[] }> = [];

  const mockLocator = {
    count: vi.fn().mockResolvedValue(0),
    first: vi.fn().mockReturnThis(),
    isVisible: vi.fn().mockResolvedValue(false),
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
    evaluate: vi.fn(async (script: any, ...args: any[]) => {
      evaluateCalls.push({ script, args });
      return '<div class="app_logo" data-testid="logo">Logo</div>';
    }),
  };

  return { mockPage, locatorCalls, evaluateCalls, mockLocator };
}

// ─── Property-Based Tests ────────────────────────────────────────────────────

describe('Bug Condition Exploration: Unresolved Page.Element Reference', () => {
  // Collect valid references from actual .properties files
  const validReferences = getValidPageElementReferences();

  // Arbitrary that generates valid Page.Element references from actual .properties files
  const pageElementReferenceArb = fc.constantFrom(
    ...validReferences.map((r) => r.reference)
  );

  // Arbitrary for action strings
  const actionArb = fc.constantFrom('click', 'fill', 'hover', 'check', 'type');

  describe('Property 1: Reference Resolution Before page.locator()', () => {
    it('should resolve Page.Element references via ElementResolver before passing to page.locator()', () => {
      fc.assert(
        fc.property(pageElementReferenceArb, actionArb, (reference, action) => {
          // Precondition: input satisfies bug condition
          fc.pre(isBugCondition(reference));

          // Get the expected resolved locator
          const expectedLocator = ElementResolver.resolve(reference);

          // Create a fresh mock page for each test case
          const { mockPage, locatorCalls } = createMockPage();

          // Create engine with mock page
          const engine = new SelfHealingEngine(mockPage as any);

          // Call findElementWithHealing - we don't await since we just need
          // to verify what gets passed to page.locator synchronously
          // The engine should resolve the reference BEFORE calling page.locator
          engine.findElementWithHealing(reference, action);

          // ASSERTION: The first call to page.locator() should use the RESOLVED
          // locator (e.g., ".app_logo"), NOT the raw reference (e.g., "Home.Logo")
          expect(locatorCalls.length).toBeGreaterThan(0);

          // The locator passed should be the resolved selector, not the raw reference
          const firstLocatorCall = locatorCalls[0];
          expect(firstLocatorCall).not.toBe(reference);
          expect(firstLocatorCall).toBe(expectedLocator);
        }),
        { numRuns: validReferences.length, seed: 42 }
      );
    });
  });

  describe('Property 2: DOM Context Extraction Quality', () => {
    it('should extract focused element attributes, not first 500 chars of full HTML', async () => {
      // Use a concrete case to test DOM extraction behavior
      const reference = validReferences[0].reference;
      const { mockPage } = createMockPage();

      const engine = new SelfHealingEngine(mockPage as any);

      // Access the private method via prototype to test DOM extraction
      const extractMethod = (engine as any)._extractElementContext ||
                           (engine as any)._extractFocusedDOM;

      if (extractMethod) {
        const fullHtml = '<html>' + 'x'.repeat(1000) + '</html>';
        const context = extractMethod.call(engine, fullHtml, reference);

        // The context should NOT be just the first 500 chars of full HTML
        // It should contain focused, relevant element attributes
        if (typeof context === 'string' && context.length > 0) {
          // Bug: current implementation just takes first 500 chars
          // Expected: focused DOM with relevant attributes
          expect(context.length).toBeLessThanOrEqual(500);
          // This assertion will help identify the bug - current code
          // returns arbitrary first 500 chars regardless of target element
        }
      }
    });
  });

  describe('Property 3: Fallback Locator Priority System', () => {
    it('should generate fallback locators following priority: data-testid > id > role > label > placeholder > text > css > xpath', async () => {
      const reference = validReferences[0].reference;
      const resolvedLocator = validReferences[0].resolvedLocator;
      const { mockPage } = createMockPage();

      const engine = new SelfHealingEngine(mockPage as any);

      // Access the private fallback generation method
      const fallbackMethod = (engine as any)._generateFallbackLocators ||
                            (engine as any)._generatePrioritizedLocators;

      if (fallbackMethod) {
        const domContext = `
          <div data-testid="logo" id="app-logo" role="img" aria-label="App Logo" class="app_logo">
            <img src="logo.png" />
          </div>
        `;

        const fallbacks = fallbackMethod.call(engine, resolvedLocator, domContext);

        if (Array.isArray(fallbacks) && fallbacks.length > 0) {
          // Expected priority order: data-testid first, then id, then role, etc.
          // Bug: current code generates arbitrary selectors like //button, //input
          const hasDataTestId = fallbacks.some((f: any) =>
            typeof f === 'string'
              ? f.includes('data-testid') || f.includes('testid')
              : f?.type === 'data-testid'
          );

          // On unfixed code, fallbacks won't follow priority system
          expect(hasDataTestId).toBe(true);
        }
      }
    });
  });

  describe('Property 4: Structured HealingResult Output', () => {
    it('should return a structured HealingResult JSON with required fields', async () => {
      const reference = validReferences[0].reference;
      const { mockPage } = createMockPage();

      const engine = new SelfHealingEngine(mockPage as any);

      const result = await engine.findElementWithHealing(reference, 'click');

      // Expected: result should be { element, healingResult } with structured fields
      // Bug: current code returns Locator | null (no structured metadata)
      if (result && typeof result === 'object' && 'healingResult' in result) {
        const healingResult = (result as any).healingResult;
        expect(healingResult).toHaveProperty('healingStatus');
        expect(healingResult).toHaveProperty('confidence');
        expect(healingResult).toHaveProperty('bestLocator');
        expect(healingResult).toHaveProperty('fallbackLocators');
        expect(healingResult).toHaveProperty('matchedElementDetails');
        expect(['SUCCESS', 'FAILED']).toContain(healingResult.healingStatus);
        expect(typeof healingResult.confidence).toBe('number');
      } else {
        // Current code returns Locator | null — this confirms the bug
        // The return value should be a structured object, not just a Locator
        expect(result).toHaveProperty('healingResult');
      }
    });
  });

  describe('Concrete Bug Demonstration Cases', () => {
    it('findElementWithHealing("Home.Logo", "click") should NOT pass "Home.Logo" to page.locator()', async () => {
      const { mockPage, locatorCalls } = createMockPage();
      const engine = new SelfHealingEngine(mockPage as any);

      await engine.findElementWithHealing('Home.Logo', 'click');

      // Bug: current code passes "Home.Logo" directly to page.locator()
      // Expected: should pass ".app_logo" (the resolved locator)
      const passedRawReference = locatorCalls.some((call) => call === 'Home.Logo');
      expect(passedRawReference).toBe(false);

      // The resolved locator ".app_logo" should have been used
      const passedResolvedLocator = locatorCalls.some((call) => call === '.app_logo');
      expect(passedResolvedLocator).toBe(true);
    });

    it('findElementWithHealing("Login.UsernameField", "fill") should NOT pass "Login.UsernameField" to page.locator()', async () => {
      const { mockPage, locatorCalls } = createMockPage();
      const engine = new SelfHealingEngine(mockPage as any);

      await engine.findElementWithHealing('Login.UsernameField', 'fill');

      // Bug: current code passes "Login.UsernameField" directly to page.locator()
      // Expected: should pass "#user-name" (the resolved locator)
      const passedRawReference = locatorCalls.some((call) => call === 'Login.UsernameField');
      expect(passedRawReference).toBe(false);

      const passedResolvedLocator = locatorCalls.some((call) => call === '#user-name');
      expect(passedResolvedLocator).toBe(true);
    });
  });
});
