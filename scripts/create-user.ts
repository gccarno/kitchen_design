/**
 * NEW_USER_PASSWORD=... npm run create-user -- <email>
 * Create an account in DATABASE_URL. Refuses a non-local database unless
 * MIGRATE_ALLOW_REMOTE=1. The first user claims owner-less projects.
 */
import { CliError, createUserCli } from '../src/lib/auth/create-user-cli';
import { EmailTakenError, InvalidCredentialsInputError } from '../src/lib/auth/users';
import { closeDb, getDb } from '../src/lib/db/client';

// The package is CommonJS to tsx (no "type": "module"), so no top-level await.
async function main(): Promise<void> {
  try {
    const { user, claimedOrphans } = await createUserCli(process.env, process.argv[2], getDb);
    console.log(`Created ${user.email}${claimedOrphans ? ' (claimed existing owner-less projects)' : ''}.`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  const expected = err instanceof CliError || err instanceof EmailTakenError || err instanceof InvalidCredentialsInputError;
  console.error(expected ? (err as Error).message : err);
  process.exit(1);
});
