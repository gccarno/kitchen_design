import type { z } from 'zod';
import type {
  LLMProvider,
  ProviderConfig,
  TextRequest,
  VisionRequest,
} from './provider';

/** Chat-completions message format used by every OpenAI-compatible API. */
type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'user';
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
    };

interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

interface ChatCompletionsResponse {
  choices: Array<{ message: { content: string | null } }>;
}

/**
 * OpenAI-compatible provider. Works against any server that implements the
 * `/v1/chat/completions` endpoint — OpenAI, OpenRouter, Together, Groq,
 * llama.cpp's server, LM Studio, vLLM, etc.
 *
 * - Uses `fetch` directly (no vendor SDK) so we don't drag in transitive deps.
 * - Never logs the API key.
 * - For JSON, requests `response_format: json_object` (a no-op on servers
 *   that don't support it) and additionally strips ```json fences as a
 *   belt-and-suspenders fallback.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly visionModel: string;

  constructor(cfg: ProviderConfig) {
    // Trim trailing slash so concat is predictable.
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.visionModel = cfg.visionModel;
  }

  async completeText(req: TextRequest): Promise<string> {
    const body: ChatCompletionsRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    const content = await this.callChatCompletions(body);
    return content;
  }

  async completeJSON<T>(req: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const body: ChatCompletionsRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_object' },
    };
    const raw = await this.callChatCompletions(body);
    return parseAndValidate(raw, req.schema);
  }

  async chatWithVision<T>(req: VisionRequest<T>): Promise<T> {
    const userContent: Array<
      { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
    > = [
      { type: 'text', text: req.user },
      ...req.images.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mime};base64,${img.dataBase64}` },
      })),
    ];

    const body: ChatCompletionsRequest = {
      model: this.visionModel,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    };
    const raw = await this.callChatCompletions(body);
    return parseAndValidate(raw, req.schema);
  }

  // -- internals --

  private async callChatCompletions(
    body: ChatCompletionsRequest
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable>');
      throw new Error(
        `LLM request failed: ${res.status} ${res.statusText} — ${errText.slice(0, 500)}`
      );
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    const choice = data.choices?.[0];
    if (!choice || choice.message.content == null) {
      throw new Error('LLM response had no choices or empty content');
    }
    return choice.message.content;
  }
}

/** Strip ```json fences and parse; throw with the raw text on failure. */
function parseAndValidate<T>(raw: string, schema: z.ZodType<T>): T {
  const stripped = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON content: ${(err as Error).message}\n--- raw ---\n${raw.slice(0, 1000)}`
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `LLM response failed schema validation: ${result.error.message}\n--- raw ---\n${raw.slice(0, 1000)}`
    );
  }
  return result.data;
}

function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  // Match ```json ... ``` or ``` ... ```
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : trimmed;
}

/**
 * Build a provider from environment variables. Throws if `LLM_API_KEY` is
 * missing. The other vars fall back to safe defaults aimed at OpenAI.
 */
export function providerFromEnv(): LLMProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LLM_API_KEY is not set. Copy .env.example to .env.local and add your key.'
    );
  }
  return new OpenAICompatibleProvider({
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    visionModel: process.env.LLM_VISION_MODEL || 'gpt-4o-mini',
  });
}
