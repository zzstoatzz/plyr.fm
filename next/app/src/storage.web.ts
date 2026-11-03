export function readLocal(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key: string, value: string) {
	try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
export function removeLocal(key: string) {
	try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
