import { describe, it, expect } from 'vitest';
import { groupForList, groupName, nextOptionName, optionBaseName, optionGroupId, sortGroup } from './options';

const m = (id: string, name: string, createdAt: string, optionOf?: string) => ({ id, name, createdAt, ...(optionOf ? { optionOf } : {}) });

describe('design option helpers', () => {
  it('a project names its own group until it is an option', () => {
    expect(optionGroupId({ id: 'a' })).toBe('a');
    expect(optionGroupId({ id: 'b', optionOf: 'a' })).toBe('a');
  });

  it('strips an option suffix from a name', () => {
    expect(optionBaseName('Kitchen — Option B')).toBe('Kitchen');
    expect(optionBaseName('Kitchen — Option 27')).toBe('Kitchen');
    expect(optionBaseName('Kitchen')).toBe('Kitchen');
  });

  it('names options B, C, … reusing a free letter, then numbers after Z', () => {
    expect(nextOptionName('Kitchen', ['Kitchen'])).toBe('Kitchen — Option B');
    expect(nextOptionName('Kitchen', ['Kitchen', 'Kitchen — Option B'])).toBe('Kitchen — Option C');
    expect(nextOptionName('Kitchen', ['Kitchen', 'Kitchen — Option C'])).toBe('Kitchen — Option B');
    // A renamed option frees its letter.
    expect(nextOptionName('Kitchen', ['Kitchen', 'Galley idea'])).toBe('Kitchen — Option B');
    const all = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `Kitchen — Option ${l}`);
    expect(nextOptionName('Kitchen', all)).toBe('Kitchen — Option 27');
    expect(nextOptionName('Kitchen', [...all, 'Kitchen — Option 27'])).toBe('Kitchen — Option 28');
  });

  it('orders a group: the original first, then options oldest first', () => {
    const group = sortGroup([m('c', 'K — Option C', '2026-01-03', 'a'), m('a', 'K', '2026-01-01'), m('b', 'K — Option B', '2026-01-02', 'a')], 'a');
    expect(group.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(groupName(group)).toBe('K');
  });

  it('names a group whose original is gone after its oldest option, without the suffix', () => {
    const group = sortGroup([m('c', 'K — Option C', '2026-01-03', 'a'), m('b', 'K — Option B', '2026-01-02', 'a')], 'a');
    expect(groupName(group)).toBe('K');
  });

  it('lists each group where its newest member sorts, members in group order', () => {
    const newestFirst = [m('b', 'K — Option B', '2026-01-02', 'a'), m('x', 'Bath', '2026-01-05'), m('a', 'K', '2026-01-01')];
    expect(groupForList(newestFirst).map((g) => g.map((p) => p.id))).toEqual([['a', 'b'], ['x']]);
  });
});
