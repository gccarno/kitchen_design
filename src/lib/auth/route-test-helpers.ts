/** Test-only helpers for the auth route tests. */
export function jsonReq(
  url: string,
  body: unknown,
  init: { headers?: Record<string, string>; method?: string; raw?: string } = {}
): Request {
  return new Request(url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.raw ?? JSON.stringify(body),
  });
}

export function sessionFromSetCookie(res: Response): string | null {
  const m = /(?:^|,\s*)session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}
