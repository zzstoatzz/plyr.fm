// ambient weather theme — location-aware atmospheric background + full tinting
import { browser } from '$app/environment';

type TemperatureUnit = 'fahrenheit' | 'celsius';

interface WeatherData {
	temperature: number;
	weathercode: number;
	is_day: boolean;
}

/** regions that use Fahrenheit (ISO 3166-1 alpha-2) */
const FAHRENHEIT_REGIONS = new Set(['US', 'BS', 'BZ', 'KY', 'LR', 'MH', 'FM', 'PW']);

function detectTemperatureUnit(): TemperatureUnit {
	if (!browser) return 'celsius';
	const region = navigator.language?.split('-')[1]?.toUpperCase();
	return FAHRENHEIT_REGIONS.has(region ?? '') ? 'fahrenheit' : 'celsius';
}

interface AmbientLocation {
	lat: number;
	lon: number;
}

interface RGB {
	r: number;
	g: number;
	b: number;
}

interface RGBA extends RGB {
	a: number;
}

/** CSS variables to tint and their blend strengths */
const TINTED_VARS: [string, number][] = [
	// glass surfaces (15%)
	['--glass-bg', 0.15],
	['--glass-border', 0.15],
	// borders (8-10%)
	['--border-subtle', 0.08],
	['--border-default', 0.10],
	// track cards (10-14%)
	['--track-bg', 0.10],
	['--track-bg-hover', 0.12],
	['--track-bg-playing', 0.10],
	['--track-border', 0.12],
	['--track-border-hover', 0.14],
	// backgrounds (6-8%)
	['--bg-secondary', 0.06],
	['--bg-tertiary', 0.07],
	['--bg-hover', 0.08],
];

function getConditionLabel(code: number): string {
	if (code <= 3) return 'clear';
	if (code >= 45 && code <= 48) return 'fog';
	if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
	if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
	if (code >= 95) return 'storm';
	return 'cloudy';
}

/** 0 (cold) to 1 (hot), unit-aware: 5–35°C or 41–95°F */
function computeWarmth(temperature: number, unit: TemperatureUnit): number {
	const [cold, hot] = unit === 'fahrenheit' ? [41, 95] : [5, 35];
	return Math.min(1, Math.max(0, (temperature - cold) / (hot - cold)));
}

/** interpolate 3 color stops into 7 for smoother gradients (reduces banding) */
function smoothGradient(c1: RGB, c2: RGB, c3: RGB): string {
	const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
	const stops: string[] = [];
	// 4 stops from c1→c2, 4 stops from c2→c3 (c2 shared = 7 total)
	for (let i = 0; i <= 3; i++) {
		const t = i / 3;
		stops.push(`rgb(${lerp(c1.r, c2.r, t)}, ${lerp(c1.g, c2.g, t)}, ${lerp(c1.b, c2.b, t)})`);
	}
	for (let i = 1; i <= 3; i++) {
		const t = i / 3;
		stops.push(`rgb(${lerp(c2.r, c3.r, t)}, ${lerp(c2.g, c3.g, t)}, ${lerp(c2.b, c3.b, t)})`);
	}
	return `linear-gradient(135deg, ${stops.join(', ')})`;
}

