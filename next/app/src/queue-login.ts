let save: (() => Promise<boolean>) | undefined;
let returning = false;
const key = 'plyr-next-queue-login';

export function registerQueueLogin(callback: () => Promise<boolean>) {
  save = callback;
  return () => { if (save === callback) save = undefined; };
}
export async function prepareQueueLogin() {
  const anonymous = await save?.().catch(() => false);
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (anonymous) sessionStorage.setItem(key, String(Date.now()));
      else sessionStorage.removeItem(key);
    }
  } catch {}
}
export function completeQueueLogin(success: boolean) {
  if (typeof sessionStorage === 'undefined') return;
  let created = 0;
  try { created = Number(sessionStorage.getItem(key)); sessionStorage.removeItem(key); } catch {}
  returning = success && created > 0 && Date.now() - created >= 0 && Date.now() - created < 30 * 60_000;
}
export function consumeQueueLogin() { const value = returning; returning = false; return value; }
