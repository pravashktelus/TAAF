import { StoryInput, Attachment } from './StoryReader';
import { PageSnapshot, PageCrawler } from '../core/PageCrawler';

/**
 * PlanPrompts
 * -----------
 * Builds AI prompts for the Planner agent.
 * Handles both modes:
 *   - story mode:     AI generates test cases from story + attachments + live page
 *   - testcases mode: AI parses and reformats existing test cases
 *
 * Also provides fallback templates when AI is unavailable.
 */
export class PlanPrompts {

  // ─── System Prompt ────────────────────────────────────────────────────────

  static readonly SYSTEM_PROMPT = `You are a senior QA engineer expert in BDD test automation.
Your job is to produce structured test plans in a specific format.
You write clear, precise test cases with detailed steps, navigation paths, test data, and expected results.
You always think about happy paths, negative scenarios, edge cases, and boundary conditions.
You output ONLY valid JSON — no markdown, no explanation, just the JSON object.`;

  // ─── Story Mode Prompt ────────────────────────────────────────────────────

  /**
   * Builds prompt for story mode — AI generates test cases from story input.
   *
   * @param storyInput       - Story content + attachments from StoryReader
   * @param pageName         - Target page name (e.g. "Orders")
   * @param pageSnapshot     - Optional live page snapshot from PageCrawler
   * @param frameworkContext - Existing feature/properties context from ContextEnricher
   */
  static buildStoryPrompt(
    storyInput: StoryInput,
    pageName: string,
    pageSnapshot?: PageSnapshot,
    frameworkContext: string = ''
  ): string {
    const sections: string[] = [];

    // Framework context first — AI understands your app before generating
    if (frameworkContext) sections.push(frameworkContext);

    // Story content
    sections.push('=== USER STORY ===');
    sections.push(storyInput.mainContent);

    // Attachment context
    if (storyInput.attachments.length > 0) {
      storyInput.attachments.forEach((att) => {
        sections.push(`\n=== ATTACHMENT: ${att.fileName} ===`);
        if (att.type === 'image') {
          sections.push(`[Image attachment — use vision to analyse UI layout, navigation flow, and interactive elements visible in this mockup/wireframe]`);
        } else {
          sections.push(att.content.substring(0, 2000)); // cap at 2000 chars per attachment
        }
      });
    }

    // Live page snapshot
    if (pageSnapshot) {
      sections.push('\n=== LIVE PAGE ELEMENTS (locators are CASE-EXACT from DOM — do NOT modify casing) ===');
      sections.push(PageCrawler.snapshotToText(pageSnapshot));
    }

    // Output instructions
    sections.push(`
=== YOUR TASK ===
Based on the story and context above, generate comprehensive test cases for the "${pageName}" page.

Include:
1. Happy path test cases
2. Negative test cases (invalid data, missing required fields, unauthorised access)
3. Edge cases (boundary values, empty states, max limits)
4. Navigation validation cases

For EACH test case, provide detailed step-by-step instructions including:
- Exact navigation path through the application
- Specific test data values to use
- Precise expected results for each step

Return ONLY this JSON structure (no markdown, no extra text):
${this._getOutputSchema(pageName)}`);

    return sections.join('\n');
  }

  // ─── Test Cases Mode Prompt ───────────────────────────────────────────────

  /**
   * Builds prompt for testcases mode — AI parses and reformats existing test cases.
   *
   * @param storyInput       - Test cases content from StoryReader
   * @param pageName         - Target page name
   * @param pageSnapshot     - Optional live page snapshot
   * @param frameworkContext - Existing feature/properties context from ContextEnricher
   */
  static buildTestCasesPrompt(
    storyInput: StoryInput,
    pageName: string,
    pageSnapshot?: PageSnapshot,
    frameworkContext: string = ''
  ): string {
    const sections: string[] = [];

    // Framework context first
    if (frameworkContext) sections.push(frameworkContext);

    sections.push('=== EXISTING TEST CASES ===');
    sections.push(storyInput.mainContent);

    if (pageSnapshot) {
      sections.push('\n=== LIVE PAGE ELEMENTS (locators are CASE-EXACT from DOM — do NOT modify casing) ===');
      sections.push(PageCrawler.snapshotToText(pageSnapshot));
    }

    sections.push(`
=== YOUR TASK ===
Parse the existing test cases above and reformat them for the "${pageName}" page.

CRITICAL RULES FOR TESTCASES MODE:
- PRESERVE EVERY SINGLE STEP exactly as provided — including login steps, navigation steps, ALL steps
- Do NOT skip any step (login, navigate, click, enter, verify — ALL must appear)
- Do NOT add any new test cases — only structure what is provided
- Do NOT generate negative, edge case, or additional scenarios
- Do NOT modify test data values — use exactly what was provided (emails, passwords, text etc.)
- Do NOT add edgeCases — leave the edgeCases array empty []
- Do NOT split one test case into multiple — if input has 1 test case with 15 steps, output has 1 test case with 15 steps
- Total output test cases MUST equal the number of test cases in the input — no more, no less
- Total steps per test case MUST match the input — no more, no less
- If the input has login steps (enter email, enter password, click sign in) — INCLUDE THEM
- Use test data values EXACTLY as provided: emails, passwords, field values
- Map step action text to the closest element name from the available references

Return ONLY this JSON structure (no markdown, no extra text):
${this._getOutputSchema(pageName)}`);

    return sections.join('\n');
  }