function computeGradient(w: WeatherData, unit: TemperatureUnit): string {
	const { weathercode, is_day, temperature } = w;
	const warmth = computeWarmth(temperature, unit);

	if (is_day) {
		if (weathercode <= 3) {
			// clear day: warm gold → amber → soft sky
			return smoothGradient(
				{ r: Math.round(200 + warmth * 55), g: Math.round(160 + warmth * 40), b: Math.round(60 + (1 - warmth) * 80) },
				{ r: 180, g: 140, b: 80 },
				{ r: 100, g: 140, b: 180 }
			);
		}
		if (weathercode >= 45 && weathercode <= 48)
			return smoothGradient({ r: 160, g: 155, b: 175 }, { r: 180, g: 178, b: 182 }, { r: 150, g: 150, b: 155 });
		if ((weathercode >= 51 && weathercode <= 67) || (weathercode >= 80 && weathercode <= 82))
			return smoothGradient({ r: 70, g: 100, b: 140 }, { r: 60, g: 110, b: 120 }, { r: 80, g: 95, b: 130 });
		if ((weathercode >= 71 && weathercode <= 77) || (weathercode >= 85 && weathercode <= 86))
			return smoothGradient({ r: 200, g: 210, b: 220 }, { r: 180, g: 195, b: 215 }, { r: 170, g: 185, b: 200 });
		if (weathercode >= 95)
			return smoothGradient({ r: 80, g: 50, b: 100 }, { r: 60, g: 55, b: 75 }, { r: 50, g: 45, b: 60 });
		return smoothGradient({ r: 140, g: 150, b: 165 }, { r: 120, g: 130, b: 145 }, { r: 110, g: 115, b: 130 });
	}

	// night variants
	if (weathercode <= 3)
		return smoothGradient({ r: 20, g: 20, b: 60 }, { r: 15, g: 25, b: 50 }, { r: 10, g: 15, b: 40 });
	if (weathercode >= 45 && weathercode <= 48)
		return smoothGradient({ r: 50, g: 50, b: 60 }, { r: 40, g: 42, b: 50 }, { r: 35, g: 35, b: 42 });
	if ((weathercode >= 51 && weathercode <= 67) || (weathercode >= 80 && weathercode <= 82))
		return smoothGradient({ r: 15, g: 30, b: 40 }, { r: 20, g: 25, b: 45 }, { r: 12, g: 20, b: 35 });
	if ((weathercode >= 71 && weathercode <= 77) || (weathercode >= 85 && weathercode <= 86))
		return smoothGradient({ r: 60, g: 65, b: 80 }, { r: 40, g: 50, b: 70 }, { r: 30, g: 35, b: 55 });
	if (weathercode >= 95)
		return smoothGradient({ r: 30, g: 15, b: 45 }, { r: 20, g: 18, b: 30 }, { r: 12, g: 10, b: 20 });
	return smoothGradient({ r: 35, g: 38, b: 48 }, { r: 28, g: 30, b: 40 }, { r: 22, g: 24, b: 32 });
}

/** one representative tint color per weather condition */
function computeTint(w: WeatherData, unit: TemperatureUnit): RGB {
	const condition = getConditionLabel(w.weathercode);
	const warmth = computeWarmth(w.temperature, unit);

	if (w.is_day) {
		switch (condition) {
			case 'clear': return {
				r: Math.round(200 + warmth * 40),
				g: Math.round(160 + warmth * 20),
				b: Math.round(60 - warmth * 20)
			};
			case 'fog': return { r: 160, g: 155, b: 175 };
			case 'rain': return { r: 70, g: 100, b: 140 };
			case 'snow': return { r: 190, g: 200, b: 215 };
			case 'storm': return { r: 80, g: 50, b: 100 };
			default: return { r: 130, g: 140, b: 155 }; // cloudy
		}
	}
	switch (condition) {
		case 'clear': return { r: 30, g: 30, b: 80 };
		case 'fog': return { r: 50, g: 50, b: 65 };
		case 'rain': return { r: 20, g: 30, b: 50 };
		case 'snow': return { r: 50, g: 55, b: 75 };
		case 'storm': return { r: 25, g: 15, b: 40 };
		default: return { r: 35, g: 38, b: 48 }; // cloudy
	}
}

/** parse rgb(), rgba(), or hex color string to RGBA */
function parseColor(css: string): RGBA | null {
	const trimmed = css.trim();

	// hex: #rgb, #rrggbb, #rrggbbaa
	if (trimmed.startsWith('#')) {
		const hex = trimmed.slice(1);
		if (hex.length === 3) {
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16),
				a: 1
			};
		}
		if (hex.length >= 6) {
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
				a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
			};
		}
		return null;
	}

	// rgba(r, g, b, a) or rgb(r, g, b)
	const match = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
	if (match) {
		return {
			r: parseFloat(match[1]),
			g: parseFloat(match[2]),
			b: parseFloat(match[3]),
			a: match[4] !== undefined ? parseFloat(match[4]) : 1
		};
	}
	return null;
}

