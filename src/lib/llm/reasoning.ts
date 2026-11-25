/**
 * A reasoning model's working-out before its answer (OpenRouter returns it
 * as `message.reasoning`, or as `reasoning_details` blocks). It is kept with
 * the job's result for the user to read, and never logged or sent to Sentry:
 * it describes the user's photos and repeats what they typed.
 */
export type ReasoningTrace = {
  /** The model that answered, when reported. */
  model?: string;
  /** `bad_json`: the answer that followed was not valid JSON for the schema. */
  outcome: 'ok' | 'bad_json';
  text: string;
};

export type ReasoningSink = (t: ReasoningTrace) => void;

/** The most of one trace kept: reading four photos, nemotron wrote over 20,000 characters. */
export const REASONING_MAX = 100_000;

const clip = (s: string) => (s.length <= REASONING_MAX ? s : `${s.slice(0, REASONING_MAX)}\n… (cut short)`);

/** The reasoning text in a chat-completions message, or undefined when there is none. */
export function readReasoning(message: { reasoning?: unknown; reasoning_details?: unknown }): string | undefined {
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) return clip(message.reasoning.trim());
  if (!Array.isArray(message.reasoning_details)) return undefined;
  const parts = message.reasoning_details
    .map((d: unknown) => {
      if (typeof d !== 'object' || d === null) return '';
      const { text, summary } = d as { text?: unknown; summary?: unknown };
      return typeof text === 'string' ? text : typeof summary === 'string' ? summary : '';
    })
    .filter((s) => s.trim() !== '');
  return parts.length > 0 ? clip(parts.join('\n\n').trim()) : undefined;
}

/** The traces in a job's result or error as the client received them; anything malformed is dropped. */
export function parseTraces(value: unknown): ReasoningTrace[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const traces = value.flatMap((v: unknown): ReasoningTrace[] => {
    if (typeof v !== 'object' || v === null) return [];
    const { model, outcome, text } = v as Record<string, unknown>;
    if (typeof text !== 'string' || text.trim() === '') return [];
    return [{ ...(typeof model === 'string' ? { model } : {}), outcome: outcome === 'bad_json' ? 'bad_json' : 'ok', text }];
  });
  return traces.length > 0 ? traces : undefined;
}
