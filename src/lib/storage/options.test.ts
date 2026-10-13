import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, duplicateAsOption, listProjects, loadProject, optionGroup, projectDir, saveProject } from './projects';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('design options in storage', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'kd-options-'));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  /** A kitchen with an item, prices, a photo on disk and some history to leave behind. */
  function kitchen(name = 'Our kitchen') {
    const p = createProject(dataDir, { name });
    saveProject(dataDir, {
      ...loadProject(dataDir, p.id),
      items: [{ id: 'i1', catalogId: 'base-600x560x720', tag: 'base', sizeMm: { w: 600, d: 560, h: 720 }, position: { x: 500, y: 500 }, rotationDeg: 0 }],
      pricing: { currency: 'EUR', unitPrices: { 'base-600x560x720': 99 } },
      photos: [{ id: 'ph1', path: 'photos/ph1.jpg', width: 10, height: 10 }],
      revision: 3,
    });
    writeFileSync(join(projectDir(dataDir, p.id), 'photos', 'ph1.jpg'), 'jpeg bytes');
    return loadProject(dataDir, p.id);
  }

  it('copies a design as Option B: new id, fresh history, same plan, prices and photos; the original is untouched', () => {
    const original = kitchen();
    const before = readFileSync(join(projectDir(dataDir, original.id), 'project.json'), 'utf-8');
    const b = duplicateAsOption(dataDir, original.id);
    expect(b.id).not.toBe(original.id);
    expect(b).toMatchObject({
      name: 'Our kitchen — Option B',
      optionOf: original.id,
      kind: 'kitchen',
      units: original.units,
      revision: 0,
      history: [],
      room: original.room,
      items: original.items,
      pricing: original.pricing,
      photos: original.photos,
    });
    expect(loadProject(dataDir, b.id)).toEqual(b);
    expect(readFileSync(join(projectDir(dataDir, b.id), 'photos', 'ph1.jpg'), 'utf-8')).toBe('jpeg bytes');
    expect(readFileSync(join(projectDir(dataDir, original.id), 'project.json'), 'utf-8')).toBe(before);
  });

  it('an option of an option joins the original group as the next letter', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    const c = duplicateAsOption(dataDir, b.id);
    expect(c.optionOf).toBe(original.id);
    expect(c.name).toBe('Our kitchen — Option C');
    expect(optionGroup(dataDir, original.id).map((p) => p.name)).toEqual(['Our kitchen', 'Our kitchen — Option B', 'Our kitchen — Option C']);
  });

  it('keeps the group together when the original is deleted, and names the next option after it', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    duplicateAsOption(dataDir, b.id);
    rmSync(projectDir(dataDir, original.id), { recursive: true, force: true });
    expect(optionGroup(dataDir, original.id).map((p) => p.name)).toEqual(['Our kitchen — Option B', 'Our kitchen — Option C']);
    expect(duplicateAsOption(dataDir, b.id).name).toBe('Our kitchen — Option D');
  });

  it('copies a closet with its closet', () => {
    const closet = createProject(dataDir, { name: 'Hall closet', kind: 'closet' });
    const b = duplicateAsOption(dataDir, closet.id);
    expect(b.kind).toBe('closet');
    expect(b.closet).toEqual(closet.closet);
  });

  it('ignores a photo id that would name a file outside the photos directory', () => {
    const original = kitchen();
    const file = join(projectDir(dataDir, original.id), 'project.json');
    const edited = JSON.parse(readFileSync(file, 'utf-8'));
    edited.photos.push({ id: '../evil', path: 'photos/x.jpg', width: 10, height: 10 });
    writeFileSync(file, JSON.stringify(edited));
    writeFileSync(join(projectDir(dataDir, original.id), 'evil.jpg'), 'not a photo');
    const b = duplicateAsOption(dataDir, original.id);
    expect(b.photos.map((p) => p.id)).toEqual(['ph1']);
    expect(existsSync(join(projectDir(dataDir, b.id), 'evil.jpg'))).toBe(false);
    expect(existsSync(join(projectDir(dataDir, b.id), 'photos', 'ph1.jpg'))).toBe(true);
  });

  it('still copies when a listed photo file is missing on disk', () => {
    const original = kitchen();
    rmSync(join(projectDir(dataDir, original.id), 'photos', 'ph1.jpg'));
    expect(duplicateAsOption(dataDir, original.id).photos).toEqual(original.photos);
  });

  it('throws for an unknown source', () => {
    expect(() => duplicateAsOption(dataDir, UNKNOWN)).toThrow(/not found/i);
  });

  it('finds nothing for an unknown or invalid group id; a lone project is a group of one', () => {
    const lone = kitchen('Cabin');
    expect(optionGroup(dataDir, UNKNOWN)).toEqual([]);
    expect(optionGroup(dataDir, '../etc')).toEqual([]);
    expect(optionGroup(dataDir, lone.id).map((p) => p.id)).toEqual([lone.id]);
  });

  it('lists options with their link and creation time', () => {
    const original = kitchen();
    const b = duplicateAsOption(dataDir, original.id);
    const listed = listProjects(dataDir).find((p) => p.id === b.id)!;
    expect(listed.optionOf).toBe(original.id);
    expect(listed.createdAt).toBe(b.createdAt);
    expect(listProjects(dataDir).find((p) => p.id === original.id)!.optionOf).toBeUndefined();
  });
});
