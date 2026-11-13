/** The iOS share extension opens `<scheme>://expo-sharing`; shared audio lands on upload. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return /^([a-z0-9.+-]+:\/\/)?\/?expo-sharing\b/i.test(path) ? '/upload' : path;
}
