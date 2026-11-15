let save: (() => Promise<boolean>) | undefined;
export function registerQueueLogin(callback: () => Promise<boolean>) {
  save = callback;
  return () => { if (save === callback) save = undefined; };
}
export async function prepareQueueLogin() {
  await save?.().catch(() => false);
}
