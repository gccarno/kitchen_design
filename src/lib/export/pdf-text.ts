/**
 * Test support: the text a PDF draws, one string per text-showing operator,
 * in order. Reads pdf-lib's output: (usually Flate-compressed) content
 * streams whose `Tj` operators take hex strings in WinAnsi (windows-1252).
 */
import { constants, inflateSync } from 'node:zlib';

export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString('latin1');
  const decoder = new TextDecoder('windows-1252');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1'), { finishFlush: constants.Z_SYNC_FLUSH }).toString('latin1');
    } catch {
      // Not compressed: read it as it is.
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(decoder.decode(Buffer.from(t[1], 'hex')));
  }
  return out;
}