/** blend a base color with a tint at given strength, preserving alpha */
function blendColor(base: RGBA, tint: RGB, strength: number): string {
	const r = Math.round(base.r + (tint.r - base.r) * strength);
	const g = Math.round(base.g + (tint.g - base.g) * strength);
	const b = Math.round(base.b + (tint.b - base.b) * strength);
	if (base.a < 1) {
		return `rgba(${r}, ${g}, ${b}, ${base.a})`;
	}
	return `rgb(${r}, ${g}, ${b})`;
}

function cacheWeather(w: WeatherData): void {
	try { localStorage.setItem('ambient_weather', JSON.stringify(w)); } catch { /* quota */ }
}

function getCachedWeather(): WeatherData | null {
	try {
		const raw = localStorage.getItem('ambient_weather');
		return raw ? JSON.parse(raw) as WeatherData : null;
	} catch { return null; }
}

class AmbientManager {
	enabled = $state(false);
	location = $state<AmbientLocation | null>(null);
	weather = $state<WeatherData | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	readonly temperatureUnit: TemperatureUnit = detectTemperatureUnit();

	private fetchIntervalId: ReturnType<typeof window.setInterval> | null = null;
	private lastFetchTime = 0;
	private readonly STALE_MS = 30 * 60 * 1000; // 30 minutes
	private baseValues: Map<string, string> = new Map();

	get gradient(): string | null {
		if (!this.weather) return null;
		return computeGradient(this.weather, this.temperatureUnit);
	}

	get conditionLabel(): string | null {
		if (!this.weather) return null;
		const w = this.weather;
		const temp = Math.round(w.temperature);
		const unit = this.temperatureUnit === 'fahrenheit' ? 'F' : 'C';
		const condition = getConditionLabel(w.weathercode);
		const time = w.is_day ? 'day' : 'night';
		return `${temp}°${unit} · ${condition} · ${time}`;
	}

	/** activate ambient mode. returns false if geolocation denied or unavailable. */
	async activate(): Promise<boolean> {
		if (!browser) return false;

		this.loading = true;
		this.error = null;

		try {
			// check device-global location cache first
			let locStr = localStorage.getItem('ambient_location');

			// migrate from old DID-scoped keys if needed
			if (!locStr) {
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.startsWith('ambient_location:')) {
						locStr = localStorage.getItem(k);
						if (locStr) {
							localStorage.setItem('ambient_location', locStr);
							localStorage.removeItem(k);
						}
						break;
					}
				}
			}

			if (locStr) {
				try {
					this.location = JSON.parse(locStr);
				} catch {
					this.location = null;
				}
			}

			// prompt geolocation if no cached location
			if (!this.location) {
				const coords = await this.requestLocation();
				this.location = coords;
				localStorage.setItem('ambient_location', JSON.stringify(coords));
			}

