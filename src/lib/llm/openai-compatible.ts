import type {
  LLMProvider,
  OutputSchema,
  ProviderConfig,
  TextRequest,
  VisionRequest,
} from './provider';
import { ModelCooldown } from './cooldown';
import { DETAIL_MAX, errorDetail, logLLMCall, type LLMCallEvent, type LLMCallSink } from './log';

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
  /** OpenRouter: the whole list in priority order, `model` first, then its fallbacks. */
  models?: string[];
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

interface ChatCompletionsResponse {
  choices: Array<{ message: { content: string | null } }>;
  /** The model that answered (OpenRouter: may be a fallback). */
  model?: unknown;
  /** OpenRouter: the upstream provider it routed to. */
  provider?: unknown;
}

/** A request body before the model route is added. */
type ChatBody = Omit<ChatCompletionsRequest, 'model' | 'models'>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_RETRIES = 3;
/** Jobs are requeued after 5 minutes and one job may make several calls, so keep each call's waiting short. */
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 60_000;
/** How long the user should wait before trying again after the upstream stayed busy. */
const UPSTREAM_TRY_AGAIN_MS = 60_000;

/** Shared by every provider in the process, so one request's 429 steers the next request. */
const sharedCooldown = new ModelCooldown(2 * 60 * 1000);

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

/**
 * Still rate-limited (HTTP 429) after waiting. `upstream`: the model's
 * provider was busy, which usually clears in a minute or so. `quota`: the
 * account's own limit (OpenRouter's free-model cap), which lasts until `resetAt`.
 */
export class LLMRateLimitError extends LLMRequestError {
  constructor(
    message: string,
    readonly kind: 'upstream' | 'quota',
    /** How long until trying again is worth it, when known. */
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'LLMRateLimitError';
  }
}

type PostResult = {
  ok: boolean;
  status: number;
  statusText: string;
  /** Lower-case header name → value, or null. */
  header: (name: string) => string | null;
  text: string;
};

/**
 * OpenRouter answers its own limits with `X-RateLimit-Remaining: 0` and a
 * `X-RateLimit-Reset` time (epoch ms); a busy upstream provider has neither.
 */
