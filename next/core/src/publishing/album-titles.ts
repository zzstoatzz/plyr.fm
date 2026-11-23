const NUMBERED = /^\d{1,3}\s*[-–.)_]?\s+(?=\S)/;

/** Track titles from file names; a "01 " style prefix every file shares is dropped, since the order already says it. */
export function albumTitles(names: readonly string[]): string[] {
  const bare = names.map(name => name.replace(/\.[^.]+$/, '').trim());
  const strip = bare.length > 1 && bare.every(name => NUMBERED.test(name));
  return bare.map((name, index) => ((strip ? name.replace(NUMBERED, '') : name) || names[index]).slice(0, 256));
}
