# design tokens

CSS custom properties defined in `frontend/src/routes/+layout.svelte`. Use these instead of hardcoding values.

## border radius

```css
--radius-sm: 4px;    /* tight corners (inputs, small elements) */
--radius-base: 6px;  /* default for most elements */
--radius-md: 8px;    /* cards, modals */
--radius-lg: 12px;   /* larger containers */
--radius-xl: 16px;   /* prominent elements */
--radius-2xl: 24px;  /* hero elements */
--radius-full: 9999px; /* pills, circles */
```

## typography

```css
/* scale */
--text-xs: 0.75rem;   /* 12px - hints, captions */
--text-sm: 0.85rem;   /* 13.6px - labels, secondary */
--text-base: 0.9rem;  /* 14.4px - body default */
--text-lg: 1rem;      /* 16px - body emphasized */
--text-xl: 1.1rem;    /* 17.6px - subheadings */
--text-2xl: 1.25rem;  /* 20px - section headings */
--text-3xl: 1.5rem;   /* 24px - page headings */

/* semantic aliases */
--text-page-heading: var(--text-3xl);
--text-section-heading: 1.2rem;
--text-body: var(--text-lg);
--text-small: var(--text-base);
```

## colors

### accent

```css
--accent: #6a9fff;       /* primary brand color (user-customizable) */
--accent-hover: #8ab3ff; /* hover state */
--accent-muted: #4a7ddd; /* subdued variant */
--accent-rgb: 106, 159, 255; /* for rgba() usage */
```

### backgrounds

```css
/* dark theme */
--bg-primary: #0a0a0a;   /* main background */
--bg-secondary: #141414; /* elevated surfaces */
--bg-tertiary: #1a1a1a;  /* cards, modals */
--bg-hover: #1f1f1f;     /* hover states */

/* light theme overrides these automatically */
```

### borders

```css
--border-subtle: #282828;   /* barely visible */
--border-default: #333333;  /* standard borders */
--border-emphasis: #444444; /* highlighted borders */
```

### text

```css
--text-primary;   /* high contrast */
--text-secondary; /* medium contrast */
--text-tertiary;  /* low contrast */
--text-muted;     /* very low contrast */
```

### semantic

```css
--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
```

## usage

```svelte
<style>
  .card {
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-default);
  }

  .label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  input:focus {
    border-color: var(--accent);
  }
</style>
```

## anti-patterns

```css
/* bad - hardcoded values */
border-radius: 8px;
font-size: 14px;
background: #1a1a1a;

/* good - use tokens */
border-radius: var(--radius-md);
font-size: var(--text-base);
background: var(--bg-tertiary);
```
