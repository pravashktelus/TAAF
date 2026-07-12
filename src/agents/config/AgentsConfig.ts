import * as fs from 'fs';
import * as path from 'path';

/**
 * AgentsConfig
 * ------------
 * Reads agent-specific configuration from framework.properties.
 * Completely isolated from the main FrameworkConfig used by test execution.
 * Adding/changing these keys has ZERO effect on npm test.
 */
export class AgentsConfig {
  private static instance: AgentsConfig;
  private config: Map<string, string> = new Map();

  private constructor() {
    this._load();
  }

  // Singleton — one config instance per agent run
  static getInstance(): AgentsConfig {
    if (!this.instance) {
      this.instance = new AgentsConfig();
    }
    return this.instance;
  }

  // ─── Agent Config Accessors ───────────────────────────────────────────────

  // Master toggle — when false, agents exit early with a message
  get enabled(): boolean {
    return this._getBool('agents.enabled', true);
  }

  // AI provider to use: openai | anthropic | ollama (default: openai)
  get aiProvider(): string {
    return this._get('agents.ai.provider', 'openai');
  }

  // AI model to use — default depends on provider
  get aiModel(): string {
    const defaults: Record<string, string> = {
      openai: 'gpt-4-turbo',
      anthropic: 'claude-3-5-sonnet-20241022',
      ollama: 'llama3',
    };
    return this._get('agents.ai.model', defaults[this.aiProvider] || 'gpt-4-turbo');
  }

  // Output directory for all agent-generated artifacts
  get outputDir(): string {
    return this._get('agents.output.dir', 'generated');
  }

  // App URL — reused from existing framework config (read-only)
  get appUrl(): string {
    return this._get('app.url', '');
  }

  // Browser — reused from existing framework config (read-only)
  get browser(): string {
    return this._get('browser', 'chromium');
  }

  // Test user credentials — reused from existing framework config (read-only)
  get testUserEmail(): string {
    return process.env.TEST_EMAIL || `test@${this._get('test.user.emailDomain', 'test.local')}`;
  }

  get testUserPassword(): string {
    return this._get('test.user.password', '');
  }

  // OpenAI API key — read from environment variable (set in features/.env)
  get openAIApiKey(): string {
    return process.env.OPENAI_API_KEY || '';
  }

  // Anthropic API key — read from environment variable
  get anthropicApiKey(): string {
    return process.env.ANTHROPIC_API_KEY || '';
  }

  // Ollama base URL — defaults to local instance
  get ollamaBaseUrl(): string {
    return process.env.OLLAMA_BASE_URL || this._get('agents.ollama.url', 'http://localhost:11434');
  }

  // ─── XLS Column Mapping ───────────────────────────────────────────────────

  // Returns XLS column header mappings for test case files
  get xlsColumns(): Record<string, string> {
    return {
      tcId:       this._get('agents.xls.col.tcId',       'TC ID'),
      title:      this._get('agents.xls.col.title',      'Title'),
      stepNo:     this._get('agents.xls.col.stepNo',     'Step No'),
      action:     this._get('agents.xls.col.action',     'Action'),
      navigation: this._get('agents.xls.col.navigation', 'Navigation'),
      testData:   this._get('agents.xls.col.testData',   'Test Data'),
      expected:   this._get('agents.xls.col.expected',   'Expected Result'),
    };
  }

  // Whether to group XLS rows by TC ID (carry-forward for multi-row test cases)
  get xlsGroupByTcId(): boolean {
    return this._getBool('agents.xls.groupByTcId', true);
  }

  // Whether AI calls are possible — checks correct key per provider
  get aiEnabled(): boolean {
    if (!this.enabled) return false;
    switch (this.aiProvider) {
      case 'anthropic': return !!this.anthropicApiKey;
      case 'ollama':    return true; // Ollama runs locally, no key needed
      default:          return !!this.openAIApiKey; // openai
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private _load(): void {
    const configPath = path.resolve(__dirname, '../../config/framework.properties');

    if (!fs.existsSync(configPath)) {
      console.warn(`[AgentsConfig] framework.properties not found at: ${configPath}`);
      return;
    }

    const lines = fs.readFileSync(configPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      this.config.set(key, value);
    }

    // Also load .env for API keys
    this._loadEnv(path.resolve(__dirname, '../../../features/.env'));
    this._loadEnv(path.resolve(__dirname, '../../../.env'));
  }

  private _loadEnv(envPath: string): void {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      // Only set if not already in process.env (don't override CI/CD injected vars)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  private _get(key: string, defaultValue: string): string {
    return this.config.get(key) ?? defaultValue;
  }

  private _getBool(key: string, defaultValue: boolean): boolean {
    const val = this.config.get(key);
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === 'true';
  }
}
