import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { submitRevision } from './revisions';

const proposal = { patch: [{ op: 'replace' as const, path: '/name', value: 'N' }], baseRevision: 3, summary: 's', source: 'user' as const, confidence: 0.4 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('submitRevision', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts only the commit fields and returns the saved project', async () => {
    fetchMock.mockResolvedValueOnce(json({ project: { id: 'p', revision: 4 } }));
    const r = await submitRevision('p', proposal);
    expect(r).toEqual({ ok: true, project: { id: 'p', revision: 4 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/projects/p/revisions');
    expect(JSON.parse(init.body)).toEqual({ baseRevision: 3, patch: proposal.patch, summary: 's', source: 'user' });
  });

  it('reports a stale base revision', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'plan changed' }, 409));
    expect(await submitRevision('p', proposal)).toEqual({ ok: false, stale: true, error: 'plan changed' });
  });

  it('reports the server reason for a rejected edit', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'walls cross' }, 400));
    expect(await submitRevision('p', proposal)).toEqual({ ok: false, stale: false, error: 'walls cross' });
  });

  it('reports network failures instead of throwing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await submitRevision('p', proposal)).toEqual({ ok: false, stale: false, error: 'Failed to fetch' });
  });
});
