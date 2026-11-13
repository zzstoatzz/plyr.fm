export interface Row { top: number; height: number }

export function stepForKey(key: string, position: number, total: number): number | null {
  const target = key === 'ArrowUp' ? position - 1 : key === 'ArrowDown' ? position + 1
    : key === 'Home' ? 1 : key === 'End' ? total : null;
  if (target === null || target < 1 || target > total || target === position) return null;
  return target - position;
}

export function dragTarget(rows: Row[], from: number, rawOffset: number) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const origin = rows[from];
  const offset = Math.max(first.top - origin.top, Math.min(last.top + last.height - origin.top - origin.height, rawOffset));
  const center = origin.top + origin.height / 2 + offset;
  let to = from;
  for (let index = 0; index < rows.length; index++) {
    const middle = rows[index].top + rows[index].height / 2;
    if (index < from && center <= middle) { to = index; break; }
    if (index > from && center >= middle) to = index;
  }
  return { offset, to };
}

export function rowShift(rows: Row[], from: number, to: number, index: number) {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -rows[from].height;
  if (from > to && index >= to && index < from) return rows[from].height;
  return 0;
}

export function landingTop(rows: Row[], from: number, to: number) {
  if (to === from) return null;
  return to > from ? rows[to].top + rows[to].height - rows[from].height : rows[to].top;
}

export function autoscrollVelocity(pointerY: number, top: number, bottom: number, edge = 56, max = 14) {
  if (pointerY < top + edge) return -Math.min(max, (top + edge - pointerY) / 4);
  if (pointerY > bottom - edge) return Math.min(max, (pointerY - bottom + edge) / 4);
  return 0;
}
