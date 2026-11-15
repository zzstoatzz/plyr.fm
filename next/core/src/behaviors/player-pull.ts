export function pullDirection(dx: number, dy: number): 'blocked' | 'waiting' | 'down' {
  const across = Math.abs(dx);
  if (dy < -10 || across > 10 && across >= dy) return 'blocked';
  return dy > Math.max(10, 1.5 * across) ? 'down' : 'waiting';
}

export function dismissPlayerPull(distance: number, velocity: number, height: number, header: boolean) {
  if (header) return distance >= Math.min(120, height * 0.16) || distance >= 48 && velocity >= 0.8;
  return velocity > -0.3 && (distance >= Math.min(80, height * 0.1) || distance >= 16 && velocity >= 0.3);
}
