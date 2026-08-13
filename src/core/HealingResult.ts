// Type definitions for the self-healing locator system.

// Represents a single candidate locator generated during the healing process.
export interface LocatorCandidate {
  type: 'data-testid' | 'data-qa' | 'data-cy' | 'id' | 'role' | 'label' | 'placeholder' | 'text' | 'css' | 'xpath';
  locator: string;
  rawSelector: string;
  confidence: number;
}

// Details about the DOM element that was matched during healing.
export interface MatchedElementDetails {
  tag: string;
  text: string;
  role: string;
  id: string;
  dataTestId: string;
  ariaLabel: string;
  placeholder: string;
  className: string;
  attributesUsed: string[];
}

// The structured result returned by SelfHealingEngine after attempting to recover from a broken locator.
export interface HealingResult {
  referenceName: string;
  originalLocator: string;
  healingStatus: 'SUCCESS' | 'FAILED';
  confidence: number;
  reason: string;
  bestLocator: LocatorCandidate | null;
  fallbackLocators: LocatorCandidate[];
  matchedElementDetails: MatchedElementDetails | null;
}
