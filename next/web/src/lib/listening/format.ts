import { shortDate } from '@plyr/next-core/dates';

export function compactCount(count: number) {
  if (count < 1000) return String(count);
  const unit = count >= 1_000_000_000 ? 1_000_000_000 : count >= 1_000_000 ? 1_000_000 : 1000;
  const value = Math.floor(count / unit * 10) / 10;
  return `${value}${unit === 1000 ? 'k' : unit === 1_000_000 ? 'm' : 'b'}`;
}

export function postedAt(value: string, now = Date.now()) {
  const date = new Date(value);
  const hours = Math.floor((now - date.getTime()) / 3_600_000);
  if (!Number.isFinite(hours)) return '';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  if (hours < 168) return `${Math.floor(hours / 24)}d ago`;
  return shortDate(date, now);
}
