import { rmSync } from 'node:fs';

/** Remove the throwaway data directory the e2e dev server wrote into. */
export default function globalTeardown(): void {
  const dir = process.env.E2E_DATA_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
}
