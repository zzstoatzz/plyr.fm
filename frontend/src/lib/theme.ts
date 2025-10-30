export const theme = {
	colors: {
		// backgrounds
		bg: {
			primary: '#0a0a0a',
			secondary: '#141414',
			tertiary: '#1a1a1a',
			hover: '#1f1f1f'
		},
		// borders
		border: {
			subtle: '#282828',
			default: '#333333',
			emphasis: '#444444'
		},
		// text
		text: {
			primary: '#e8e8e8',
			secondary: '#b0b0b0',
			tertiary: '#808080',
			muted: '#666666'
		},
		// accents
		accent: {
			primary: '#6a9fff',
			hover: '#8ab3ff',
			muted: '#4a7ddd'
		},
		// semantic
		success: '#4ade80',
		warning: '#fbbf24',
		error: '#ef4444'
	},
	spacing: {
		xs: '0.25rem',
		sm: '0.5rem',
		md: '1rem',
		lg: '1.5rem',
		xl: '2rem'
	},
	radius: {
		sm: '4px',
		md: '6px',
		lg: '8px'
	}
};

export type Theme = typeof theme;
