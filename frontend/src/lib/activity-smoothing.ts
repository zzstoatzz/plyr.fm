export interface ChartPoint {
	x: number;
	y: number;
}

/**
 * Centered rolling mean over the first `complete` counts. Later buckets get
 * `null` and feed no average; windows shrink at the edges.
 */
export function rollingMean(
	counts: readonly number[],
	window: number,
	complete: number = counts.length
): (number | null)[] {
	const usable = Math.max(0, Math.min(complete, counts.length));
	const before = Math.floor((window - 1) / 2);
	const after = window - 1 - before;
	return counts.map((_, i) => {
		if (i >= usable) return null;
		const start = Math.max(0, i - before);
		const end = Math.min(usable - 1, i + after);
		let sum = 0;
		for (let j = start; j <= end; j++) sum += counts[j];
		return sum / (end - start + 1);
	});
}

/** SVG path through the points as a monotone cubic (Fritsch–Carlson). */
export function monotonePath(points: readonly ChartPoint[]): string {
	const n = points.length;
	if (n === 0) return '';
	if (n === 1) return `M${points[0].x},${points[0].y}`;
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
	}
	const tangents = points.map((_, i) => {
		if (i === 0) return slopes[0];
		if (i === n - 1) return slopes[n - 2];
		return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
	});
	for (let i = 0; i < n - 1; i++) {
		if (slopes[i] === 0) {
			tangents[i] = 0;
			tangents[i + 1] = 0;
			continue;
		}
		const a = tangents[i] / slopes[i];
		const b = tangents[i + 1] / slopes[i];
		const magnitude = a * a + b * b;
		if (magnitude > 9) {
			const scale = 3 / Math.sqrt(magnitude);
			tangents[i] = scale * a * slopes[i];
			tangents[i + 1] = scale * b * slopes[i];
		}
	}
	let d = `M${points[0].x},${points[0].y}`;
	for (let i = 0; i < n - 1; i++) {
		const h = (points[i + 1].x - points[i].x) / 3;
		d += ` C${points[i].x + h},${points[i].y + tangents[i] * h} ${points[i + 1].x - h},${
			points[i + 1].y - tangents[i + 1] * h
		} ${points[i + 1].x},${points[i + 1].y}`;
	}
	return d;
}
