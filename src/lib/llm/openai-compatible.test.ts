import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider, LLMResponseError, LLMRequestError, LLMRateLimitError, providerFromEnv } from './openai-compatible';
import { ModelCooldown } from './cooldown';
import type { LLMProvider, ProviderConfig } from './provider';

// Capture every fetch call and let each test decide the response.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The default call log writes to the console; keep test output quiet.
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Bad Request',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const cfg: ProviderConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  visionModel: 'gpt-vision-test',
};

describe('OpenAICompatibleProvider', () => {
  describe('completeText', () => {
    it('POSTs to {baseUrl}/chat/completions with bearer auth', async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({ choices: [{ message: { content: 'hello' } }] })
      );
      const p = new OpenAICompatibleProvider(cfg);
      const out = await p.completeText({ system: 's', user: 'u' });
      expect(out).toBe('hello');
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/v1/chat/completions');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('uses the configured text model', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'x' } }] }));
      const p = new OpenAICompatibleProvider(cfg);
      await p.completeText({ system: 's', user: 'u' });
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.model).toBe('gpt-test');
    });

    it('passes temperature and maxTokens through', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'x' } }] }));
      const p = new OpenAICompatibleProvider(cfg);
      await p.completeText({ system: 's', user: 'u', temperature: 0.3, maxTokens: 256 });
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(256);
    });

    it('throws on non-OK response with the body text', async () => {
      fetchMock.mockResolvedValueOnce(errJson(401, { error: 'bad key' }));
      const p = new OpenAICompatibleProvider(cfg);
      await expect(p.completeText({ system: 's', user: 'u' })).rejects.toThrow(/401/);
    });

    it('throws on empty choices', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ choices: [] }));
      const p = new OpenAICompatibleProvider(cfg);
      await expect(p.completeText({ system: 's', user: 'u' })).rejects.toThrow(/no choices/);
    });
  });

  describe('completeJSON', () => {
    const schema = z.object({ foo: z.string() });

    it('parses the content as JSON and validates against the schema', async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({ choices: [{ message: { content: '{"foo":"bar"}' } }] })
      );
      const p = new OpenAICompatibleProvider(cfg);
      const out = await p.completeJSON({ system: 's', user: 'u', schema });
      expect(out).toEqual({ foo: 'bar' });
    });

    it('strips ```json fences around the response', async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({ choices: [{ message: { content: '```json\n{"foo":"bar"}\n```' } }] })
      );
      const p = new OpenAICompatibleProvider(cfg);
      const out = await p.completeJSON({ system: 's', user: 'u', schema });
      expect(out).toEqual({ foo: 'bar' });
    });

    it('throws with the parse error when content is not valid JSON', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'nope' } }] }));
      const p = new OpenAICompatibleProvider(cfg);
      await expect(p.completeJSON({ system: 's', user: 'u', schema })).rejects.toThrow();
    });

    it('throws with Zod issues when JSON does not match the schema', async () => {
      fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"foo":42}' } }] }));
      const p = new OpenAICompatibleProvider(cfg);
      await expect(p.completeJSON({ system: 's', user: 'u', schema })).rejects.toThrow();
    });
  });

  describe('chatWithVision', () => {
    it('uses the vision model and sends base64 image_url parts', async () => {
      fetchMock.mockResolvedValueOnce(
        okJson({ choices: [{ message: { content: '{"foo":"ok"}' } }] })
      );
      const p = new OpenAICompatibleProvider(cfg);
      const schema = z.object({ foo: z.string() });
      await p.chatWithVision({
        system: 'look',
        user: 'describe',
        images: [{ mime: 'image/jpeg', dataBase64: 'AAAA' }],
        schema,
      });
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.model).toBe('gpt-vision-test');
      const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
      const content = userMsg.content as Array<{ type: string; image_url?: { url: string } }>;
      const imagePart = content.find((c) => c.type === 'image_url');
      expect(imagePart?.image_url?.url).toBe('data:image/jpeg;base64,AAAA');
    });
  });
});

