export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = 31536000;

function attrs(env: NodeJS.ProcessEnv): string {
  return `Path=/; HttpOnly; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attrs(env)}; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearedSessionCookie(env: NodeJS.ProcessEnv = process.env): string {
  return `${SESSION_COOKIE}=; ${attrs(env)}; Max-Age=0`;
}
