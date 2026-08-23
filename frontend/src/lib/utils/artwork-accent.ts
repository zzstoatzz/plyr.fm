/**
 * derive an accent from artwork.
 *
 * samples the image on a small canvas and buckets saturated pixels, scoring
 * each bucket by saturation and closeness to mid-lightness so the pick reads
 * as "the color of this cover" rather than its darkest or brightest pixel.
 * monochrome covers fall back to their average tone, lifted slightly so the
 * wash stays visible on a dark page.
 *
 * requires the image host to allow cross-origin reads (`crossorigin`
 * + `Access-Control-Allow-Origin`); a tainted canvas throws, callers should
 * treat any throw as "no accent" and keep the neutral look.
 */

export interface ArtworkAccent {
	/** space-separated rgb triple, e.g. "190 124 143" */
	primary: string;
	secondary: string;
}

const SAMPLE_SIZE = 28;

interface HslSample {
	saturation: number;
	lightness: number;
}

function rgbToHsl(red: number, green: number, blue: number): HslSample {
	const r = red / 255;
	const g = green / 255;
	const b = blue / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	if (max === min) return { saturation: 0, lightness };
	const delta = max - min;
	const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	return { saturation, lightness };
}

interface Bucket {
	red: number;
	green: number;
	blue: number;
	count: number;
	score: number;
}

export function extractArtworkAccent(image: HTMLImageElement): ArtworkAccent {
	const canvas = document.createElement('canvas');
	canvas.width = SAMPLE_SIZE;
	canvas.height = SAMPLE_SIZE;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('canvas 2d context unavailable');
	context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

	// throws on a tainted canvas (image host without CORS) — caller's problem
	const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

	const buckets = new Map<string, Bucket>();
	let neutralRed = 0;
	let neutralGreen = 0;
	let neutralBlue = 0;
	let neutralCount = 0;

	for (let index = 0; index < pixels.length; index += 4) {
		if (pixels[index + 3] < 180) continue;
		const red = pixels[index];
		const green = pixels[index + 1];
		const blue = pixels[index + 2];
		const { saturation, lightness } = rgbToHsl(red, green, blue);
		if (lightness >= 0.12 && lightness <= 0.88) {
			neutralRed += red;
			neutralGreen += green;
			neutralBlue += blue;
			neutralCount += 1;
		}
		if (saturation < 0.22 || lightness < 0.12 || lightness > 0.88) continue;

		const key = `${Math.round(red / 24)}:${Math.round(green / 24)}:${Math.round(blue / 24)}`;
		const bucket = buckets.get(key) ?? { red: 0, green: 0, blue: 0, count: 0, score: 0 };
		bucket.red += red;
		bucket.green += green;
		bucket.blue += blue;
		bucket.count += 1;
		bucket.score += saturation * (1 - Math.abs(lightness - 0.52));
		buckets.set(key, bucket);
	}

	const ranked = [...buckets.values()]
		.map((bucket) => ({
			red: Math.round(bucket.red / bucket.count),
			green: Math.round(bucket.green / bucket.count),
			blue: Math.round(bucket.blue / bucket.count),
			score: bucket.score * Math.log2(bucket.count + 1)
		}))
		.sort((left, right) => right.score - left.score);

	if (ranked.length === 0) {
		if (neutralCount === 0) throw new Error('no readable pixels');
		const lift = 24;
		const red = Math.round(neutralRed / neutralCount);
		const green = Math.round(neutralGreen / neutralCount);
		const blue = Math.round(neutralBlue / neutralCount);
		return {
			primary: `${red} ${green} ${blue}`,
			secondary: `${Math.min(255, red + lift)} ${Math.min(255, green + lift)} ${Math.min(255, blue + lift)}`
		};
	}

	const primary = ranked[0];
	const secondary =
		ranked.find(
			(candidate) =>
				Math.abs(candidate.red - primary.red) +
					Math.abs(candidate.green - primary.green) +
					Math.abs(candidate.blue - primary.blue) >
				80
		) ??
		ranked[1] ??
		primary;

	return {
		primary: `${primary.red} ${primary.green} ${primary.blue}`,
		secondary: `${secondary.red} ${secondary.green} ${secondary.blue}`
	};
}

/**
 * blend an accent toward a dark base for `meta[name=theme-color]`, so mobile
 * browser chrome reads as a darkened tint of the cover, not the raw color.
 */
export function themeColorFromAccent(accent: ArtworkAccent, base = 0x0a): string {
	const parts = accent.primary.split(' ').map(Number);
	if (parts.length !== 3 || !parts.every(Number.isFinite)) return '#0a0a0a';
	const blend = (channel: number) => Math.round(channel * 0.22 + base * 0.78);
	const hex = (value: number) => value.toString(16).padStart(2, '0');
	return `#${hex(blend(parts[0]))}${hex(blend(parts[1]))}${hex(blend(parts[2]))}`;
}
