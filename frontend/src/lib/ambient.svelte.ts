// ambient weather theme — location-aware atmospheric background
import { browser } from '$app/environment';

interface WeatherData {
	temperature: number;
	weathercode: number;
	is_day: boolean;
}

interface AmbientLocation {
	lat: number;
	lon: number;
}

function getConditionLabel(code: number): string {
	if (code <= 3) return 'clear';
	if (code >= 45 && code <= 48) return 'fog';
	if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
	if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
	if (code >= 95) return 'storm';
	return 'cloudy';
}

function computeGradient(w: WeatherData): string {
	const { weathercode, is_day, temperature } = w;
	// temperature warmth factor: 0 (cold, <=5°C) to 1 (hot, >=35°C)
	const warmth = Math.min(1, Math.max(0, (temperature - 5) / 30));

	if (is_day) {
		if (weathercode <= 3) {
			// clear day: warm gold → amber → soft sky
			const r1 = Math.round(200 + warmth * 55);
			const g1 = Math.round(160 + warmth * 40);
			const b1 = Math.round(60 + (1 - warmth) * 80);
			return `linear-gradient(135deg, rgb(${r1}, ${g1}, ${b1}), rgb(180, 140, 80), rgb(100, 140, 180))`;
		}
		if (weathercode >= 45 && weathercode <= 48) {
			// fog: desaturated lavender → pale grey
			return 'linear-gradient(135deg, rgb(160, 155, 175), rgb(180, 178, 182), rgb(150, 150, 155))';
		}
		if ((weathercode >= 51 && weathercode <= 67) || (weathercode >= 80 && weathercode <= 82)) {
			// rain: steel blue → muted teal
			return 'linear-gradient(135deg, rgb(70, 100, 140), rgb(60, 110, 120), rgb(80, 95, 130))';
		}
		if ((weathercode >= 71 && weathercode <= 77) || (weathercode >= 85 && weathercode <= 86)) {
			// snow: silvery white → pale blue
			return 'linear-gradient(135deg, rgb(200, 210, 220), rgb(180, 195, 215), rgb(170, 185, 200))';
		}
		if (weathercode >= 95) {
			// storm: deep purple → charcoal
			return 'linear-gradient(135deg, rgb(80, 50, 100), rgb(60, 55, 75), rgb(50, 45, 60))';
		}
		// default cloudy day
		return 'linear-gradient(135deg, rgb(140, 150, 165), rgb(120, 130, 145), rgb(110, 115, 130))';
	}

	// night variants
	if (weathercode <= 3) {
		// clear night: deep indigo → dark navy
		return 'linear-gradient(135deg, rgb(20, 20, 60), rgb(15, 25, 50), rgb(10, 15, 40))';
	}
	if (weathercode >= 45 && weathercode <= 48) {
		// fog night: muted slate → charcoal
		return 'linear-gradient(135deg, rgb(50, 50, 60), rgb(40, 42, 50), rgb(35, 35, 42))';
	}
	if ((weathercode >= 51 && weathercode <= 67) || (weathercode >= 80 && weathercode <= 82)) {
		// rain night: near-black teal → dark blue
		return 'linear-gradient(135deg, rgb(15, 30, 40), rgb(20, 25, 45), rgb(12, 20, 35))';
	}
	if ((weathercode >= 71 && weathercode <= 77) || (weathercode >= 85 && weathercode <= 86)) {
		// snow night: cool silver → deep blue
		return 'linear-gradient(135deg, rgb(60, 65, 80), rgb(40, 50, 70), rgb(30, 35, 55))';
	}
	if (weathercode >= 95) {
		// storm night: dark indigo → near-black
		return 'linear-gradient(135deg, rgb(30, 15, 45), rgb(20, 18, 30), rgb(12, 10, 20))';
	}
	// default cloudy night
	return 'linear-gradient(135deg, rgb(35, 38, 48), rgb(28, 30, 40), rgb(22, 24, 32))';
}

class AmbientManager {
	enabled = $state(false);
	location = $state<AmbientLocation | null>(null);
	weather = $state<WeatherData | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);

	private fetchIntervalId: ReturnType<typeof window.setInterval> | null = null;
	private lastFetchTime = 0;
	private readonly STALE_MS = 30 * 60 * 1000; // 30 minutes

	get gradient(): string | null {
		if (!this.weather) return null;
		return computeGradient(this.weather);
	}

	get conditionLabel(): string | null {
		if (!this.weather) return null;
		const w = this.weather;
		const temp = Math.round(w.temperature);
		const condition = getConditionLabel(w.weathercode);
		const time = w.is_day ? 'day' : 'night';
		return `${temp}° · ${condition} · ${time}`;
	}

	initialize(): void {
		if (!browser) return;

		const stored = localStorage.getItem('ambient_enabled');
		if (stored !== '1') return;

		const locStr = localStorage.getItem('ambient_location');
		if (!locStr) return;

		try {
			this.location = JSON.parse(locStr);
		} catch {
			return;
		}

		this.enabled = true;
		this.fetchWeather();
		this.startRefreshCycle();
	}

	async enable(): Promise<void> {
		if (!browser) return;

		this.loading = true;
		this.error = null;

		try {
			const coords = await this.requestLocation();
			this.location = coords;
			localStorage.setItem('ambient_location', JSON.stringify(coords));
			localStorage.setItem('ambient_enabled', '1');
			this.enabled = true;
			await this.fetchWeather();
			this.startRefreshCycle();
		} catch (err) {
			this.error = err instanceof GeolocationPositionError
				? 'location access denied — ambient mode needs your location to read the sky'
				: 'could not determine location';
			this.enabled = false;
			localStorage.removeItem('ambient_enabled');
		} finally {
			this.loading = false;
		}
	}

	disable(): void {
		if (!browser) return;

		this.enabled = false;
		this.weather = null;
		this.error = null;
		localStorage.setItem('ambient_enabled', '0');

		if (this.fetchIntervalId !== null) {
			window.clearInterval(this.fetchIntervalId);
			this.fetchIntervalId = null;
		}

		document.body.classList.remove('ambient-active');
		document.documentElement.style.removeProperty('--ambient-gradient');
	}

	applyToDOM(): void {
		if (!browser || !this.enabled || !this.gradient) return;
		document.body.classList.add('ambient-active');
		document.documentElement.style.setProperty('--ambient-gradient', this.gradient);
	}

	clearFromDOM(): void {
		if (!browser) return;
		document.body.classList.remove('ambient-active');
		document.documentElement.style.removeProperty('--ambient-gradient');
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
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,is_day&timezone=auto`;
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