  // ─── Fallback Templates ───────────────────────────────────────────────────

  /**
   * Fallback template for story mode when AI is unavailable.
   * Now uses deterministic AC parsing: extracts acceptance criteria from the story
   * and maps them directly to test cases (P4 fix).
   */
  static buildStoryFallback(pageName: string, pageSnapshot?: PageSnapshot, storyContent?: string): string {
    const elements = pageSnapshot?.elements || [];

    // P4: Attempt to extract acceptance criteria deterministically
    const parsedACs = storyContent ? this._parseAcceptanceCriteria(storyContent) : [];

    if (parsedACs.length > 0) {
      // Build test cases from parsed ACs
      return JSON.stringify({
        page: pageName,
        url: pageSnapshot?.url || '',
        mode: 'story',
        aiGenerated: false,
        note: 'Built from parsed acceptance criteria (deterministic).',
        elements: pageSnapshot?.elements || [],
        testCases: parsedACs.map((ac, index) => ({
          id: `TC-${String(index + 1).padStart(3, '0')}`,
          title: ac.title,
          type: index === 0 ? 'happy_path' : (ac.title.toLowerCase().includes('negative') || ac.title.toLowerCase().includes('invalid') || ac.title.toLowerCase().includes('incorrect') || ac.title.toLowerCase().includes('without') ? 'negative' : 'happy_path'),
          navigation: '',
          steps: ac.steps.map((step, si) => ({
            stepNo: si + 1,
            action: step.action,
            navigation: '',
            testData: step.testData,
            expected: step.expected,
          })),
          edgeCases: [],
        })),
      }, null, 2);
    }

    // Original fallback (no ACs found in story)
    return JSON.stringify({
      page: pageName,
      url: pageSnapshot?.url || '',
      mode: 'story',
      aiGenerated: false,
      note: 'AI unavailable and no parseable ACs found. Add OPENAI_API_KEY to enable AI generation.',
      elements: pageSnapshot?.elements || [],
      testCases: [
        {
          id: 'TC-001',
          title: `${pageName} - Happy Path`,
          type: 'happy_path',
          navigation: '',
          steps: [
            {
              stepNo: 1,
              action: 'Navigate to the application',
              navigation: '',
              testData: '',
              expected: 'Application is accessible',
            },
          ],
          edgeCases: [],
        },
      ],
    }, null, 2);
  }

  // ─── P4: Acceptance Criteria Parser ───────────────────────────────────────

