import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider, LLMResponseError, LLMRequestError } from './openai-compatible';
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

describe('LLMProvider interface', () => {
  it('OpenAICompatibleProvider satisfies the LLMProvider shape', () => {
    const p: LLMProvider = new OpenAICompatibleProvider(cfg);
    expect(typeof p.completeText).toBe('function');
    expect(typeof p.completeJSON).toBe('function');
    expect(typeof p.chatWithVision).toBe('function');
  });
});
