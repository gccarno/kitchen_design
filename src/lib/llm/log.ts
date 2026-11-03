/**
 * One record per LLM HTTP attempt, written as a single JSON line to stdout
 * (Render and the worker's Docker logs keep it). Never the prompt, the
 * photos or the key: only what is needed to see why a call failed.
 */
export type LLMCallEvent = {
  event: 'llm_call';
  op: 'text' | 'json' | 'vision';
  /** 0 for the first try, then 1, 2… after rate limits. */
  attempt: number;
  /** The model list sent, primary first. */
  models: string[];
  /** The model that actually answered (OpenRouter reports it), when it did. */
  modelUsed?: string;
  /** The upstream provider OpenRouter routed to, when reported. */
  provider?: string;
  images?: number;
  status?: number;
  ms: number;
  outcome: 'ok' | 'rate_limited' | 'http_error' | 'timeout' | 'network_error' | 'bad_envelope' | 'bad_json';
  rateLimitKind?: 'upstream' | 'quota';
  /** The wait before the next attempt, when there is one. */
  retryInMs?: number;
  /** The provider's error message (or our parse error), trimmed. */
  detail?: string;
};

export type LLMCallSink = (e: LLMCallEvent) => void;

export const DETAIL_MAX = 300;

/** The `error.message` in an OpenAI/OpenRouter error body, or the start of the body. */
export function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; metadata?: { raw?: unknown } } };
    const msg = parsed.error?.message;
    const raw = parsed.error?.metadata?.raw;
    if (typeof msg === 'string') return (typeof raw === 'string' ? `${msg} (${raw})` : msg).slice(0, DETAIL_MAX);
  } catch {
    // not JSON
  }
  return body.slice(0, DETAIL_MAX);
}

/** The default sink: a JSON line, `warn` for failures so they stand out. */
export function logLLMCall(e: LLMCallEvent): void {
  const line = JSON.stringify(e);
  if (e.outcome === 'ok') console.info(line);
  else console.warn(line);
}
