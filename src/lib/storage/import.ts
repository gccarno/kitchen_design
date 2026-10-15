import { PHOTO_ID, photoKey } from './ids';
import type { Storage } from './store';

export type ImportReport = { imported: string[]; skipped: string[]; missingPhotos: string[] };

/**
 * Copy every project (and its photos) from `source` to `target`. A project
 * already in the target is skipped, so a failed run can simply be re-run.
 * Photos go first and the record last: a half-imported project is retried
 * on the next run.
 */
export async function importProjects(
  source: Storage,
  target: Storage,
  opts: { dryRun?: boolean } = {}
): Promise<ImportReport> {
  const report: ImportReport = { imported: [], skipped: [], missingPhotos: [] };
  for (const summary of await source.projects.list()) {
    const project = await source.projects.load(summary.id);
    if (!project) continue;
    if (await target.projects.load(project.id)) {
      report.skipped.push(project.id);
      continue;
    }
    for (const photo of project.photos) {
      if (!PHOTO_ID.test(photo.id)) continue;
      const bytes = await source.blobs.get(photoKey(project.id, photo.id));
      if (!bytes) {
        report.missingPhotos.push(`${project.id}/${photo.id}`);
        continue;
      }
      if (!opts.dryRun) await target.blobs.put(photoKey(project.id, photo.id), bytes, 'image/jpeg');
    }
    if (!opts.dryRun) await target.projects.insert(project);
    report.imported.push(project.id);
  }
  return report;
}
