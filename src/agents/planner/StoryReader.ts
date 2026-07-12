import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';

/**
 * Represents a single test step within a test case.
 */
export interface TestStep {
  stepNo: number;
  action: string;
  navigation: string;
  testData: string;
  expected: string;
}

/**
 * Represents a single test case (grouped from multi-row XLS or parsed from story).
 */
export interface TestCase {
  id: string;
  title: string;
  steps: TestStep[];
}

/**
 * Represents an attachment file alongside a story.
 */
export interface Attachment {
  fileName: string;
  type: 'image' | 'document' | 'spreadsheet' | 'text';
  content: string;   // text for docs/spreadsheets, base64 for images
}

/**
 * The unified input object passed to PlanPrompts regardless of source format.
 */
export interface StoryInput {
  mode: 'story' | 'testcases';         // detected or user-specified
  mainContent: string;                  // full story text or formatted test cases text
  testCases: TestCase[];                // populated in testcases mode, empty in story mode
  attachments: Attachment[];            // supporting docs/mockups
  sourcePath: string;                   // original file path
  sourceFileName: string;               // just the filename
}

/**
 * StoryReader
 * -----------
 * Reads user-provided input files from requirements/ folder.
 * Supports: .md, .txt, .docx, .pdf, .xlsx, .xls, images
 * Handles: multi-row XLS grouping, attachment auto-detection, mode detection
 */
export class StoryReader {
  private config: AgentsConfig;
  private storiesDir: string;
  private testCasesDir: string;

  constructor() {
    this.config = AgentsConfig.getInstance();
    this.storiesDir = path.resolve(process.cwd(), 'requirements', 'stories');
    this.testCasesDir = path.resolve(process.cwd(), 'requirements', 'testcases');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Reads a story file and returns a unified StoryInput object.
   * Automatically detects mode (story vs testcases) and loads attachments.
   *
   * @param fileName     - File name (looks in requirements/stories/)
   * @param modeOverride - Force 'story' or 'testcases' mode (skip auto-detection)
   */
  async readStory(fileName: string, modeOverride?: 'story' | 'testcases'): Promise<StoryInput> {
    const filePath = this._resolveFilePath(fileName, 'stories');
    return this._readFile(filePath, modeOverride);
  }

  /**
   * Reads a test cases file and returns a unified StoryInput object.
   * Always sets mode to 'testcases'.
   *
   * @param fileName - File name (looks in requirements/testcases/)
   */
  async readTestCases(fileName: string): Promise<StoryInput> {
    const filePath = this._resolveFilePath(fileName, 'testcases');
    return this._readFile(filePath, 'testcases');
  }

  /**
   * Reads any file by full path.
   * Used when user provides an absolute path (--story "C:/Desktop/sprint5.md").
   */
  async readFromPath(filePath: string, modeOverride?: 'story' | 'testcases'): Promise<StoryInput> {
    return this._readFile(filePath, modeOverride);
  }

  // ─── Private: File Reading ────────────────────────────────────────────────

  private async _readFile(filePath: string, modeOverride?: 'story' | 'testcases'): Promise<StoryInput> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[StoryReader] File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    console.log(`[StoryReader] Reading: ${fileName} (${ext})`);

    let mainContent = '';
    let testCases: TestCase[] = [];

    // Read file based on extension
    switch (ext) {
      case '.md':
      case '.txt':
        mainContent = fs.readFileSync(filePath, 'utf-8');
        break;
      case '.docx':
        mainContent = await this._readDocx(filePath);
        break;
      case '.pdf':
        mainContent = await this._readPdf(filePath);
        break;
      case '.xlsx':
      case '.xls':
        ({ mainContent, testCases } = await this._readXls(filePath));
        break;
      default:
        throw new Error(`[StoryReader] Unsupported file format: ${ext}`);
    }

    // Detect mode
    const mode = modeOverride || this._detectMode(mainContent, testCases, ext);
    console.log(`[StoryReader] Mode detected: ${mode}`);

    // Load attachments (only for story mode files in stories/ folder)
    const attachments = await this._loadAttachments(filePath);
    if (attachments.length > 0) {
      console.log(`[StoryReader] Found ${attachments.length} attachment(s)`);
    }

    return {
      mode,
      mainContent,
      testCases,
      attachments,
      sourcePath: filePath,
      sourceFileName: fileName,
    };
  }

  // ─── Private: Format Readers ──────────────────────────────────────────────

