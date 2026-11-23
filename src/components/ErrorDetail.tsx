/**
 * What the AI providers actually said when a request failed, folded away
 * under "Details" below the plain message. Nothing when there is none.
 */
export default function ErrorDetail({ detail }: { detail?: string }) {
  if (!detail) return null;
  return (
    <details className="text-xs text-gray-600">
      <summary className="cursor-pointer">Details</summary>
      <p className="mt-1 break-words whitespace-pre-wrap">{detail}</p>
    </details>
  );
}
