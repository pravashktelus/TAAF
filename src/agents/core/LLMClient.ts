import { AgentsConfig } from '../config/AgentsConfig';

/**
 * LLMClient
 * ---------
 * Single AI client for all agents. Supports multiple LLM providers
 * via a simple switch driven by agents.ai.provider in framework.properties.
 *
 * Supported providers:
 *   openai    → OpenAI API (requires OPENAI_API_KEY in .env)
 *   anthropic → Anthropic API (requires ANTHROPIC_API_KEY in .env)
 *   ollama    → Local Ollama instance (no key needed, free)
 *
 * Adding a new provider in future:
 *   1. Add a new case in _callProvider()
 *   2. Add its API key/URL getter in AgentsConfig if needed
 *   That's it — no other files change.
 *
 * Fallback behaviour:
 *   AI unavailable (disabled / missing key / API failure) → returns caller-provided fallback string
 *   This ensures agents always produce useful output even without AI.
 */
export class LLMClient {
  private static config = AgentsConfig.getInstance();

  /**
   * Sends a single user prompt to the configured LLM.
   *
   * @param prompt   - The user prompt
   * @param fallback - Returned as-is when AI is unavailable (template output)
   */
  static async ask(prompt: string, fallback: string = ''): Promise<string> {
    if (!this.config.aiEnabled) {
      console.warn(`[LLMClient] AI unavailable. Provider: ${this.config.aiProvider}. Using fallback output.`);
      return fallback;
    }
    return this._callProvider([{ role: 'user', content: prompt }], fallback);
  }

  /**
   * Sends a system + user prompt to the configured LLM.
   * Use when you need to set an AI persona (e.g. "You are a BDD test expert...").
   *
   * @param systemPrompt - AI persona/role context
   * @param userPrompt   - The actual request
   * @param fallback     - Returned as-is when AI is unavailable
   */
  static async askWithSystem(
    systemPrompt: string,
    userPrompt: string,
    fallback: string = ''
  ): Promise<string> {
    if (!this.config.aiEnabled) {
      console.warn(`[LLMClient] AI unavailable. Provider: ${this.config.aiProvider}. Using fallback output.`);
      return fallback;
    }
    return this._callProvider(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      fallback
    );
  }

  // ─── Private: Provider Switch ─────────────────────────────────────────────

  private static async _callProvider(
    messages: { role: string; content: string }[],
    fallback: string
  ): Promise<string> {
    try {
      switch (this.config.aiProvider) {
        case 'anthropic': return await this._callAnthropic(messages);
        case 'ollama':    return await this._callOllama(messages);
        default:          return await this._callOpenAI(messages);  // openai (default)
      }
    } catch (error) {
      console.error(`[LLMClient] ${this.config.aiProvider} call failed: ${error}`);
      console.warn('[LLMClient] Using fallback output.');
      return fallback;
    }
  }

  // ─── Provider Implementations ─────────────────────────────────────────────

  private static async _callOpenAI(messages: { role: string; content: string }[]): Promise<string> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.openAIApiKey });

    const response = await client.chat.completions.create({
      model: this.config.aiModel,
      max_tokens: 4096,
      messages: messages as any,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  }

  private static async _callAnthropic(messages: { role: string; content: string }[]): Promise<string> {
    // Dynamic import — only loads if anthropic package is installed
    // Install when needed: npm install @anthropic-ai/sdk
    let Anthropic: any;
    try {
      Anthropic = (await import(/* webpackIgnore: true */ '@anthropic-ai/sdk' as any)).default;
    } catch {
      throw new Error('[LLMClient] Anthropic provider requires: npm install @anthropic-ai/sdk');
    }

    const client = new Anthropic({ apiKey: this.config.anthropicApiKey });

    // Anthropic separates system prompt from messages
    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    const response = await client.messages.create({
      model: this.config.aiModel,
      max_tokens: 4096,
      system: systemMsg || undefined,
      messages: userMessages.map((m) => ({ role: 'user', content: m.content })),
    } as any);

    return (response.content[0] as any)?.text?.trim() || '';
  }

  private static async _callOllama(messages: { role: string; content: string }[]): Promise<string> {
    // Ollama runs locally — no SDK needed, plain HTTP call
    const axios = (await import('axios')).default;  // axios already in dependencies

    const response = await axios.post(`${this.config.ollamaBaseUrl}/api/chat`, {
      model: this.config.aiModel,
      messages,
      stream: false,
    });

    return response.data?.message?.content?.trim() || '';
  }
}
