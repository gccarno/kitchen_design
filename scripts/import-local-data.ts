/**
 * npm run import:local -- [--data ./data] [--dry-run] [--yes]
 *
 * Copy projects and photos from a local data directory into the configured
 * cloud backends (DATABASE_URL, and GCS_BUCKET for photos). Re-runnable:
 * projects already in the database are skipped. A non-local database needs --yes.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '../src/lib/db/client';
import { isLocalDatabase } from '../src/lib/db/remote-guard';
import { importProjects } from '../src/lib/storage/import';
import { fsStorage, getStorage } from '../src/lib/storage';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: './data' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

// The package is CommonJS to tsx (no "type": "module"), so no top-level await.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set — there is nothing to import into.');
    process.exit(1);
  }
  if (!isLocalDatabase(url) && !values.yes && !values['dry-run']) {
    console.error(`Target database is ${new URL(url).hostname}. Re-run with --yes to import into it (or --dry-run to preview).`);
    process.exit(1);
  }
  if (!process.env.GCS_BUCKET) console.warn('GCS_BUCKET is not set: photos will be written to DATA_DIR on this machine.');

  try {
    const report = await importProjects(fsStorage(resolve(values.data!)), await getStorage(), { dryRun: values['dry-run'] });
    console.log(`${values['dry-run'] ? 'Would import' : 'Imported'} ${report.imported.length}, skipped ${report.skipped.length} already present.`);
    if (report.missingPhotos.length > 0) console.warn(`Photos listed but missing on disk: ${report.missingPhotos.join(', ')}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