  private async _readDocx(filePath: string): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (error) {
      throw new Error(`[StoryReader] Failed to read .docx: ${error}`);
    }
  }

  private async _readPdf(filePath: string): Promise<string> {
    // Read PDF as buffer and send raw bytes as text
    // For full PDF parsing, users can install pdf-parse: npm install pdf-parse
    try {
      const pdfParse = await import('pdf-parse' as any).catch(() => null);
      if (pdfParse) {
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse.default(buffer);
        return data.text;
      }
      // Fallback: read as buffer, return notice
      console.warn('[StoryReader] pdf-parse not installed. Install with: npm install pdf-parse');
      return `[PDF file: ${path.basename(filePath)}]\nInstall pdf-parse for full text extraction: npm install pdf-parse`;
    } catch (error) {
      return `[PDF file: ${path.basename(filePath)}]\nCould not extract text: ${error}`;
    }
  }

  private async _readXls(filePath: string): Promise<{ mainContent: string; testCases: TestCase[] }> {
    const xlsx = await import('xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, any>[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return { mainContent: '', testCases: [] };
    }

    const cols = this.config.xlsColumns;
    const groupByTcId = this.config.xlsGroupByTcId;

    // Group rows by TC ID (carry-forward algorithm)
    const testCases: TestCase[] = [];
    let currentCase: TestCase | null = null;
    let stepCounter = 0;

    for (const row of rows) {
      const tcId = String(row[cols.tcId] || '').trim();
      const title = String(row[cols.title] || '').trim();
      const action = String(row[cols.action] || '').trim();
      const navigation = String(row[cols.navigation] || '').trim();
      const testData = String(row[cols.testData] || '').trim();
      const expected = String(row[cols.expected] || '').trim();
      const stepNoRaw = String(row[cols.stepNo] || '').trim();
      const stepNo = parseInt(stepNoRaw) || ++stepCounter;

      // New TC ID found → start new test case
      if (tcId && (groupByTcId || !currentCase)) {
        if (currentCase) testCases.push(currentCase);
        stepCounter = 0;
        currentCase = { id: tcId, title, steps: [] };
      }

      // Add step to current test case (skip empty rows)
      if (currentCase && (action || navigation || expected)) {
        currentCase.steps.push({ stepNo, action, navigation, testData, expected });
      }
    }

    // Push last test case
    if (currentCase) testCases.push(currentCase);

    // Convert to plain text for AI prompt
    const mainContent = this._testCasesToText(testCases);

    console.log(`[StoryReader] Parsed ${testCases.length} test case(s) from XLS`);
    return { mainContent, testCases };
  }

  // ─── Private: Attachments ─────────────────────────────────────────────────

  private async _loadAttachments(storyFilePath: string): Promise<Attachment[]> {
    const storyName = path.basename(storyFilePath, path.extname(storyFilePath));
    const attachmentsDir = path.join(this.storiesDir, 'attachments', storyName);

    if (!fs.existsSync(attachmentsDir)) return [];

    const attachments: Attachment[] = [];
    const files = fs.readdirSync(attachmentsDir);

    for (const file of files) {
      if (file.startsWith('.')) continue; // skip .gitkeep etc.
      const filePath = path.join(attachmentsDir, file);
      const ext = path.extname(file).toLowerCase();

      try {
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
          // Image → base64 for AI vision
          const buffer = fs.readFileSync(filePath);
          attachments.push({
            fileName: file,
            type: 'image',
            content: buffer.toString('base64'),
          });
        } else if (ext === '.docx') {
          const text = await this._readDocx(filePath);
          attachments.push({ fileName: file, type: 'document', content: text });
        } else if (['.xlsx', '.xls'].includes(ext)) {
          const { mainContent } = await this._readXls(filePath);
          attachments.push({ fileName: file, type: 'spreadsheet', content: mainContent });
        } else if (['.md', '.txt', '.pdf'].includes(ext)) {
          const text = ext === '.pdf'
            ? await this._readPdf(filePath)
            : fs.readFileSync(filePath, 'utf-8');
          attachments.push({ fileName: file, type: 'text', content: text });
        }
      } catch (error) {
        console.warn(`[StoryReader] Could not read attachment ${file}: ${error}`);
      }
    }

    return attachments;
  }

  // ─── Private: Mode Detection ──────────────────────────────────────────────

  private _detectMode(content: string, testCases: TestCase[], ext: string): 'story' | 'testcases' {
    // XLS with parsed test cases → always testcases mode
    if (['.xlsx', '.xls'].includes(ext) && testCases.length > 0) return 'testcases';

    // Heuristic scan on text content
    const testCaseSignals = [
      /TC-\d+/i,
      /Test\s*Case\s*(ID|No|#)/i,
      /Step\s*No/i,
      /Expected\s*Result/i,
      /Pre-?condition/i,
    ];

    const storySignals = [
      /As\s+a\s+.+\s+I\s+want/i,
      /Acceptance\s+Criteria/i,
      /Given\s+.+When\s+.+Then/i,
      /User\s+Story/i,
      /Feature\s+Description/i,
      /Background:/i,
    ];

    const tcScore = testCaseSignals.filter((r) => r.test(content)).length;
    const storyScore = storySignals.filter((r) => r.test(content)).length;

    if (tcScore > storyScore) return 'testcases';
    if (storyScore >= tcScore) return 'story'; // default to story when unclear
    return 'story';
  }

  // ─── Private: Utilities ───────────────────────────────────────────────────

  private _resolveFilePath(fileName: string, type: 'stories' | 'testcases'): string {
    // If absolute path provided, use as-is
    if (path.isAbsolute(fileName) || fileName.includes('/') || fileName.includes('\\')) {
      return fileName;
    }
    // Otherwise look in the appropriate requirements subfolder
    const baseDir = type === 'stories' ? this.storiesDir : this.testCasesDir;
    return path.join(baseDir, fileName);
  }

  private _testCasesToText(testCases: TestCase[]): string {
    return testCases.map((tc) => {
      const stepLines = tc.steps.map((s) => {
        const parts = [`  Step ${s.stepNo}:`];
        if (s.navigation) parts.push(`Navigation: ${s.navigation}`);
        if (s.action) parts.push(`Action: ${s.action}`);
        if (s.testData) parts.push(`Test Data: ${s.testData}`);
        if (s.expected) parts.push(`Expected: ${s.expected}`);
        return parts.join(' | ');
      }).join('\n');
      return `${tc.id}: ${tc.title}\n${stepLines}`;
    }).join('\n\n');
  }
}