function classifyRateLimit(res: PostResult, now: number): { kind: 'upstream' | 'quota'; resetInMs?: number } {
  const ownLimit = res.header('x-ratelimit-remaining') === '0' || /free-models-per-(day|min)/i.test(res.text);
  if (!ownLimit) return { kind: 'upstream' };
  const reset = Number(res.header('x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return { kind: 'quota' };
  const resetAt = reset < 1e12 ? reset * 1000 : reset; // tolerate seconds
  return { kind: 'quota', resetInMs: Math.max(0, resetAt - now) };
}

/** `Retry-After` in seconds, as ms; null when absent or unreadable (HTTP-date form is ignored). */
function retryAfterMs(res: PostResult): number | null {
  const s = Number(res.header('retry-after') ?? NaN);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : null;
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
  private readonly maxRetries: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly cooldown: ModelCooldown;
  private readonly log: LLMCallSink;
  private readonly onCall?: LLMCallSink;

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
    this.maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRateLimitWaitMs = cfg.maxRateLimitWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS;
    this.cooldown = cfg.cooldown ?? sharedCooldown;
    this.log = cfg.log ?? logLLMCall;
    this.onCall = cfg.onCall;
  }

  /** The configured models, primary first, with recently rate-limited ones moved to the back. */
  private models(vision: boolean): string[] {
    const configured = vision ? [this.visionModel, ...this.visionFallbackModels] : [this.model, ...this.fallbackModels];
    return this.cooldown.order(configured);
  }

  /** `model`, plus the full `models` list only when there are fallbacks (plain OpenAI rejects unknown fields). */
  private static route(models: string[]): Pick<ChatCompletionsRequest, 'model' | 'models'> {
    return { model: models[0], ...(models.length > 1 ? { models } : {}) };
  }

  async completeText(req: TextRequest): Promise<string> {
    const body: ChatBody = {
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    return this.callChatCompletions(body, 'text', (raw) => raw);
  }

  async completeJSON<T>(req: {
    system: string;
    user: string;
    schema: OutputSchema<T>;
  }): Promise<T> {
    const body: ChatBody = {
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_object' },
    };
    return this.callChatCompletions(body, 'json', (raw) => parseAndValidate(raw, req.schema));
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

    const body: ChatBody = {
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    };
    return this.callChatCompletions(body, 'vision', (raw) => parseAndValidate(raw, req.schema), req.images.length);
  }

  // -- internals --

  private emit(e: LLMCallEvent): void {
    this.log(e);
    this.onCall?.(e);
  }

  /**
   * Free models are often rate-limited (429). A busy upstream provider: move
   * that model to the back of the list and retry with growing waits (5 s,
   * 15 s, 45 s by default) within a total budget. The account's own quota:
   * wait for the reset only if it's soon, otherwise give up straight away.
   * Every attempt is logged (see log.ts), including answers `parse` rejects.
   */
  private async callChatCompletions<T>(
    body: ChatBody,
    op: LLMCallEvent['op'],
    parse: (raw: string) => T,
    images?: number
  ): Promise<T> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const models = this.models(op === 'vision');
      const started = Date.now();
      const base = { event: 'llm_call' as const, op, attempt, models, ...(images !== undefined ? { images } : {}) };
      const ms = () => Date.now() - started;

      let res: PostResult;
      try {
        res = await this.post({ ...OpenAICompatibleProvider.route(models), ...body });
      } catch (err) {
        const timedOut = /timed out/.test((err as Error).message);
        this.emit({ ...base, ms: ms(), outcome: timedOut ? 'timeout' : 'network_error', detail: (err as Error).message.slice(0, DETAIL_MAX) });
        throw err;
      }

      if (res.status !== 429) {
        let answer: Answer;
        try {
          answer = readContent(res);
        } catch (err) {
          this.emit({
            ...base,
            status: res.status,
            ms: ms(),
            outcome: res.ok ? 'bad_envelope' : 'http_error',
            detail: res.ok ? (err as Error).message.slice(0, DETAIL_MAX) : errorDetail(res.text),
          });
          throw err;
        }
        const used = { ...(answer.model ? { modelUsed: answer.model } : {}), ...(answer.provider ? { provider: answer.provider } : {}) };
        try {
          const parsed = parse(answer.content);
          this.emit({ ...base, ...used, status: res.status, ms: ms(), outcome: 'ok' });
          return parsed;
        } catch (err) {
          this.emit({ ...base, ...used, status: res.status, ms: ms(), outcome: 'bad_json', detail: (err as Error).message.slice(0, DETAIL_MAX) });
          throw err;
        }
      }

      const limit = classifyRateLimit(res, Date.now());
      if (limit.kind === 'upstream') this.cooldown.mark(models[0]);
      const wait =
        limit.kind === 'quota' ? (limit.resetInMs ?? Infinity) : (retryAfterMs(res) ?? this.retryDelayMs * 3 ** attempt);
      const giveUp = attempt >= this.maxRetries || waited + wait > this.maxRateLimitWaitMs;
      this.emit({
        ...base,
        status: 429,
        ms: ms(),
        outcome: 'rate_limited',
        rateLimitKind: limit.kind,
        ...(giveUp ? {} : { retryInMs: wait }),
        detail: errorDetail(res.text),
      });
      if (giveUp) {
        throw new LLMRateLimitError(
          `LLM request failed: 429 ${res.statusText} — ${res.text.slice(0, 500)}`,
          limit.kind,
          limit.kind === 'quota' ? limit.resetInMs : UPSTREAM_TRY_AGAIN_MS
        );
      }
      await new Promise((r) => setTimeout(r, wait));
      waited += wait;
    }
  }

  /**
   * POST and read the whole body under one timeout. OpenRouter sends headers
   * straight away and holds the body until the model answers, so the timeout
   * often fires while reading the body — both must map to LLMRequestError.
   */
  private async post(body: ChatCompletionsRequest): Promise<PostResult> {
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
        header: (name) => res.headers?.get?.(name) ?? null,
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

type Answer = { content: string; model?: string; provider?: string };

/** The first choice's text (and who answered) from a chat-completions response; LLMRequestError for anything else. */
function readContent(res: PostResult): Answer {
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
  return {
    content: choice.message.content,
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
  };
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
export function providerFromEnv(extra: Pick<ProviderConfig, 'onCall'> = {}): LLMProvider {
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
    ...extra,
  });
}
