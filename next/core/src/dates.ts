const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A calendar date for a list or a detail line: `dec 5` this year, `dec 5, 2025` any other year, so an old date never reads as this year's. */
export function shortDate(value: string | number | Date, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}
