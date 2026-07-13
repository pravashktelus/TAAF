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
   * Returns a structured plan with discovered elements but no AI-generated scenarios.
   */
  static buildStoryFallback(pageName: string, pageSnapshot?: PageSnapshot): string {
    const elements = pageSnapshot?.elements || [];
    const elementList = elements.length > 0
      ? elements.map((e) => `  - [${e.type}] ${e.key}: ${e.locator}`).join('\n')
      : '  - No elements discovered (provide --url to enable live page crawling)';

    return JSON.stringify({
      page: pageName,
      url: pageSnapshot?.url || '',
      mode: 'story',
      aiGenerated: false,
      note: 'AI unavailable — template output. Add OPENAI_API_KEY to enable AI generation.',
      elements: pageSnapshot?.elements || [],
      testCases: [
        {
          id: 'TC-001',
          title: `${pageName} - Happy Path (TODO: fill in from story)`,
          type: 'happy_path',
          navigation: 'TODO: Add navigation path',
          steps: [
            {
              stepNo: 1,
              action: 'TODO: Add step action',
              navigation: '',
              testData: '',
              expected: 'TODO: Add expected result',
            },
          ],
          edgeCases: [],
        },
      ],
      discoveredElements: elementList,
    }, null, 2);
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