  /**
   * Deterministically extracts acceptance criteria from a story's text content.
   * Looks for patterns like:
   *   - "AC-1: Title" or "### AC-1: Title"
   *   - Numbered ACs: "1. Title" under "Acceptance Criteria:" heading
   *   - Given/When/Then steps within each AC
   *
   * Returns structured test cases ready for plan JSON.
   */
  static _parseAcceptanceCriteria(content: string): {
    title: string;
    steps: { action: string; testData: string; expected: string }[];
  }[] {
    const results: { title: string; steps: { action: string; testData: string; expected: string }[] }[] = [];

    // Find the "Acceptance Criteria" section.
    // The section runs until the next level-2 heading OR a known trailing marker
    // (Test Data / Tags / Notes / Pre-conditions / **Scope) OR THE END OF FILE.
    // The end-of-file anchor ($) is essential: when Acceptance Criteria is the
    // LAST section (no trailing Scope/Notes), the section must still be captured —
    // otherwise the parser reports "No explicit ACs found" and falls back to AI.
    const acSectionMatch = content.match(/(?:Acceptance\s+Criteria|ACs?)[\s:]*\n([\s\S]*?)(?=\n##\s(?!#)|\nTest\s+Data|\nTags|\nNotes|\nPre-conditions|\n\*\*Scope|$)/i);
    if (!acSectionMatch) return results;

    const acSection = acSectionMatch[1];

    // Split by AC headers — supports multiple formats:
    //   "### AC-1: Title"
    //   "AC-1: Title"
    //   "1. Title"
    //   "**Title:** description"  (bold format commonly used in quick stories)
    const acPattern = /(?:^|\n)(?:#{1,3}\s*)?(?:AC-?\d+[\s:.]+|(\d+)\.\s+|\*\*([^*]+)\*\*[\s:]+)([^\n]*)/gi;
    const acHeaders: { index: number; title: string; isBold: boolean; isNumberedAC: boolean }[] = [];
    let match;

    while ((match = acPattern.exec(acSection)) !== null) {
      // match[2] = bold title from **Title:** format
      // match[3] = rest of line after the header pattern
      const boldTitle = match[2]?.trim();
      const afterTitle = match[3]?.trim() || '';
      const numberedTitle = match[0].replace(/^[\s#]*(?:AC-?\d+[\s:.]+|\d+\.\s+)/, '').trim();
      
      // Detect if this header used AC-N numbering (in the raw match text)
      const isNumberedAC = /AC-?\d+/i.test(match[0]);
      const isBold = !!boldTitle && !isNumberedAC;
      
      const title = boldTitle || numberedTitle || afterTitle;
      if (title && title.length > 2) {
        acHeaders.push({ index: match.index, title, isBold, isNumberedAC });
      }
    }

    if (acHeaders.length === 0) return results;

    // Detect format based on how headers were MATCHED (not title text):
    // - If ALL headers used **Bold:** format (no AC-N numbering) → combine into ONE test case (E2E flow)
    // - If ANY header used AC-N numbering → treat each as a SEPARATE test case
    const isBoldFormat = acHeaders.every((h) => h.isBold) && !acHeaders.some((h) => h.isNumberedAC);
    
    if (isBoldFormat && acHeaders.length > 2) {
      // All bold sections are steps in ONE scenario
      const allSteps: { action: string; testData: string; expected: string }[] = [];
      
      for (let i = 0; i < acHeaders.length; i++) {
        const startIdx = acHeaders[i].index;
        const endIdx = i + 1 < acHeaders.length ? acHeaders[i + 1].index : acSection.length;
        const acBody = acSection.substring(startIdx, endIdx);
        const steps = this._parseACSteps(acBody);
        allSteps.push(...steps);
      }
      
      // Combine all into one test case using the first AC title as scenario name
      const combinedTitle = 'Complete E2E Flow - ' + acHeaders.map(h => h.title.replace(/:$/, '')).slice(0, 3).join(', ') + (acHeaders.length > 3 ? '...' : '');
      results.push({ title: combinedTitle, steps: allSteps });
      return results;
    }

    // Standard format: each AC = separate test case
    for (let i = 0; i < acHeaders.length; i++) {
      const startIdx = acHeaders[i].index;
      const endIdx = i + 1 < acHeaders.length ? acHeaders[i + 1].index : acSection.length;
      const acBody = acSection.substring(startIdx, endIdx);

      const steps = this._parseACSteps(acBody);
      results.push({
        title: acHeaders[i].title,
        steps,
      });
    }

    return results;
  }

  /**
   * Parses the "## Detailed Steps" section into a SINGLE granular happy-path
   * test case. Unlike acceptance criteria (which are high-level summaries), the
   * Detailed Steps section lists every field entry, selection, click, and
   * verification — so it produces a step-by-step scenario that maps 1:1 to the
   * real UI flow.
   *
   * Sub-headings (### Step N: ...) are used as navigation context but not as
   * steps themselves. "Verify ..." lines become expected results; all other
   * bullets become actions. Test data embedded in quotes is extracted.
   *
   * Returns null when there is no "## Detailed Steps" section.
   */
  static _parseDetailedStepsAsTestCase(content: string): {
    title: string;
    steps: { action: string; testData: string; expected: string }[];
  } | null {
    const detailedMatch = content.match(/##\s*Detailed\s+Steps\s*\n([\s\S]*?)(?=\n##\s[^#]|$)/i);
    if (!detailedMatch) return null;

    const section = detailedMatch[1];
    const lines = section.split('\n');
    const steps: { action: string; testData: string; expected: string }[] = [];

    for (const rawLine of lines) {
      // Skip sub-headings like "### Step 1: Registration" (navigation grouping only)
      if (/^\s*#{1,4}\s/.test(rawLine)) continue;

      const line = rawLine.replace(/^[\s]*[-•]\s*/, '').replace(/\*\*/g, '').trim();
      if (!line || line.length < 4) continue;

      const isVerify = /^verify\b/i.test(line);

      // Extract real test data only when the quoted text is a VALUE, not a field
      // name or click target. Patterns:
      //   Enter "VALUE" into ...      Select "VALUE" from ...
      // "Enter a full name into the 'Full Name' field" has no value literal → blank
      // (data is chosen at generation time by field nature per the data strategy).
      let testData = '';
      if (!isVerify) {
        const enterVal = line.match(/^(?:enter|type|fill)\s+"([^"]+)"\s+(?:into|in)\b/i);
        const selectVal = line.match(/^select\s+"([^"]+)"\s+from\b/i);
        if (enterVal) testData = enterVal[1];
        else if (selectVal) testData = selectVal[1];
      }

      if (isVerify) {
        // A verification line — attach as expected result. If the previous step
        // was an action, append the assertion as its own step for traceability.
        steps.push({
          action: line,
          testData: '',
          expected: line.replace(/^verify\s+(that\s+)?/i, 'Verify ').trim(),
        });
      } else {
        steps.push({
          action: line,
          testData,
          expected: this._inferExpectedFromAction(line),
        });
      }
    }

    if (steps.length === 0) return null;

    return {
      title: 'Register new account and place broadband order (end-to-end)',
      steps,
    };
  }

  /**
   * Produces a meaningful expected result for an action line.
   */
  private static _inferExpectedFromAction(action: string): string {
    const a = action.toLowerCase();
    if (a.startsWith('navigate')) return 'Page loaded successfully';
    if (a.startsWith('click')) {
      const target = action
        .replace(/^click\s+(the\s+)?/i, '')
        .replace(/\s+(button|link|option|card|tab|slot).*$/i, '')
        .replace(/^["']|["']$/g, '')
        .trim();
      return `"${target}" action performed`;
    }
    if (a.startsWith('enter') || a.startsWith('fill') || a.startsWith('type')) {
      const fieldMatch = action.match(/into the "([^"]+)"|into the '([^']+)'|in the "([^"]+)"/i);
      const field = fieldMatch ? (fieldMatch[1] || fieldMatch[2] || fieldMatch[3]) : 'field';
      return `Value entered into "${field}" field`;
    }
    if (a.startsWith('select')) {
      const dd = action.match(/from the "([^"]+)"|from the '([^']+)'/i);
      const name = dd ? (dd[1] || dd[2]) : 'dropdown';
      return `Option selected from "${name}"`;
    }
    if (a.startsWith('upload')) return 'File uploaded successfully';
    return 'Step completed successfully';
  }

  /**
   * Parses Given/When/Then steps from an AC body text.
   */
  private static _parseACSteps(acBody: string): { action: string; testData: string; expected: string }[] {
    const steps: { action: string; testData: string; expected: string }[] = [];
    const lines = acBody.split('\n').map((l) => l.replace(/^[\s]*[-•]\s*/, '').trim()).filter(Boolean);

    let currentAction = '';
    let currentTestData = '';
    let currentExpected = '';
    let hasGherkinKeywords = false;

    // First pass: detect if content uses Gherkin keywords
    for (const line of lines) {
      if (line.match(/^(?:Given|When|And|But|Then)\s+/i)) {
        hasGherkinKeywords = true;
        break;
      }
    }

    // If no Gherkin keywords, treat each bullet/line as a step directly
    if (!hasGherkinKeywords) {
      let stepNo = 0;
      for (const line of lines) {
        // Skip the AC header line itself (### AC-1, numbered, or **Bold:** format)
        if (line.match(/^(?:#{1,3}\s*)?(?:AC-?\d+)/i)) continue;
        if (line.match(/^\*\*[^*]+\*\*/)) {
          // For **Bold:** format, extract the description AFTER the bold title as a step
          const boldContent = line.replace(/^\*\*[^*]+\*\*[\s:]*/, '').trim();
          if (boldContent && boldContent.length > 3) {
            // Split comma-separated actions into individual steps
            const actions = boldContent.split(/\.\s+|,\s+(?=(?:click|fill|enter|select|verify|submit|navigate|check))/i).filter(a => a.trim().length > 3);
            for (const action of actions) {
              stepNo++;
              const actionTrimmed = action.trim().replace(/\.$/, '');
              let testData = '';
              const dataMatch = actionTrimmed.match(/[`"""]([^`"""]+)[`"""]/);
              if (dataMatch) testData = dataMatch[1];
              
              const actionLower = actionTrimmed.toLowerCase();
              const isVerify = actionLower.startsWith('verify') || actionLower.startsWith('confirm');
              
              steps.push({
                action: actionTrimmed,
                testData,
                expected: isVerify ? actionTrimmed : '',
              });
            }
          }
          continue;
        }
        // Skip empty or header-like lines
        if (!line || line.length < 3) continue;

        stepNo++;
        const lineLower = line.toLowerCase();
        const isVerify = lineLower.startsWith('verify') || lineLower.startsWith('confirm') || lineLower.startsWith('assert');

        // Extract inline test data (quoted values, backtick values)
        let testData = '';
        const dataMatch = line.match(/[`""]([^`""]+)[`""]/);
        if (dataMatch) testData = dataMatch[1];

        // Infer expected result based on action type
        let expected = '';
        if (isVerify) {
          expected = line;
        } else if (lineLower.startsWith('navigate') || lineLower.startsWith('open') || lineLower.includes('navigate to')) {
          expected = 'Page loaded successfully';
        } else if (lineLower.startsWith('click')) {
          // Extract what's being clicked for a meaningful expected
          const clickTarget = line.match(/click\s+(?:on\s+)?(?:the\s+)?[""]([^""]+)[""]/i);
          expected = clickTarget ? `"${clickTarget[1]}" action performed` : 'Element clicked successfully';
        } else if (lineLower.startsWith('enter') || lineLower.startsWith('type')) {
          const fieldMatch = line.match(/(?:into|in)\s+(?:the\s+)?[""]([^""]+)[""]/i);
          expected = fieldMatch ? `Value entered in "${fieldMatch[1]}" field` : 'Value entered successfully';
        } else if (lineLower.startsWith('select')) {
          expected = 'Option selected successfully';
        } else if (lineLower.startsWith('check')) {
          expected = 'Checkbox checked';
        } else {
          expected = 'Step completed successfully';
        }

        steps.push({
          action: line,
          testData,
          expected,
        });
      }
      return steps;
    }

    // Gherkin mode: parse Given/When/Then keywords
    for (const line of lines) {
      // Skip the AC header line itself
      if (line.match(/^(?:#{1,3}\s*)?(?:AC-?\d+|^\d+\.)/i)) continue;

      // Capture data table rows (lines starting with |) — attach to current action
      if (line.startsWith('|')) {
        if (currentAction) {
          currentTestData = currentTestData ? `${currentTestData}\n${line}` : line;
        }
        continue;
      }

      const gwt = line.match(/^(?:Given|When|And|But|Then)\s+(.*)/i);

      if (gwt) {
        const keyword = line.match(/^(Given|When|And|But|Then)/i)![1].toLowerCase();
        const text = gwt[1].trim();

        if (keyword === 'then') {
          // This is an expected result — flush previous action if any
          if (currentAction) {
            steps.push({ action: currentAction, testData: currentTestData, expected: currentExpected });
            currentAction = '';
            currentTestData = '';
            currentExpected = '';
          }
          currentExpected = text;
          // If no action precedes this Then, make the Then itself an action
          if (steps.length === 0 && !currentAction) {
            currentAction = `Verify: ${text}`;
          }
        } else if (keyword === 'given' || keyword === 'when') {
          // Flush previous step
          if (currentAction) {
            steps.push({ action: currentAction, testData: currentTestData, expected: currentExpected });
            currentExpected = '';
            currentTestData = '';
          }
          currentAction = text;

          // Extract inline test data (quoted values)
          const dataMatch = text.match(/[""]([^""]+)[""]/);
          if (dataMatch) currentTestData = dataMatch[1];
        } else if (keyword === 'and' || keyword === 'but') {
          // "And" could be additional action or additional assertion
          if (currentExpected) {
            // Previous was a Then — this And is continuation of expected
            steps.push({ action: currentAction || `Verify: ${currentExpected}`, testData: currentTestData, expected: currentExpected });
            currentAction = text;
            currentExpected = '';
            currentTestData = '';
            const dataMatch = text.match(/[""]([^""]+)[""]/);
            if (dataMatch) currentTestData = dataMatch[1];
          } else {
            // Previous was a When — this And is continuation of action
            if (currentAction) {
              steps.push({ action: currentAction, testData: currentTestData, expected: '' });
            }
            currentAction = text;
            currentTestData = '';
            const dataMatch = text.match(/[""]([^""]+)[""]/);
            if (dataMatch) currentTestData = dataMatch[1];
          }
        }
      }
    }

    // Flush final step
    if (currentAction || currentExpected) {
      steps.push({ action: currentAction || `Verify: ${currentExpected}`, testData: currentTestData, expected: currentExpected });
    }

    return steps;
  }

  /**
   * Fallback template for testcases mode when AI is unavailable.
   * Returns the raw test cases text without AI reformatting.
   */
  static buildTestCasesFallback(
    pageName: string,
    storyInput: StoryInput,
    pageSnapshot?: PageSnapshot
  ): string {
    return JSON.stringify({
      page: pageName,
      url: pageSnapshot?.url || '',
      mode: 'testcases',
      aiGenerated: false,
      note: 'AI unavailable — raw test cases preserved without reformatting.',
      elements: pageSnapshot?.elements || [],
      testCases: storyInput.testCases.map((tc) => ({
        id: tc.id,
        title: tc.title,
        type: 'existing',
        navigation: tc.steps[0]?.navigation || '',
        steps: tc.steps,
        edgeCases: [],
      })),
    }, null, 2);
  }

  // ─── Image Prompt (for AI vision with attachments) ────────────────────────

  /**
   * Returns image attachments formatted for OpenAI vision API.
   * Used by LLMClient when story has image attachments.
   */
  static getImageAttachments(storyInput: StoryInput): Attachment[] {
    return storyInput.attachments.filter((a) => a.type === 'image');
  }

  // ─── Supplementary Prompt: Negative/Edge Cases ───────────────────────────

  static readonly SUPPLEMENTARY_SYSTEM_PROMPT = `You are a senior QA engineer specialising in negative testing and edge cases.
Your job is to generate ONLY negative and edge case test scenarios — never happy path.
You think about: invalid inputs, missing required fields, boundary values, unauthorised access, empty states, max limits, special characters, SQL injection attempts, and unexpected user behaviour.

TWO NON-NEGOTIABLE RULES FOR WEB (UI) TESTS:

1. REACHABILITY (prerequisite steps): A negative case must start from a VALID, reachable
   state. If the field/page you are testing sits behind login/registration or several
   wizard steps, you MUST include the setup steps to get there FIRST (register or log in,
   then navigate through prior steps), then apply the single negative variation.
   Never test a field on a page the user has not actually reached — those steps will fail.
   Use the provided "REQUIRED SETUP PREFIX" verbatim as the opening steps of each web
   negative case, then continue to the step under test.

2. NO INVENTED ASSERTIONS: Do NOT invent error-message text or redirect URLs. You do not
   know the app's exact copy (e.g. "All fields are required") or its routes (e.g. "/error")
   unless it is provided to you. Guessed strings make tests fail. Priority for assertions:
   a. If a "REAL VALIDATION RULES" section is provided, assert the EXACT message on the
      given error element key, e.g.
      Then 'Page.ErrorCustomerName' should have text 'Full name is required'
   b. Otherwise assert the flow does NOT progress:
      - "Verify the URL still contains '<current-path>'" (did not advance), OR
      - "Verify '<Page.StepBadge>' still contains 'Step N'" (wizard did not advance), OR
      - "Verify '<Page.SubmitButton>' is visible" (still on the same form).
   Never guess a message that isn't in the provided context.

FOR API TESTS specifically:
- Assert ONLY on the response STATUS code (e.g., "the response status should be 404"). This is reliable.
- Do NOT assert on specific response body error messages/fields (e.g., "error should contain 'Not Found'") — the actual response structure is unknown and these assertions will fail.
- For GET requests use plain "I send a GET request to '/path'" — NEVER add "with query params:" unless you also provide a data table.
- Keep negative API cases to: invalid endpoint (404), missing body fields, invalid ID format — assert status codes only.

Output ONLY valid JSON — a JSON array of test case objects. No markdown, no explanation.`;

  /**
   * Builds prompt to generate supplementary negative/edge cases based on existing happy-path ACs.
   */
  static buildSupplementaryPrompt(
    parsedACs: { title: string; steps: { action: string; testData: string; expected: string }[] }[],
    pageName: string,
    storyContent: string,
    testData: Record<string, string>,
    sourceValidations: { field: string; message: string; errorKey?: string }[] = []
  ): string {
    const sections: string[] = [];

    // Detect if this is an API story — inject API knowledge for correct patterns
    const isApiStory = /I send a (?:GET|POST|PUT|PATCH|DELETE) request|response status|response body field/i.test(storyContent)
      || parsedACs.some(ac => ac.steps.some(s => /send a .*request|response status/i.test(s.action)));

    if (isApiStory) {
      const { ContextEnricher } = require('../core/ContextEnricher');
      const apiKnowledge = ContextEnricher.getApiKnowledge();
      if (apiKnowledge) {
        sections.push('=== API STEP PATTERNS (use ONLY these exact patterns) ===');
        sections.push(apiKnowledge.substring(0, 3500));
        sections.push('');
      }
    }

    // ── Derive the REQUIRED SETUP PREFIX (web only) ─────────────────────────
    // Negative cases that test a field behind login/registration/wizard steps
    // must first reach that state. We extract the auth + navigation steps from
    // the happy path so the AI can prepend them verbatim.
    if (!isApiStory) {
      const setupPrefix = this._extractSetupPrefix(parsedACs);
      if (setupPrefix.length > 0) {
        sections.push('=== REQUIRED SETUP PREFIX (prepend these steps to reach a valid state) ===');
        sections.push('Every WEB negative case MUST begin with these steps (register/login + navigation),');
        sections.push('then apply ONE negative variation, then assert the flow did NOT advance:');
        setupPrefix.forEach((s, i) => {
          sections.push(`  ${i + 1}. ${s.action}${s.testData ? ` (data: ${s.testData})` : ''}`);
        });
        sections.push('');
      }
    }

    sections.push('=== EXISTING HAPPY PATH TEST CASES ===');
    parsedACs.forEach((ac, i) => {
      sections.push(`\nAC-${i + 1}: ${ac.title}`);
      ac.steps.forEach((s, si) => {
        // Render body tables as proper multi-line Gherkin (not [data: ...] which AI copies wrongly)
        let stepText = `  Step ${si + 1}: ${s.action}`;
        if (s.testData && s.testData.includes('|')) {
          const rows = s.testData.split('\n').filter((l: string) => l.trim().startsWith('|'));
          stepText += '\n' + rows.map((r: string) => `      ${r.trim()}`).join('\n');
        } else if (s.testData) {
          stepText += ` (data: ${s.testData})`;
        }
        if (s.expected) stepText += `\n    → Expected: ${s.expected}`;
        sections.push(stepText);
      });
    });

    if (Object.keys(testData).length > 0) {
      sections.push('\n=== TEST DATA USED IN HAPPY PATH ===');
      Object.entries(testData).forEach(([key, value]) => {
        sections.push(`  ${key}: ${value}`);
      });
    }

    // Extract form fields from the story for negative case generation
    const formFields = storyContent.match(/(?:Enter|Fill|Input|Type).*?(?:into|in)\s+(?:the\s+)?[""]([^""]+)[""]/gi) || [];
    if (formFields.length > 0) {
      sections.push('\n=== FORM FIELDS IDENTIFIED ===');
      formFields.forEach((f) => sections.push(`  - ${f}`));
    }

    // ── REAL validation rules from the app SOURCE (authoritative) ───────────
    // When present, these are the EXACT messages the app shows and the EXACT
    // error element that renders each. Negatives MUST assert these real values
    // (via the error element key) instead of guessing.
    if (sourceValidations.length > 0) {
      sections.push('\n=== REAL VALIDATION RULES (from app source — USE THESE EXACT messages) ===');
      sections.push('Each row: field → exact error message → error element key (assert on this element).');
      const seen = new Set<string>();
      for (const v of sourceValidations) {
        const line = `  - ${v.field} → "${v.message}"` + (v.errorKey ? ` → assert on '${pageName}.${v.errorKey}'` : '');
        if (seen.has(line)) continue;
        seen.add(line);
        sections.push(line);
      }
      sections.push(
        `\nFor a negative case, prefer:\n` +
        `  Then '${pageName}.<ErrorKey>' should have text '<exact message above>'\n` +
        `Only fall back to "flow did not advance" when a field has no known message.`
      );
    }

    sections.push(`
=== YOUR TASK ===
Based on the happy path test cases above, generate 2-4 supplementary test cases that cover:

1. **Negative cases**: What happens when required fields are left empty? What about invalid data formats?
2. **Edge cases**: Boundary values, special characters in inputs, extremely long inputs

RULES:
- Each test case MUST have a clear title starting with what's being tested (e.g., "Login with invalid password", "Submit form with empty required fields")
- Each test case MUST have step-by-step actions (same format as the happy path — navigate, click, enter, verify)
- REACHABILITY: For WEB cases, BEGIN every scenario with the REQUIRED SETUP PREFIX steps
  above (register/login + navigation) so the field/page under test is actually reachable.
  Then apply ONE negative variation (empty field, invalid format, too-long value, etc.).
  Do NOT jump straight to a wizard/inner field without the setup steps — it will fail.
- NO INVENTED ASSERTIONS: Do NOT guess error-message text or redirect URLs. Assert that the
  flow did NOT advance instead:
    * "Verify the URL still contains '<the-path-you-are-on>'", OR
    * "Verify the 'Step Badge' still contains 'Step N'" (wizard did not move to the next step), OR
    * "Verify the '<submit/next button>' is visible" (still on the same form).
  Only assert an exact error message if that literal text appears in the story/context.
- Do NOT repeat the happy path — only generate scenarios that test FAILURE conditions
- Keep it practical — 2-4 cases maximum, focused on the most impactful failures
- Use the same page/navigation context as the happy path

Return ONLY a JSON array of test case objects in this format.
Example (web wizard field behind registration — note the setup prefix and the
"flow did not advance" assertion instead of an invented message):
[
  {
    "title": "Submit Customer Info step with empty required Name",
    "type": "negative",
    "steps": [
      { "action": "Navigate to the application", "testData": "", "expected": "Page loaded successfully" },
      { "action": "Click the 'Create an account' link", "testData": "", "expected": "Register form shown" },
      { "action": "Enter a full name into the 'Full Name' field", "testData": "", "expected": "Value entered" },
      { "action": "Enter an email into the 'Email' field", "testData": "", "expected": "Value entered" },
      { "action": "Enter a password into the 'Password' field", "testData": "", "expected": "Value entered" },
      { "action": "Click the 'Create Account' button", "testData": "", "expected": "Dashboard loaded" },
      { "action": "Click the 'New Connection' button", "testData": "", "expected": "Wizard Step 1 shown" },
      { "action": "Clear the 'Name' field", "testData": "", "expected": "Name field is empty" },
      { "action": "Click the 'Next' button", "testData": "", "expected": "Attempt to advance" },
      { "action": "Verify the 'Step Badge' still contains 'Step 1'", "testData": "", "expected": "Flow did NOT advance — still on Step 1" }
    ]
  }
]

IMPORTANT: Every step MUST have a non-empty "expected" field. For action steps use descriptive expected like "Page loaded successfully", "Value entered in X field", "Button clicked successfully". For verify steps describe what should be observed.`);

    return sections.join('\n');
  }

  /**
   * Extracts the "setup prefix" from the happy path — the authentication +
   * navigation steps needed to reach the main working area (e.g. register/login,
   * then click into the first inner page/wizard). Negative cases prepend these so
   * the field/page under test is actually reachable.
   *
   * Heuristic: collect leading steps until we hit the first data-entry step that
   * belongs to the inner form (i.e., after navigation into it). We keep:
   *   - navigate/open steps
   *   - register/login field entries + submit
   *   - "click ... (account|register|login|sign|new|connection|continue|next)" nav clicks
   * and stop once the flow has entered the first inner step (after the first
   * navigation click that lands on a wizard/step page).
   */
  private static _extractSetupPrefix(
    parsedACs: { title: string; steps: { action: string; testData: string; expected: string }[] }[]
  ): { action: string; testData: string }[] {
    const happy = parsedACs[0];
    if (!happy || !happy.steps || happy.steps.length === 0) return [];

    const prefix: { action: string; testData: string }[] = [];
    let enteredInnerArea = false;

    for (const step of happy.steps) {
      const a = step.action.toLowerCase();

      const isNavigate = /^navigate\b|^open\b/.test(a);
      const isAuthField = /(full name|email|password|user\s?name)/.test(a) && /^enter|^type|^fill/.test(a);
      const isAuthSubmit = /^click/.test(a) && /(create account|register|sign up|sign in|log ?in|submit)/.test(a);
      const isSwitchToRegister = /^click/.test(a) && /(create an account|switch to register|register)/.test(a);
      const isNavClick = /^click/.test(a) && /(new connection|new order|dashboard|continue|next)/.test(a);
      const isReachAssertion = /^verify/.test(a) && /(url|dashboard|welcome|total orders|step badge)/.test(a);

      // Once we've reached the inner working area (first "Step N" appears), and we
      // then encounter an inner data-entry step, stop — the rest is the flow to vary.
      const mentionsStep = /step\s*\d/.test(a);
      if (mentionsStep) enteredInnerArea = true;

      const isInnerDataEntry = enteredInnerArea && /^enter|^type|^fill|^select/.test(a);
      if (isInnerDataEntry) break; // reached the fields to be varied — prefix ends here

      if (isNavigate || isAuthField || isAuthSubmit || isSwitchToRegister || isNavClick || isReachAssertion) {
        prefix.push({ action: step.action, testData: step.testData || '' });
      }

      // Safety cap: a setup prefix should be short.
      if (prefix.length >= 12) break;
    }

    return prefix;
  }

  // ─── Private: Output Schema ───────────────────────────────────────────────

  private static _getOutputSchema(pageName: string): string {
    return JSON.stringify({
      page: pageName,
      url: '<<page url if known>>',
      mode: '<<story or testcases>>',
      aiGenerated: true,
      elements: '<<COPY the elements array EXACTLY as provided in LIVE PAGE ELEMENTS — do NOT modify keys, locators, or casing. If no page snapshot, use []>>',
      testCases: [
        {
          id: 'TC-001',
          title: '<<test case title>>',
          type: '<<happy_path | negative | edge_case | navigation>>',
          navigation: '<<full navigation path e.g. Login → Dashboard → Orders>>',
          steps: [
            {
              stepNo: 1,
              action: '<<exact action to perform>>',
              navigation: '<<navigation step if applicable>>',
              testData: '<<test data value or empty string>>',
              expected: '<<expected result>>',
            },
          ],
          edgeCases: ['<<related edge case description>>'],
        },
      ],
    }, null, 2);
  }
}
