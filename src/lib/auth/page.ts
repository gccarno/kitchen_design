import { redirect } from 'next/navigation';
import { getStorage, type Storage } from '../storage';
import { UnauthorizedError } from './session';

/** getStorage() for server pages: no valid session → redirect to /login (the middleware normally does this first). */
export async function getPageStorage(): Promise<Storage> {
  try {
    return await getStorage();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/login');
    throw err;
  }
}
