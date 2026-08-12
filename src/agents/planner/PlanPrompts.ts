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
      sections.push('\n=== LIVE PAGE ELEMENTS ===');
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
      sections.push('\n=== LIVE PAGE ELEMENTS ===');
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

    // Find the "Acceptance Criteria" section
    const acSectionMatch = content.match(/(?:Acceptance\s+Criteria|ACs?)[\s:]*\n([\s\S]*?)(?=\n##\s|\n\*\*[A-Z]|\nTest\s+Data|\nTags|\nNotes|\nPre-conditions|$)/i);
    if (!acSectionMatch) return results;

    const acSection = acSectionMatch[1];

    // Split by AC headers: "### AC-1:", "AC-1:", or numbered list "1."
    const acPattern = /(?:^|\n)(?:#{1,3}\s*)?(?:AC-?\d+[\s:.]+|(\d+)\.\s+)([^\n]+)/gi;
    const acHeaders: { index: number; title: string }[] = [];
    let match;

    while ((match = acPattern.exec(acSection)) !== null) {
      const title = match[2]?.trim() || match[0].replace(/^[\s#]*(?:AC-?\d+[\s:.]+|\d+\.\s+)/, '').trim();
      acHeaders.push({ index: match.index, title });
    }

    if (acHeaders.length === 0) return results;

    // Extract steps for each AC
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
   * Parses Given/When/Then steps from an AC body text.
   */
  private static _parseACSteps(acBody: string): { action: string; testData: string; expected: string }[] {
    const steps: { action: string; testData: string; expected: string }[] = [];
    const lines = acBody.split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);

    let currentAction = '';
    let currentTestData = '';
    let currentExpected = '';

    for (const line of lines) {
      // Skip the AC header line itself
      if (line.match(/^(?:#{1,3}\s*)?(?:AC-?\d+|^\d+\.)/i)) continue;

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

  // ─── Private: Output Schema ───────────────────────────────────────────────

  private static _getOutputSchema(pageName: string): string {
    return JSON.stringify({
      page: pageName,
      url: '<<page url if known>>',
      mode: '<<story or testcases>>',
      aiGenerated: true,
      elements: '<<array of discovered elements if page snapshot provided, else []>>',
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
