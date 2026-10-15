import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each(['/project/abc?x=1', '/', '/compare/x#y'])('keeps %s', (p) => expect(safeNextPath(p)).toBe(p));
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', 'project/x', '', '/a\\b', '/a\nb', '/a\tb'])(
    'rejects %j',
    (p) => expect(safeNextPath(p)).toBe('/')
  );
  it('handles missing', () => {
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
