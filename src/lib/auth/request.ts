/** `Authorization: Bearer <t>` first, else the `session` cookie. */
export function tokenFromRequest(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const cookie = headers.get('cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() !== 'session') continue;
      const raw = part.slice(i + 1).trim();
      if (!raw) continue;
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/** Every token presented (Bearer and cookie), de-duplicated; used by logout. */
export function tokensFromRequest(headers: Headers): string[] {
  const out = new Set<string>();
  const bearer = tokenFromRequest(new Headers({ authorization: headers.get('authorization') ?? '' }));
  if (bearer) out.add(bearer);
  const cookie = tokenFromRequest(new Headers({ cookie: headers.get('cookie') ?? '' }));
  if (cookie) out.add(cookie);
  return [...out];
}
