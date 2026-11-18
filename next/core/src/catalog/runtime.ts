/** "1h 42m" for a catalog's total length; days past 24 hours. */
export function catalogRuntime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}