			// restore cached weather for instant gradient, then refresh in background
			const cached = getCachedWeather();
			if (cached) {
				this.weather = cached;
				this.enabled = true;
				this.startRefreshCycle();
				this.fetchWeather(); // background refresh — no await
			} else {
				this.enabled = true;
				await this.fetchWeather();
				this.startRefreshCycle();
			}
			return true;
		} catch (err) {
			this.error = err instanceof GeolocationPositionError
				? 'location access denied — ambient mode needs your location to read the sky'
				: 'could not determine location';
			this.enabled = false;
			return false;
		} finally {
			this.loading = false;
		}
	}

	/** deactivate ambient mode. keeps cached location for next activation. */
	deactivate(): void {
		if (!browser) return;

		this.enabled = false;
		this.weather = null;
		this.error = null;

		if (this.fetchIntervalId !== null) {
			window.clearInterval(this.fetchIntervalId);
			this.fetchIntervalId = null;
		}

		this.clearFromDOM();

		// clean up old DID-scoped enabled keys
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k && k.startsWith('ambient_enabled')) {
				localStorage.removeItem(k);
			}
		}
	}

	applyToDOM(): void {
		if (!browser || !this.enabled || !this.gradient || !this.weather) return;

		document.body.classList.add('ambient-active');
		document.documentElement.style.setProperty('--ambient-gradient', this.gradient);

		// snapshot base values on first apply (or after refresh)
		if (this.baseValues.size === 0) {
			this.snapshotBaseValues();
		}

		const tint = computeTint(this.weather, this.temperatureUnit);
		for (const [varName, strength] of TINTED_VARS) {
			const baseVal = this.baseValues.get(varName);
			if (!baseVal) continue;
			const parsed = parseColor(baseVal);
			if (!parsed) continue;
			document.documentElement.style.setProperty(varName, blendColor(parsed, tint, strength));
		}
	}

	clearFromDOM(): void {
		if (!browser) return;

		// remove tinted variable overrides
		for (const [varName] of TINTED_VARS) {
			document.documentElement.style.removeProperty(varName);
		}
		this.baseValues.clear();

		document.body.classList.remove('ambient-active');
		document.documentElement.style.removeProperty('--ambient-gradient');
	}

	/** remove overrides, re-snapshot base values from current theme, re-apply tint */
	refreshBaseValues(): void {
		if (!browser || !this.enabled) return;

		// temporarily remove our overrides so getComputedStyle returns the theme's base
		for (const [varName] of TINTED_VARS) {
			document.documentElement.style.removeProperty(varName);
		}
		this.baseValues.clear();

		// re-apply on next frame so computed styles reflect the new theme
		window.requestAnimationFrame(() => {
			this.applyToDOM();
		});
	}

	private snapshotBaseValues(): void {
		const computed = window.getComputedStyle(document.documentElement);
		for (const [varName] of TINTED_VARS) {
			const val = computed.getPropertyValue(varName).trim();
			if (val) {
				this.baseValues.set(varName, val);
			}
		}
	}

	private requestLocation(): Promise<AmbientLocation> {
		return new Promise((resolve, reject) => {
			if (!('geolocation' in navigator)) {
				reject(new Error('geolocation not available'));
				return;
			}
			navigator.geolocation.getCurrentPosition(
				(pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
				(err) => reject(err),
				{ enableHighAccuracy: false, timeout: 10000 }
			);
		});
	}

	private async fetchWeather(): Promise<void> {
		if (!this.location) return;

		const { lat, lon } = this.location;
		try {
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,is_day&timezone=auto&temperature_unit=${this.temperatureUnit}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`weather API returned ${res.status}`);
			const data = await res.json();
			this.weather = {
				temperature: data.current.temperature_2m,
				weathercode: data.current.weathercode,
				is_day: Boolean(data.current.is_day)
			};
			this.lastFetchTime = Date.now();
			this.error = null;
			cacheWeather(this.weather);
		} catch (err) {
			console.error('ambient: failed to fetch weather', err);
			// keep previous weather data if available, only show error if no data
			if (!this.weather) {
				this.error = 'could not fetch weather data';
			}
		}
	}

	private startRefreshCycle(): void {
		if (this.fetchIntervalId !== null) return;

		// re-fetch every 30 minutes
		this.fetchIntervalId = window.setInterval(() => this.fetchWeather(), this.STALE_MS);

		// also re-fetch on tab re-focus if stale
		if (browser) {
			document.addEventListener('visibilitychange', this.handleVisibilityChange);
		}
	}

	private handleVisibilityChange = (): void => {
		if (document.visibilityState !== 'visible') return;
		if (!this.enabled || !this.location) return;
		if (Date.now() - this.lastFetchTime > this.STALE_MS) {
			this.fetchWeather();
		}
	};
}

export const ambient = new AmbientManager();
