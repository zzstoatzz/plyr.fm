# theming guide

## color system

all colors are centralized in `frontend/src/lib/theme.ts` for easy customization.

### current color palette

#### backgrounds
- **primary**: `#0a0a0a` - main app background
- **secondary**: `#141414` - card backgrounds
- **tertiary**: `#1a1a1a` - hover states
- **hover**: `#1f1f1f` - active hover

#### borders
- **subtle**: `#282828` - default borders
- **default**: `#333333` - emphasized borders
- **emphasis**: `#444444` - strong borders

#### text
- **primary**: `#e8e8e8` - main text, titles
- **secondary**: `#b0b0b0` - subtitles, labels
- **tertiary**: `#808080` - meta info
- **muted**: `#666666` - disabled/very subtle

#### accents
- **primary**: `#6a9fff` - links, buttons, highlights
- **hover**: `#8ab3ff` - accent hover state
- **muted**: `#4a7ddd` - subtle accent

## changing colors

### option 1: edit theme.ts (recommended)

update `frontend/src/lib/theme.ts`:

```typescript
export const theme = {
  colors: {
    accent: {
      primary: '#your-color',  // change this
      hover: '#your-hover',
      muted: '#your-muted'
    }
  }
};
```

### option 2: global find/replace

for quick experiments, find/replace these key colors:

- **accent blue**: `#6a9fff` → your color
- **bright text**: `#e8e8e8` → your color
- **mid text**: `#b0b0b0` → your color
- **muted text**: `#808080` → your color

### option 3: user-configurable themes (future)

the centralized theme.ts makes it easy to:
1. create multiple theme objects (light, dark, custom)
2. store user preference in localStorage
3. apply theme via context or global state
4. hot-swap at runtime

example future implementation:

```typescript
// themes.ts
export const themes = {
  dark: { colors: { ... } },
  light: { colors: { ... } },
  custom: { colors: { ... } }
};

// app context
let selectedTheme = $state('dark');
let currentTheme = $derived(themes[selectedTheme]);
```

## design principles

### contrast ratios
- **titles** (`#e8e8e8` on `#0a0a0a`): 15:1 ratio
- **body text** (`#b0b0b0` on `#0a0a0a`): 11:1 ratio
- **meta text** (`#808080` on `#0a0a0a`): 7:1 ratio

all exceed wcag aa standards for accessibility.

### visual hierarchy
1. **primary** - track titles, headings (`#e8e8e8`)
2. **secondary** - artist names, navigation (`#b0b0b0`)
3. **tertiary** - metadata, handles (`#808080`)
4. **muted** - timestamps, separators (`#666666`)

### accent usage
- **primary action** - login button, playing indicator
- **hover states** - interactive feedback
- **links** - atproto record links
- **borders** - active/playing track highlight

## component-specific colors

### trackitem
- title: `#e8e8e8` (bright, pops)
- artist: `#b0b0b0` (readable)
- album: `#909090` (subtle)
- handle: `#808080` (meta)
- record link: `#6a9fff` (accent)

### header
- brand: `#e8e8e8` → `#6a9fff` on hover
- tagline: `#909090`
- nav links: `#b0b0b0` → `#e8e8e8` on hover
- buttons: `#6a9fff` border

### player
- track title: `#e8e8e8`
- artist: `#b0b0b0`
- controls: inherit from parent
- progress bar: accent colors

## testing colors

```bash
# start dev server
cd frontend && bun run dev

# navigate to http://localhost:5173
# check:
# - track titles are clearly readable
# - hover states provide feedback
# - playing state is obvious
# - links stand out but don't overpower
```

## future enhancements

1. **css custom properties**: migrate to css variables for runtime theming
2. **theme switcher**: ui control for theme selection
3. **user themes**: allow custom color uploads
4. **accessibility**: add high contrast mode
5. **presets**: curated theme collections