describe('failure modes', () => {
  const schema = z.object({ a: z.number() });

  it('raises LLMResponseError (retryable) for non-JSON content, with the raw text', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'sorry, no' } }] }));
    const err = await new OpenAICompatibleProvider(cfg)
      .completeJSON({ system: 's', user: 'u', schema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMResponseError);
    expect((err as LLMResponseError).raw).toBe('sorry, no');
  });

  it('raises LLMResponseError for a schema mismatch', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":"x"}' } }] }));
    const err = await new OpenAICompatibleProvider(cfg)
      .completeJSON({ system: 's', user: 'u', schema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMResponseError);
    expect((err as Error).message).toMatch(/schema/);
  });

  it('raises LLMRequestError (not retryable) for an HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce(errJson(500, { error: 'down' }));
    const err = await new OpenAICompatibleProvider(cfg)
      .completeJSON({ system: 's', user: 'u', schema })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err).not.toBeInstanceOf(LLMResponseError);
  });

  it('raises LLMRequestError for a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(new OpenAICompatibleProvider(cfg).completeText({ system: 's', user: 'u' })).rejects.toBeInstanceOf(
      LLMRequestError
    );
  });

  it('passes an abort signal so requests time out', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'x' } }] }));
    await new OpenAICompatibleProvider({ ...cfg, timeoutMs: 1234 }).completeText({ system: 's', user: 'u' });
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a timeout clearly', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );
    await expect(
      new OpenAICompatibleProvider({ ...cfg, timeoutMs: 20 }).completeText({ system: 's', user: 'u' })
    ).rejects.toThrow(LLMRequestError);
    await expect(
      new OpenAICompatibleProvider({ ...cfg, timeoutMs: 20 }).completeText({ system: 's', user: 'u' })
    ).rejects.toThrow(/timed out after 20 ms/);
  });
});

describe('timeouts while the body is still arriving', () => {
  // OpenRouter sends headers right away and holds the body until the model answers,
  // so the timeout can fire while reading the body, not just during fetch().
  const slowBody = () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      text: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    }) as unknown as Response;

  it('reports it as a timed-out LLMRequestError, not an unhandled error', async () => {
    fetchMock.mockResolvedValueOnce(slowBody());
    const err = await new OpenAICompatibleProvider({ ...cfg, timeoutMs: 1234 })
      .completeText({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect((err as Error).message).toMatch(/timed out after 1234 ms/);
  });

  it('reports an unreadable (non-JSON) envelope as an LLMRequestError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => '<html>gateway error</html>',
      json: async () => JSON.parse('<html>'),
    } as unknown as Response);
    await expect(new OpenAICompatibleProvider(cfg).completeText({ system: 's', user: 'u' })).rejects.toBeInstanceOf(
      LLMRequestError
    );
  });
});

describe('model fallbacks (OpenRouter)', () => {
  const ok = () => okJson({ choices: [{ message: { content: '{"a":1}' } }] });
  const body = (i = 0) => JSON.parse((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as string);

  it('sends the whole list in `models`, primary first (OpenRouter tries it in order)', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    const p = new OpenAICompatibleProvider({
      ...cfg,
      fallbackModels: ['b/text', 'c/text'],
      visionFallbackModels: ['b/vision'],
      cooldown: new ModelCooldown(60_000),
    });
    await p.completeText({ system: 's', user: 'u' });
    expect(body()).toMatchObject({ model: 'gpt-test', models: ['gpt-test', 'b/text', 'c/text'] });
    fetchMock.mockResolvedValueOnce(ok());
    await p.chatWithVision({ system: 's', user: 'u', images: [], schema: z.object({ a: z.number() }) });
    expect(body(1)).toMatchObject({ model: 'gpt-vision-test', models: ['gpt-vision-test', 'b/vision'] });
  });

  it('omits `models` when there are no fallbacks (plain OpenAI rejects unknown fields)', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await new OpenAICompatibleProvider(cfg).completeText({ system: 's', user: 'u' });
    expect(body()).not.toHaveProperty('models');
  });
});

