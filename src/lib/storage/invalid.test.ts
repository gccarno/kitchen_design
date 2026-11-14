// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';

const sent = vi.hoisted(() => ({ calls: [] as [unknown, Record<string, unknown>][] }));
vi.mock('../monitoring', () => ({ reportError: (e: unknown, c: Record<string, unknown>) => sent.calls.push([e, c]) }));
import { reportInvalidProject } from './invalid';

afterEach(() => {
  sent.calls.length = 0;
  vi.restoreAllMocks();
});

describe('reportInvalidProject', () => {
  it('logs and reports only the id, error name and failing paths — never the document', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parsed = z.object({ name: z.enum(['a', 'b']) }).safeParse({ name: 'SECRET-VALUE' });
    reportInvalidProject('p-1', parsed.error);
    let jsonErr: unknown;
    try {
      JSON.parse('{"owner":"SECRET-VALUE"');
    } catch (e) {
      jsonErr = e;
    }
    reportInvalidProject('p-2', jsonErr);
    const everything = JSON.stringify([errors.mock.calls, sent.calls.map(([e, c]) => [(e as Error).name, (e as Error).message, (e as Error).stack, c])]);
    expect(everything).not.toContain('SECRET');
    expect(JSON.parse(String(errors.mock.calls[0][0]))).toEqual({ event: 'project_invalid', projectId: 'p-1', issues: ['name: invalid_value'] });
    expect((sent.calls[1][0] as Error).name).toBe('SyntaxError');
  });

  it('reports each project to Sentry once, but logs every skip', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportInvalidProject('p-3', new Error('x'));
    reportInvalidProject('p-3', new Error('x'));
    expect(errors).toHaveBeenCalledTimes(2);
    expect(sent.calls).toHaveLength(1);
  });
});
