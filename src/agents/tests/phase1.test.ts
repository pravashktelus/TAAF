/**
 * Agent Module Smoke Tests — Phase 1 + Phase 2
 * ---------------------------------------------
 * Tests AgentsConfig, LLMClient, PageCrawler, StoryReader, PlanPrompts, PlanFormatter
 * without requiring an OpenAI key or live app for most tests.
 *
 * Run: npm run agent:test
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PageCrawler } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { StoryReader } from '../planner/StoryReader';
import { PlanPrompts } from '../planner/PlanPrompts';
import { PlanFormatter } from '../planner/PlanFormatter';
import { PropertiesWriter } from '../generator/PropertiesWriter';
import { FeatureWriter } from '../generator/FeatureWriter';
import { GeneratePrompts } from '../generator/GeneratePrompts';
import { ReportReader } from '../healer/ReportReader';
import { FailureClassifier } from '../healer/FailureClassifier';
import { HealingReportWriter } from '../healer/HealingReportWriter';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// ─── Phase 1: AgentsConfig ────────────────────────────────────────────────────
async function testAgentsConfig(): Promise<void> {
  console.log('\n[Test 1] AgentsConfig');
  const config = AgentsConfig.getInstance();
  assert(config !== null, 'getInstance() returns instance');
  assert(AgentsConfig.getInstance() === config, 'Singleton returns same instance');
  assert(typeof config.enabled === 'boolean', 'enabled is boolean');
  assert(typeof config.aiModel === 'string' && config.aiModel.length > 0, `aiModel: "${config.aiModel}"`);
  assert(typeof config.aiProvider === 'string', `aiProvider: "${config.aiProvider}"`);
  assert(typeof config.outputDir === 'string', `outputDir: "${config.outputDir}"`);
  assert(typeof config.appUrl === 'string', `appUrl: "${config.appUrl}"`);
  assert(['openai', 'anthropic', 'ollama'].includes(config.aiProvider), `aiProvider is valid: "${config.aiProvider}"`);
  assert(typeof config.xlsColumns === 'object', 'xlsColumns returns object');
  assert(typeof config.xlsColumns.tcId === 'string', `xlsColumns.tcId: "${config.xlsColumns.tcId}"`);
  assert(typeof config.xlsGroupByTcId === 'boolean', `xlsGroupByTcId: ${config.xlsGroupByTcId}`);
}

// ─── Phase 1: LLMClient Fallback ─────────────────────────────────────────────
async function testLLMClientFallback(): Promise<void> {
  console.log('\n[Test 2] LLMClient — NoOp Fallback');
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  (AgentsConfig as any).instance = undefined;

  const fallback = '# Fallback Plan';
  assert(await LLMClient.ask('test', fallback) === fallback, 'ask() returns fallback when no key');
  assert(await LLMClient.askWithSystem('sys', 'user', fallback) === fallback, 'askWithSystem() returns fallback when no key');
  assert(await LLMClient.ask('test') === '', 'ask() returns empty string when no fallback');

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  (AgentsConfig as any).instance = undefined;
}

// ─── Phase 1: PageCrawler Utilities ──────────────────────────────────────────
async function testPageCrawlerUtility(): Promise<void> {
  console.log('\n[Test 3] PageCrawler — snapshotToText');
  const snapshot = {
    url: 'https://simulapp.online/login',
    title: 'Login',
    elements: [{ key: 'BtnLogin', locator: "//button[@data-testid='login-submit']", type: 'button', label: 'Login', tag: 'button' }],
    navigationLinks: [{ text: 'Home', href: '/' }],
    forms: [{ id: 'login-form', fields: ['email'] }],
    rawHTML: '<form></form>',
  };
  const text = PageCrawler.snapshotToText(snapshot);
  assert(text.includes('Login'), 'includes page title');
  assert(text.includes('BtnLogin'), 'includes element key');
  assert(text.includes('Home'), 'includes nav link');
}

// ─── Phase 1: PageCrawler Lifecycle ──────────────────────────────────────────
async function testPageCrawlerLifecycle(): Promise<void> {
  console.log('\n[Test 4] PageCrawler — browser lifecycle');
  const crawler = new PageCrawler();
  assert(crawler.getPage() === null, 'null before launch');
  await crawler.launch();
  assert(crawler.getPage() !== null, 'page exists after launch');
  await crawler.close();
  assert(crawler.getPage() === null, 'null after close');
}

// ─── Phase 2: StoryReader — MD file ──────────────────────────────────────────
async function testStoryReaderMarkdown(): Promise<void> {
  console.log('\n[Test 5] StoryReader — Markdown story file');

  // Create a temp story file
  const tempDir = path.resolve(process.cwd(), 'requirements', 'stories');
  const tempFile = path.join(tempDir, '_test-story.md');
  fs.writeFileSync(tempFile, `# Order Creation Story\n\nAs a sales agent, I want to create a new order.\n\nAcceptance Criteria:\n- User can select a customer\n- User can add products\n- Order is confirmed on submit`, 'utf-8');

  try {
    const reader = new StoryReader();
    const input = await reader.readStory('_test-story.md');
    assert(input.mode === 'story', `mode detected as story: ${input.mode}`);
    assert(input.mainContent.includes('As a sales agent'), 'mainContent contains story text');
    assert(input.sourceFileName === '_test-story.md', 'sourceFileName correct');
    assert(Array.isArray(input.attachments), 'attachments is array');
    assert(Array.isArray(input.testCases), 'testCases is array');
  } finally {
    fs.unlinkSync(tempFile);
  }
}

// ─── Phase 2: StoryReader — XLS file ─────────────────────────────────────────
async function testStoryReaderXls(): Promise<void> {
  console.log('\n[Test 6] StoryReader — XLS test cases (carry-forward grouping)');

  const xlsx = await import('xlsx');
  const tempDir = path.resolve(process.cwd(), 'requirements', 'testcases');
  const tempFile = path.join(tempDir, '_test-cases.xlsx');

  // Build a mock XLS with multi-row test cases
  const rows = [
    { 'TC ID': 'TC-001', 'Title': 'Login Happy Path', 'Step No': 1, 'Action': 'Navigate to login', 'Navigation': 'Open browser', 'Test Data': '', 'Expected Result': 'Login page shown' },
    { 'TC ID': '',        'Title': '',                 'Step No': 2, 'Action': 'Enter credentials',  'Navigation': '',             'Test Data': 'user@test.com', 'Expected Result': 'Fields populated' },
    { 'TC ID': '',        'Title': '',                 'Step No': 3, 'Action': 'Click Login',         'Navigation': '',             'Test Data': '',              'Expected Result': 'Dashboard shown' },
    { 'TC ID': 'TC-002', 'Title': 'Empty Form',        'Step No': 1, 'Action': 'Click Login empty',  'Navigation': '',             'Test Data': '',              'Expected Result': 'Errors shown' },
  ];
  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'TestCases');
  xlsx.writeFile(wb, tempFile);

  try {
    const reader = new StoryReader();
    const input = await reader.readTestCases('_test-cases.xlsx');
    assert(input.mode === 'testcases', `mode detected as testcases: ${input.mode}`);
    assert(input.testCases.length === 2, `2 test cases parsed: ${input.testCases.length}`);
    assert(input.testCases[0].id === 'TC-001', `first TC ID: ${input.testCases[0].id}`);
    assert(input.testCases[0].steps.length === 3, `TC-001 has 3 steps: ${input.testCases[0].steps.length}`);
    assert(input.testCases[1].id === 'TC-002', `second TC ID: ${input.testCases[1].id}`);
    assert(input.testCases[1].steps.length === 1, `TC-002 has 1 step: ${input.testCases[1].steps.length}`);
    assert(input.mainContent.includes('TC-001'), 'mainContent includes TC-001');
  } finally {
    fs.unlinkSync(tempFile);
  }
}

// ─── Phase 2: PlanPrompts ─────────────────────────────────────────────────────
async function testPlanPrompts(): Promise<void> {
  console.log('\n[Test 7] PlanPrompts — prompt and fallback building');

  const storyInput = {
    mode: 'story' as const,
    mainContent: 'As a sales agent, I want to create a new order.',
    testCases: [],
    attachments: [],
    sourcePath: 'requirements/stories/orders.md',
    sourceFileName: 'orders.md',
  };

  const tcInput = {
    mode: 'testcases' as const,
    mainContent: 'TC-001: Login\nStep 1: Navigate',
    testCases: [{ id: 'TC-001', title: 'Login', steps: [] }],
    attachments: [],
    sourcePath: '',
    sourceFileName: 'orders.xlsx',
  };

  const storyPrompt = PlanPrompts.buildStoryPrompt(storyInput, 'Orders');
  assert(storyPrompt.includes('As a sales agent'), 'story prompt includes story content');
  assert(storyPrompt.includes('Orders'), 'story prompt includes page name');
  assert(storyPrompt.includes('Happy path') || storyPrompt.includes('happy path') || storyPrompt.includes('Happy Path'), 'story prompt requests happy path');

  const tcPrompt = PlanPrompts.buildTestCasesPrompt(tcInput, 'Orders');
  assert(tcPrompt.includes('TC-001'), 'testcases prompt includes TC ID');
  assert(tcPrompt.includes('PRESERVE') || tcPrompt.includes('preserve'), 'testcases prompt says preserve');

  const storyFallback = PlanPrompts.buildStoryFallback('Orders', undefined, '');
  assert(storyFallback.includes('Orders'), 'story fallback includes page name');
  assert(storyFallback.includes('aiGenerated'), 'story fallback is valid JSON-like');

  const tcFallback = PlanPrompts.buildTestCasesFallback('Orders', tcInput);
  assert(tcFallback.includes('TC-001'), 'testcases fallback includes TC ID');

  assert(typeof PlanPrompts.SYSTEM_PROMPT === 'string' && PlanPrompts.SYSTEM_PROMPT.length > 0, 'SYSTEM_PROMPT is non-empty');
}

// ─── PropertiesRegistry ───────────────────────────────────────────────────────
async function testPropertiesRegistry(): Promise<void> {
  console.log('\n[Test 8b] PropertiesRegistry — element matching');

  const registry = new PropertiesRegistry();
  registry.load();

  assert(registry.size > 0, `Registry loaded ${registry.size} elements from existing .properties files`);

  const pageNames = registry.getPageNames();
  assert(pageNames.length > 0, `Registry has page names: ${pageNames.join(', ')}`);
  assert(pageNames.includes('TeleConnect'), 'TeleConnect page registered');

  // Test: known existing locator + matching page → should reuse
  const existingMatch = registry.findMatch(
    "//button[@data-testid='login-submit']",
    'TeleConnect',
    'BtnLogin'
  );
  assert(existingMatch.source === 'existing', `Known locator on same page → existing: ${existingMatch.ref}`);
  assert(existingMatch.ref === 'TeleConnect.LoginSubmit', `Ref is TeleConnect.LoginSubmit: ${existingMatch.ref}`);

  // Test: known locator on different page → should create new
  const diffPageMatch = registry.findMatch(
    "//button[@data-testid='login-submit']",
    'Orders',
    'BtnSubmit'
  );
  assert(diffPageMatch.source === 'new', `Same locator different page → new: ${diffPageMatch.ref}`);
  assert(diffPageMatch.ref === 'Orders.BtnSubmit', `New ref is Orders.BtnSubmit: ${diffPageMatch.ref}`);

  // Test: unknown locator → always new
  const unknownMatch = registry.findMatch(
    "//button[@data-testid='brand-new-button']",
    'Orders',
    'BtnNewFeature'
  );
  assert(unknownMatch.source === 'new', `Unknown locator → new: ${unknownMatch.ref}`);

  // Test: get elements for a page
  const teleConnectElements = registry.getPageElements('TeleConnect');
  assert(teleConnectElements.length > 0, `TeleConnect has ${teleConnectElements.length} elements`);
  assert(teleConnectElements[0].pageName === 'TeleConnect', 'Element pageName is TeleConnect');
}


async function testPlanFormatter(): Promise<void> {
  console.log('\n[Test 8] PlanFormatter — writes .json and .md output files');

  const mockAIResponse = JSON.stringify({
    page: 'TestPage',
    url: 'https://simulapp.online/test',
    mode: 'story',
    aiGenerated: true,
    elements: [{ key: 'BtnSubmit', locator: "//button[@data-testid='submit']", type: 'button', label: 'Submit' }],
    testCases: [
      {
        id: 'TC-001',
        title: 'Happy Path',
        type: 'happy_path',
        navigation: 'Login → Dashboard',
        steps: [
          { stepNo: 1, action: 'Click Submit', navigation: '', testData: '', expected: 'Success' }
        ],
        edgeCases: ['TC-001a: Empty form → validation error'],
      },
    ],
  });

  const formatter = new PlanFormatter();
  const { mdPath, jsonPath } = formatter.format(mockAIResponse, 'TestPage', 'test-story.md');

  assert(fs.existsSync(jsonPath), `JSON file written: ${jsonPath}`);
  assert(fs.existsSync(mdPath), `MD file written: ${mdPath}`);

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert(json.page === 'TestPage', 'JSON page is TestPage');
  assert(json.testCases.length === 1, 'JSON has 1 test case');
  assert(json.testCases[0].id === 'TC-001', 'JSON TC ID is TC-001');
  assert(typeof json.generatedAt === 'string', 'JSON has generatedAt timestamp');

  const md = fs.readFileSync(mdPath, 'utf-8');
  assert(md.includes('TestPage'), 'MD includes page name');
  assert(md.includes('TC-001'), 'MD includes TC-001');
  assert(md.includes('Happy Path'), 'MD includes test case title');
  assert(md.includes('BtnSubmit'), 'MD includes element key');
  assert(md.includes('agent:generate'), 'MD includes next step command');

  // Cleanup
  fs.unlinkSync(jsonPath);
  fs.unlinkSync(mdPath);
}

// ─── Phase 3: PropertiesWriter ────────────────────────────────────────────────
async function testPropertiesWriter(): Promise<void> {
  console.log('\n[Test 10] PropertiesWriter — create and append');

  const writer = new PropertiesWriter();
  const testPage = '_TestGeneratorPage';
  const testPropsPath = path.resolve(process.cwd(), 'src', 'pages', 'properties', `${testPage}.properties`);

  // Cleanup before test
  if (fs.existsSync(testPropsPath)) fs.unlinkSync(testPropsPath);

  const newElements = [
    { key: 'BtnSubmit', locator: "//button[@data-testid='submit']", type: 'button', label: 'Submit', tag: 'button', source: 'new' },
    { key: 'InputName', locator: "//input[@data-testid='name']", type: 'input', label: 'Name', tag: 'input', source: 'new' },
    { key: 'ExistingBtn', locator: "//button[@data-testid='existing']", type: 'button', label: 'Existing', tag: 'button', source: 'existing' },
  ];

  // Test create
  const propsPath = writer.write(testPage, newElements as any);
  assert(fs.existsSync(propsPath), `Properties file created: ${propsPath}`);

  const content = fs.readFileSync(propsPath, 'utf-8');
  assert(content.includes('BtnSubmit'), 'New button element written');
  assert(content.includes('InputName'), 'New input element written');
  assert(!content.includes('ExistingBtn'), 'Existing element NOT written (skipped correctly)');

  // Test append — write again with a new element
  const moreElements = [
    { key: 'BtnCancel', locator: "//button[@data-testid='cancel']", type: 'button', label: 'Cancel', tag: 'button', source: 'new' },
    { key: 'BtnSubmit', locator: "//button[@data-testid='submit']", type: 'button', label: 'Submit', tag: 'button', source: 'new' }, // duplicate key
  ];
  writer.write(testPage, moreElements as any);

  const updatedContent = fs.readFileSync(propsPath, 'utf-8');
  assert(updatedContent.includes('BtnCancel'), 'New element appended');
  const submitCount = (updatedContent.match(/BtnSubmit=/g) || []).length;
  assert(submitCount === 1, `Duplicate key not written twice (count: ${submitCount})`);

  // Cleanup
  fs.unlinkSync(testPropsPath);
}

// ─── Phase 3: FeatureWriter ───────────────────────────────────────────────────
async function testFeatureWriter(): Promise<void> {
  console.log('\n[Test 11] FeatureWriter — review copy and apply');

  const writer = new FeatureWriter();
  const sampleFeature = `@web @test_web\nFeature: Test Page\n\n  @smoke\n  Scenario: TC-001 Happy Path\n    Given I navigate to the application\n    Then 'Test.Element' should be visible\n`;

  // Test review copy (default)
  const reviewPath = writer.write(sampleFeature, 'TestPage', 'Support-plan_from_story', false);
  assert(fs.existsSync(reviewPath), `Review copy created: ${reviewPath}`);
  assert(reviewPath.includes('generated'), 'Review copy in generated/ folder');
  assert(reviewPath.includes('testpage_from'), 'Review copy has correct name');
  const content = fs.readFileSync(reviewPath, 'utf-8');
  assert(content.includes('@web @test_web'), 'Feature content correct');

  // Cleanup
  fs.unlinkSync(reviewPath);
}

// ─── Phase 3: GeneratePrompts ─────────────────────────────────────────────────
async function testGeneratePrompts(): Promise<void> {
  console.log('\n[Test 12] GeneratePrompts — prompt and fallback building');

  const mockPlan = {
    page: 'Support',
    url: 'https://simulapp.online/support',
    mode: 'story',
    aiGenerated: true,
    generatedAt: new Date().toISOString(),
    sourceFile: 'CustomerSupport_Story1.md',
    elements: [],
    testCases: [
      {
        id: 'TC-001',
        title: 'Happy Path',
        type: 'happy_path',
        navigation: 'Login → Orders → Support',
        steps: [{ stepNo: 1, action: 'Click Support', navigation: '', testData: '', expected: 'Dialog opens' }],
        edgeCases: [],
      },
    ],
  };

  const elementRefs = new Map([
    ['BtnSubmit', 'Support.BtnSubmit'],
    ['NavOrders', 'CustomerSupport.NavOrders'],
  ]);

  const prompt = GeneratePrompts.buildPrompt(mockPlan as any, elementRefs);
  assert(prompt.includes('TC-001'), 'Prompt includes TC-001');
  assert(prompt.includes('Support.BtnSubmit'), 'Prompt includes element ref');
  assert(prompt.includes('I click'), 'Prompt includes step patterns');
  assert(prompt.includes('@web'), 'Prompt includes tag conventions');

  const fallback = GeneratePrompts.buildFallback(mockPlan as any, elementRefs);
  assert(fallback.includes('@web @support_web'), 'Fallback has correct tags');
  assert(fallback.includes('TC-001'), 'Fallback includes TC ID');
  assert(fallback.includes('Given I navigate to the application'), 'Fallback has navigation step');
  assert(fallback.includes('Scenario:'), 'Fallback has scenario keyword');

  assert(typeof GeneratePrompts.SYSTEM_PROMPT === 'string' && GeneratePrompts.SYSTEM_PROMPT.length > 0, 'SYSTEM_PROMPT non-empty');
  assert(typeof GeneratePrompts.STEP_PATTERNS === 'string' && GeneratePrompts.STEP_PATTERNS.length > 0, 'STEP_PATTERNS non-empty');
}
async function testPageCrawlerLiveCrawl(): Promise<void> {
  console.log('\n[Test 9] PageCrawler — crawl live app URL');
  const config = AgentsConfig.getInstance();
  if (!config.appUrl) {
    console.warn('  ⚠️  SKIP: app.url not configured');
    return;
  }
  const crawler = new PageCrawler();
  await crawler.launch();
  try {
    const snapshot = await crawler.crawl(config.appUrl);
    assert(typeof snapshot.title === 'string', `title: "${snapshot.title}"`);
    assert(Array.isArray(snapshot.elements), 'elements is array');
    assert(snapshot.elements.length > 0, `discovered ${snapshot.elements.length} elements`);
    if (snapshot.elements.length > 0) {
      assert(typeof snapshot.elements[0].key === 'string', `first key: "${snapshot.elements[0].key}"`);
      assert(typeof snapshot.elements[0].locator === 'string', `first locator: "${snapshot.elements[0].locator}"`);
    }
  } finally {
    await crawler.close();
  }
}

// ─── Phase 4: ReportReader ────────────────────────────────────────────────────
async function testReportReader(): Promise<void> {
  console.log('\n[Test 13] ReportReader — reads cucumber report');

  const reader = new ReportReader();

  // Test with real report
  const reportPath = path.resolve(process.cwd(), 'reports', 'cucumber-json', 'cucumber-report.json');
  if (!fs.existsSync(reportPath)) {
    console.warn('  ⚠️  SKIP: No cucumber-report.json found. Run npm test first.');
    return;
  }

  const summary = reader.read(reportPath);
  assert(typeof summary.totalScenarios === 'number', `totalScenarios is number: ${summary.totalScenarios}`);
  assert(summary.totalScenarios > 0, `totalScenarios > 0: ${summary.totalScenarios}`);
  assert(Array.isArray(summary.scenarios), 'scenarios is array');
  assert(Array.isArray(summary.healedElements), 'healedElements is array');
  assert(typeof summary.runDate === 'string', 'runDate is string');
  assert(
    summary.passed + summary.failed + summary.skipped === summary.totalScenarios,
    `counts add up: ${summary.passed}+${summary.failed}+${summary.skipped}=${summary.totalScenarios}`
  );
  console.log(`  ℹ️  ${summary.totalScenarios} scenarios, ${summary.healedElements.length} healed elements`);
}

// ─── Phase 4: FailureClassifier ───────────────────────────────────────────────
async function testFailureClassifier(): Promise<void> {
  console.log('\n[Test 14] FailureClassifier — classifies failures correctly');

  const classifier = new FailureClassifier();

  // Mock summary with various failure types
  const mockSummary = {
    totalScenarios: 4,
    passed: 1,
    failed: 3,
    skipped: 0,
    runDate: new Date().toISOString(),
    healedElements: [
      { elementRef: 'TeleConnect.BtnNewConnection', pageName: 'TeleConnect', elementKey: 'BtnNewConnection', screenshotPath: 'reports/screenshots/healed_TeleConnect_BtnNewConnection_123.png' }
    ],
    scenarios: [
      // Passed scenario
      {
        id: 'tc-001', name: 'Register new account', featureFile: 'features/web/1_teleconnect.feature',
        status: 'passed' as const, steps: [{ keyword: 'Given', name: 'I navigate', status: 'passed' as const }],
        tags: ['@smoke'], duration: 5000
      },
      // App fault - assertion failure
      {
        id: 'tc-002', name: 'Verify ticket status', featureFile: 'features/web/6_customersupport.feature',
        status: 'failed' as const,
        steps: [{ keyword: 'Then', name: 'status should have text OPEN', status: 'failed' as const,
          errorMessage: 'expect(locator).toHaveText() failed\nExpected: "OPEN"\nReceived: ""' }],
        failedStep: { keyword: 'Then', name: 'status should have text OPEN', status: 'failed' as const,
          errorMessage: 'expect(locator).toHaveText() failed\nExpected: "OPEN"\nReceived: ""' },
        tags: ['@smoke'], duration: 3000
      },
      // Test fault - locator timeout
      {
        id: 'tc-003', name: 'Click support button', featureFile: 'features/web/6_customersupport.feature',
        status: 'failed' as const,
        steps: [{ keyword: 'When', name: "I click 'CustomerSupport.BtnSupport'", status: 'failed' as const,
          errorMessage: 'Timeout 30000ms exceeded waiting for locator' }],
        failedStep: { keyword: 'When', name: "I click 'CustomerSupport.BtnSupport'", status: 'failed' as const,
          errorMessage: 'Timeout 30000ms exceeded waiting for locator' },
        tags: ['@smoke'], duration: 30000
      },
      // Passed but healed
      {
        id: 'tc-004', name: 'Place new order', featureFile: 'features/web/1_teleconnect.feature',
        status: 'passed' as const,
        steps: [{ keyword: 'When', name: "I click 'TeleConnect.BtnNewConnection'", status: 'passed' as const }],
        tags: ['@smoke'], duration: 8000
      },
    ]
  };

  const classifications = await classifier.classifyAll(mockSummary as any);

  assert(classifications.length === 4, `4 classifications returned: ${classifications.length}`);

  const passed = classifications.find((c) => c.scenarioName === 'Register new account');
  assert(passed?.classification === 'passed', `passed scenario classified as passed: ${passed?.classification}`);

  const appFault = classifications.find((c) => c.scenarioName === 'Verify ticket status');
  assert(appFault?.classification === 'app_fault', `assertion failure → app_fault: ${appFault?.classification}`);

  const testFault = classifications.find((c) => c.scenarioName === 'Click support button');
  assert(testFault?.classification === 'test_fault', `timeout → test_fault: ${testFault?.classification}`);

  const healed = classifications.find((c) => c.scenarioName === 'Place new order');
  assert(healed?.classification === 'healed', `passed with healed element → healed: ${healed?.classification}`);
}

// ─── Phase 4: HealingReportWriter ────────────────────────────────────────────
async function testHealingReportWriter(): Promise<void> {
  console.log('\n[Test 15] HealingReportWriter — writes healing reports');

  const mockClassifications = [
    {
      scenarioName: 'Verify ticket status',
      featureFile: 'features/web/6_customersupport.feature',
      status: 'failed' as const,
      classification: 'app_fault' as const,
      confidence: 'high' as const,
      reason: 'Assertion failed — wrong value',
      action: '🐛 Raise a defect',
      failedStep: "Then 'CustomerSupport.TicketStatus' should have text 'OPEN'",
      errorMessage: 'Expected OPEN received empty',
    },
    {
      scenarioName: 'Register new account',
      featureFile: 'features/web/1_teleconnect.feature',
      status: 'passed' as const,
      classification: 'passed' as const,
      confidence: 'high' as const,
      reason: 'Scenario passed successfully.',
      action: 'No action needed.',
    },
  ];

  const mockSummary = {
    totalScenarios: 2, passed: 1, failed: 1, skipped: 0,
    runDate: new Date().toISOString(),
    healedElements: [],
    scenarios: [],
  };

  const writer = new HealingReportWriter();
  const { mdPath, jsonPath } = writer.write(mockClassifications as any, mockSummary as any);

  assert(fs.existsSync(mdPath), `MD report created: ${mdPath}`);
  assert(fs.existsSync(jsonPath), `JSON report created: ${jsonPath}`);

  const md = fs.readFileSync(mdPath, 'utf-8');
  assert(md.includes('Healing Report'), 'MD includes report header');
  assert(md.includes('APP BUG'), 'MD includes app fault classification');
  assert(md.includes('Verify ticket status'), 'MD includes scenario name');
  assert(md.includes('No Action Needed'), 'MD includes passed section');

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert(json.summary.appFaults === 1, `JSON has 1 app fault: ${json.summary.appFaults}`);
  assert(json.classifications.length === 2, `JSON has 2 classifications: ${json.classifications.length}`);

  // Cleanup
  fs.unlinkSync(mdPath);
  fs.unlinkSync(jsonPath);
}

// ─── Run All ──────────────────────────────────────────────────────────────────
async function runAll(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Agent Module Smoke Tests (Phase 1 + 2)');
  console.log('═══════════════════════════════════════════');

  await testAgentsConfig();
  await testLLMClientFallback();
  await testPageCrawlerUtility();
  await testPageCrawlerLifecycle();
  await testStoryReaderMarkdown();
  await testStoryReaderXls();
  await testPlanPrompts();
  await testPropertiesRegistry();
  await testPlanFormatter();
  await testPropertiesWriter();
  await testFeatureWriter();
  await testGeneratePrompts();
  await testReportReader();
  await testFailureClassifier();
  await testHealingReportWriter();
  await testPageCrawlerLiveCrawl();

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runAll().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
