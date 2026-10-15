/**
 * The post-login redirect target from `?next=`. Only same-origin paths are
 * honoured: a single leading `/`, no `//` or `/\` (protocol-relative), no
 * backslashes or control characters. Anything else becomes `/`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw === '') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (ch === '\\' || c < 0x20 || c === 0x7f) return '/';
  }
  return raw;
}