describe('rate limits (429)', () => {
  const upstream = '{"error":{"code":429,"message":"a/text is temporarily rate-limited upstream"}}';
  const tooMany = (headers: Record<string, string> = {}, text = upstream) =>
    ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers(headers),
      json: async () => JSON.parse(text),
      text: async () => text,
    }) as unknown as Response;
  const ok = () => okJson({ choices: [{ message: { content: 'x' } }] });
  const sentModels = () =>
    fetchMock.mock.calls.map((c) => JSON.parse((c as [string, RequestInit])[1].body as string).model as string);
  const provider = (extra: Partial<ProviderConfig> = {}) =>
    new OpenAICompatibleProvider({ ...cfg, retryDelayMs: 1, cooldown: new ModelCooldown(60_000), ...extra });

  it('retries an upstream 429 with growing waits, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(ok());
      const done = provider({ retryDelayMs: 1000 }).completeText({ system: 's', user: 'u' });
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2999); // the second wait is 3× the first
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await done).toBe('x');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours Retry-After (seconds)', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(tooMany({ 'retry-after': '7' })).mockResolvedValueOnce(ok());
      const done = provider().completeText({ system: 's', user: 'u' });
      await vi.advanceTimersByTimeAsync(6999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await done).toBe('x');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves a model that was rate-limited upstream to the back of the list, for this and later requests', async () => {
    const cooldown = new ModelCooldown(60_000);
    const p = provider({ model: 'a/text', fallbackModels: ['b/text', 'c/text'], cooldown });
    fetchMock.mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await p.completeText({ system: 's', user: 'u' });
    await p.completeText({ system: 's', user: 'u' });
    expect(sentModels()).toEqual(['a/text', 'b/text', 'b/text']);
    const lastBody = JSON.parse((fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string);
    expect(lastBody.models).toEqual(['b/text', 'c/text', 'a/text']);
  });

  it('gives up after maxRetries with a typed upstream error and a minute to wait', async () => {
    fetchMock.mockResolvedValue(tooMany());
    const err = await provider({ maxRetries: 2 })
      .completeText({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMRateLimitError);
    expect(err).toBeInstanceOf(LLMRequestError);
    expect(err).toMatchObject({ kind: 'upstream', retryAfterMs: 60_000 });
    expect((err as Error).message).toMatch(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops early when the next wait would exceed the total budget', async () => {
    fetchMock.mockResolvedValue(tooMany());
    // Waits would be 10, 30, 90 ms; a 30 ms budget allows only the first (10 + 30 > 30).
    await expect(
      provider({ retryDelayMs: 10, maxRateLimitWaitMs: 30 }).completeText({ system: 's', user: 'u' })
    ).rejects.toBeInstanceOf(LLMRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry the account quota when the reset is far off, and says when it resets', async () => {
    const resetAt = Date.now() + 3 * 60 * 60 * 1000;
    fetchMock.mockResolvedValue(
      tooMany(
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) },
        '{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day"}}'
      )
    );
    const err = (await provider()
      .completeText({ system: 's', user: 'u' })
      .catch((e: unknown) => e)) as LLMRateLimitError;
    expect(err).toBeInstanceOf(LLMRateLimitError);
    expect(err.kind).toBe('quota');
    expect(err.retryAfterMs).toBeGreaterThan(3 * 60 * 60 * 1000 - 5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for a quota reset that is due within the budget (the per-minute limit)', async () => {
    fetchMock
      .mockResolvedValueOnce(tooMany({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.now() + 20) }))
      .mockResolvedValueOnce(ok());
    expect(await provider().completeText({ system: 's', user: 'u' })).toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(provider().completeText({ system: 's', user: 'u' })).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('call log (one event per attempt)', () => {
  const schema = z.object({ a: z.number() });
  const setup = (extra: Partial<ProviderConfig> = {}) => {
    const log = vi.fn();
    const onCall = vi.fn();
    const p = new OpenAICompatibleProvider({
      ...cfg,
      fallbackModels: ['b/text'],
      retryDelayMs: 1,
      cooldown: new ModelCooldown(60_000),
      log,
      onCall,
      ...extra,
    });
    return { p, log, onCall };
  };
  const tooMany = (body: string) =>
    ({ ok: false, status: 429, statusText: 'Too Many Requests', headers: new Headers(), text: async () => body }) as unknown as Response;

  it('logs a success with the model and provider that answered, and tells onCall too', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ model: 'b/text', provider: 'Chutes', choices: [{ message: { content: '{"a":1}' } }] }));
    const { p, log, onCall } = setup();
    await p.completeJSON({ system: 's', user: 'u', schema });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({
      event: 'llm_call',
      op: 'json',
      attempt: 0,
      models: ['gpt-test', 'b/text'],
      modelUsed: 'b/text',
      provider: 'Chutes',
      status: 200,
      outcome: 'ok',
    });
    expect(typeof log.mock.calls[0][0].ms).toBe('number');
    expect(onCall.mock.calls[0][0]).toEqual(log.mock.calls[0][0]);
  });

  it('logs each rate-limited attempt with the provider message and the wait, then the success', async () => {
    const body = JSON.stringify({ error: { code: 429, message: 'Provider returned error', metadata: { raw: 'gpt-test is temporarily rate-limited upstream' } } });
    fetchMock.mockResolvedValueOnce(tooMany(body)).mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'x' } }] }));
    const { p, log } = setup();
    await p.completeText({ system: 's', user: 'u' });
    expect(log.mock.calls.map((c) => c[0].outcome)).toEqual(['rate_limited', 'ok']);
    expect(log.mock.calls[0][0]).toMatchObject({
      status: 429,
      rateLimitKind: 'upstream',
      retryInMs: 1,
      detail: 'Provider returned error (gpt-test is temporarily rate-limited upstream)',
    });
    expect(log.mock.calls[1][0]).toMatchObject({ attempt: 1, models: ['b/text', 'gpt-test'] });
  });

  it('logs the last rate-limited attempt without a wait', async () => {
    fetchMock.mockResolvedValue(tooMany('busy'));
    const { p, log } = setup({ maxRetries: 1 });
    await p.completeText({ system: 's', user: 'u' }).catch(() => undefined);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).not.toHaveProperty('retryInMs');
    expect(log.mock.calls[1][0].detail).toBe('busy');
  });

  it('logs HTTP errors, unreadable envelopes, bad JSON and timeouts with what went wrong', async () => {
    const { p, log } = setup();
    fetchMock.mockResolvedValueOnce(errJson(400, { error: { message: 'image too large' } }));
    await p.completeText({ system: 's', user: 'u' }).catch(() => undefined);
    fetchMock.mockResolvedValueOnce(okJson({ choices: [] }));
    await p.completeText({ system: 's', user: 'u' }).catch(() => undefined);
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'nope' } }] }));
    await p.chatWithVision({ system: 's', user: 'u', images: [{ mime: 'image/jpeg', dataBase64: 'AA' }], schema }).catch(() => undefined);
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'));
    await p.completeText({ system: 's', user: 'u' }).catch(() => undefined);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await p.completeText({ system: 's', user: 'u' }).catch(() => undefined);

    const events = log.mock.calls.map((c) => c[0]);
    expect(events.map((e) => e.outcome)).toEqual(['http_error', 'bad_envelope', 'bad_json', 'timeout', 'network_error']);
    expect(events[0]).toMatchObject({ status: 400, detail: 'image too large' });
    expect(events[1].detail).toMatch(/no choices/);
    expect(events[2]).toMatchObject({ op: 'vision', images: 1, status: 200 });
    expect(events[2].detail).toMatch(/non-JSON/);
    expect(events[3].detail).toMatch(/timed out/);
    expect(events[4].detail).toMatch(/fetch failed/);
  });

  it('never logs the prompt, the photos or the key', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":1}' } }] }));
    const { p, log } = setup();
    await p.chatWithVision({ system: 'SECRET-SYSTEM', user: 'SECRET-USER', images: [{ mime: 'image/jpeg', dataBase64: 'SECRETPIXELS' }], schema });
    const line = JSON.stringify(log.mock.calls);
    for (const s of ['SECRET-SYSTEM', 'SECRET-USER', 'SECRETPIXELS', 'sk-test']) expect(line).not.toContain(s);
  });
});

