import type { ReasoningTrace } from '@/lib/llm/reasoning';

/** "nvidia/nemotron-3.5-super-vl:free" → "nemotron-3.5-super-vl". */
const shortModel = (m: string) => m.replace(/^.*\//, '').replace(/:free$/, '');

/**
 * The models' working-out behind an answer, folded away under "How the AI
 * worked this out": one section per answer the request got, oldest first.
 * `succeeded`: the last answer was the one used, so any earlier one was
 * rejected and asked again. Nothing when there are no traces.
 */
export default function ReasoningDetail({ traces, succeeded = false }: { traces?: ReasoningTrace[]; succeeded?: boolean }) {
  if (!traces || traces.length === 0) return null;
  return (
    <details className="text-xs text-gray-600">
      <summary className="cursor-pointer">How the AI worked this out</summary>
      <ol className="mt-1 flex flex-col gap-2">
        {traces.map((t, i) => {
          const rejected = t.outcome === 'bad_json' || (succeeded && i < traces.length - 1);
          return (
            <li key={i}>
              {(traces.length > 1 || t.model) && (
                <p className="font-medium">
                  {traces.length > 1 ? `Try ${i + 1}` : ''}
                  {traces.length > 1 && t.model ? ' · ' : ''}
                  {t.model ? shortModel(t.model) : ''}
                  {rejected && <span className="font-normal"> (its answer was rejected, so it was asked again)</span>}
                </p>
              )}
              {/* No scroll box of its own: inside the chat's scrolling conversation, nested scrolling is awkward on a phone. */}
              <p className="rounded bg-gray-50 p-2 break-words whitespace-pre-wrap">{t.text}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
