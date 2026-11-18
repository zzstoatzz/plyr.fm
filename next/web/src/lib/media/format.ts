export function clock(seconds = 0) {
	const whole = Math.floor(seconds);
	const hours = Math.floor(whole / 3600);
	const rest = `${Math.floor(whole / 60) % 60}:${String(whole % 60).padStart(2, '0')}`;
	return hours ? `${hours}:${rest.padStart(5, '0')}` : rest;
}

export function fileSize(bytes: number) {
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) { value /= 1024; unit++; }
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
