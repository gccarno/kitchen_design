import { isNative } from './native';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function safeName(name: string): string {
  return name.replace(/[^\w.@-]+/g, '_').replace(/^\.+/, '') || 'download';
}

function dispositionName(header: string | null): string | null {
  const m = header?.match(/filename="?([^";]+)"?/i);
  return m ? m[1] : null;
}

/**
 * Native only: fetches `url` (with the session cookie), writes the real bytes to the cache directory and opens
 * the share sheet. Returns false on the web so the normal link proceeds. Throws a readable error if the server
 * answered with anything but the file (error status or an HTML page, e.g. a login redirect).
 */
export async function saveAndShare(url: string, filename: string): Promise<boolean> {
  if (!isNative()) return false;
  const res = await fetch(url, { credentials: 'include' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  if (!/^(?:application\/pdf|text\/csv|image\/png|image\/svg\+xml)(?:;|$)/i.test(type)) throw new Error('Download failed: the server did not return a file. Try signing in again.');
  const name = safeName(dispositionName(res.headers.get('content-disposition')) ?? filename);
  const data = toBase64(await res.arrayBuffer());
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
  try {
    await Share.share({ title: name, url: uri });
  } catch (err) {
    // Closing the sheet rejects ("Share canceled"), and so does a second tap while one is open. Neither is a failure.
    if (!/cancel|in progress/i.test(err instanceof Error ? err.message : String(err))) throw err;
  }
  return true;
}
