import type {
  LLMProvider,
  OutputSchema,
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
  /** OpenRouter fallbacks, tried in order after `model`. */
  models?: string[];
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

interface ChatCompletionsResponse {
  choices: Array<{ message: { content: string | null } }>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
/** Never wait longer than this for a Retry-After, whatever the server says. */
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * The model answered, but not with valid JSON matching the schema. Worth
 * retrying with the problem fed back — unlike transport or HTTP errors,
 * which surface as `LLMRequestError`.
 */
export class LLMResponseError extends Error {
  constructor(
    message: string,
    /** The model's raw reply, for feeding back on retry. */
    readonly raw: string
  ) {
    super(message);
    this.name = 'LLMResponseError';
  }
}

/** The request itself failed: network error, timeout, or non-2xx status. Not retried. */
export class LLMRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMRequestError';
  }
}

/** No LLM is configured (`LLM_API_KEY` unset). The rest of the app still works. */
export class LLMNotConfiguredError extends Error {
  constructor() {
    super('LLM_API_KEY is not set. Copy .env.example to .env.local and add your key.');
    this.name = 'LLMNotConfiguredError';
  }
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
  private readonly timeoutMs: number;
  private readonly fallbackModels: string[];
  private readonly visionFallbackModels: string[];
  private readonly retryDelayMs: number;

  constructor(cfg: ProviderConfig) {
    // Trim trailing slash so concat is predictable.
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.visionModel = cfg.visionModel;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fallbackModels = cfg.fallbackModels ?? [];
    this.visionFallbackModels = cfg.visionFallbackModels ?? [];
    this.retryDelayMs = cfg.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /** `model`, plus `models` fallbacks only when configured. */
  private route(vision: boolean): Pick<ChatCompletionsRequest, 'model' | 'models'> {
    const fallbacks = vision ? this.visionFallbackModels : this.fallbackModels;
    return { model: vision ? this.visionModel : this.model, ...(fallbacks.length > 0 ? { models: fallbacks } : {}) };
  }

  async completeText(req: TextRequest): Promise<string> {
    const body: ChatCompletionsRequest = {
      ...this.route(false),
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
    schema: OutputSchema<T>;
  }): Promise<T> {
    const body: ChatCompletionsRequest = {
      ...this.route(false),
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
      ...this.route(true),
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

  private async callChatCompletions(body: ChatCompletionsRequest): Promise<string> {
    let res = await this.post(body);
    if (res.status === 429) {
      // Rate limited (common on free models): wait once, then try again.
      const retryAfterS = Number(res.retryAfter ?? NaN);
      const wait = Number.isFinite(retryAfterS) && retryAfterS >= 0 ? retryAfterS * 1000 : this.retryDelayMs;
      await new Promise((r) => setTimeout(r, Math.min(wait, MAX_RETRY_DELAY_MS)));
      res = await this.post(body);
    }

    if (!res.ok) {
      throw new LLMRequestError(`LLM request failed: ${res.status} ${res.statusText} — ${res.text.slice(0, 500)}`);
    }

    let data: ChatCompletionsResponse;
    try {
      data = JSON.parse(res.text) as ChatCompletionsResponse;
    } catch {
      throw new LLMRequestError(`LLM response was not JSON: ${res.text.slice(0, 200)}`);
    }
    const choice = data.choices?.[0];
    if (!choice || choice.message.content == null) {
      throw new LLMRequestError('LLM response had no choices or empty content');
    }
    return choice.message.content;
  }

  /**
   * POST and read the whole body under one timeout. OpenRouter sends headers
   * straight away and holds the body until the model answers, so the timeout
   * often fires while reading the body — both must map to LLMRequestError.
   */
  private async post(
    body: ChatCompletionsRequest
  ): Promise<{ ok: boolean; status: number; statusText: string; retryAfter: string | null; text: string }> {
    const url = `${this.baseUrl}/chat/completions`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        retryAfter: res.headers?.get?.('retry-after') ?? null,
        text,
      };
    } catch (err) {
      if ((err as Error)?.name === 'TimeoutError') {
        throw new LLMRequestError(`LLM request timed out after ${this.timeoutMs} ms`);
      }
      throw new LLMRequestError(`LLM request failed: ${(err as Error).message}`);
    }
  }
}

/** Strip ```json fences and parse; throw with the raw text on failure. */
function parseAndValidate<T>(raw: string, schema: OutputSchema<T>): T {
  const stripped = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new LLMResponseError(`LLM returned non-JSON content: ${(err as Error).message}`, raw);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new LLMResponseError(`LLM response failed schema validation: ${issues}`, raw);
  }
  return result.data;
}

function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  // Match ```json ... ``` or ``` ... ```
  const m = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : trimmed;
}

/** "a, b ,c" → ["a", "b", "c"]. */
const modelList = (v: string | undefined) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean);

/**
 * Build a provider from environment variables. Throws if `LLM_API_KEY` is
 * missing. The other vars fall back to safe defaults aimed at OpenAI.
 * `LLM_MODEL` / `LLM_VISION_MODEL` may be comma-separated lists (OpenRouter):
 * the first is the model, the rest are fallbacks.
 */
export function providerFromEnv(): LLMProvider {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new LLMNotConfiguredError();
  const [model = 'gpt-4o-mini', ...fallbackModels] = modelList(process.env.LLM_MODEL);
  const [visionModel = 'gpt-4o-mini', ...visionFallbackModels] = modelList(process.env.LLM_VISION_MODEL);
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || undefined;
  return new OpenAICompatibleProvider({
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model,
    visionModel,
    timeoutMs,
    fallbackModels,
    visionFallbackModels,
  });
}
