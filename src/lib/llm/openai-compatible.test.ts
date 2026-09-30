import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider, LLMResponseError, LLMRequestError, providerFromEnv } from './openai-compatible';
import type { LLMProvider, ProviderConfig } from './provider';

// Capture every fetch call and let each test decide the response.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
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

  it('sends fallback models in `models` after the primary', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    const p = new OpenAICompatibleProvider({ ...cfg, fallbackModels: ['b/text', 'c/text'], visionFallbackModels: ['b/vision'] });
    await p.completeText({ system: 's', user: 'u' });
    expect(body()).toMatchObject({ model: 'gpt-test', models: ['b/text', 'c/text'] });
    fetchMock.mockResolvedValueOnce(ok());
    await p.chatWithVision({ system: 's', user: 'u', images: [], schema: z.object({ a: z.number() }) });
    expect(body(1)).toMatchObject({ model: 'gpt-vision-test', models: ['b/vision'] });
  });

  it('omits `models` when there are no fallbacks (plain OpenAI rejects unknown fields)', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await new OpenAICompatibleProvider(cfg).completeText({ system: 's', user: 'u' });
    expect(body()).not.toHaveProperty('models');
  });
});

describe('rate limits (429)', () => {
  const tooMany = (retryAfter?: string) =>
    ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}),
      json: async () => ({}),
      text: async () => 'rate limited',
    }) as unknown as Response;

  it('retries once after a 429, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(tooMany('0')).mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'x' } }] }));
    const out = await new OpenAICompatibleProvider({ ...cfg, retryDelayMs: 1 }).completeText({ system: 's', user: 'u' });
    expect(out).toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry with a clear error', async () => {
    fetchMock.mockResolvedValue(tooMany());
    await expect(
      new OpenAICompatibleProvider({ ...cfg, retryDelayMs: 1 }).completeText({ system: 's', user: 'u' })
    ).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    await expect(new OpenAICompatibleProvider({ ...cfg, retryDelayMs: 1 }).completeText({ system: 's', user: 'u' })).rejects.toThrow(
      /500/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'a/vision', models: ['b/vision', 'c/vision'] });
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