describe('ModelCooldown', () => {
  it('moves cooling models to the back until the cooldown ends, never dropping them', () => {
    let now = 0;
    const c = new ModelCooldown(1000, () => now);
    c.mark('a');
    expect(c.order(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
    c.mark('b');
    expect(c.order(['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    now = 1000;
    expect(c.order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('providerFromEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads LLM_TIMEOUT_MS', async () => {
    process.env.LLM_API_KEY = 'sk-x';
    process.env.LLM_TIMEOUT_MS = '777';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => {
        throw new DOMException('aborted', 'TimeoutError');
      },
    } as unknown as Response);
    await expect(providerFromEnv().completeText({ system: 's', user: 'u' })).rejects.toThrow(/timed out after 777 ms/);
  });

  it('reads comma-separated model lists: the first is primary, the rest are fallbacks', async () => {
    process.env.LLM_API_KEY = 'sk-x';
    process.env.LLM_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.LLM_MODEL = 'a/text';
    process.env.LLM_VISION_MODEL = ' a/vision , b/vision,c/vision ';
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":1}' } }] }));
    await providerFromEnv().chatWithVision({ system: 's', user: 'u', images: [], schema: z.object({ a: z.number() }) });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'a/vision', models: ['a/vision', 'b/vision', 'c/vision'] });
  });
});

describe('LLMProvider interface', () => {
  it('OpenAICompatibleProvider satisfies the LLMProvider shape', () => {
    const p: LLMProvider = new OpenAICompatibleProvider(cfg);
    expect(typeof p.completeText).toBe('function');
    expect(typeof p.completeJSON).toBe('function');
    expect(typeof p.chatWithVision).toBe('function');
  });
});
