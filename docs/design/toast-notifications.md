# toast notification system

## overview

add a lightweight, zero-dependency toast notification system to provide immediate user feedback for async operations (file uploads, network errors, etc.).

## motivation

### immediate problem
users uploading large files (>10MB) experience 6+ second wait times with limited feedback:
- current: inline success/error messages only appear after completion
- current: button loading spinner is the only feedback during upload
- desired: immediate toast notification when upload starts, stays visible during 6+ second R2 upload

### broader use cases
toast system will improve UX across the app:
- **uploads**: "uploading [filename]..." → "track uploaded successfully"
- **playback errors**: "failed to load audio" (currently silent failures)
- **network errors**: "connection lost, retrying..."
- **optimistic updates**: "track deleted" with undo option
- **background operations**: "processing in background..."
- **rate limiting**: "slow down, too many requests"

## design decisions

### custom vs library

**decision**: custom implementation

**rationale**:
- zero dependencies (aligns with minimal deps goal)
- matches existing svelte 5 runes pattern (`player.svelte.ts`)
- ~2KB gzipped vs 8KB+ for libraries
- full control over styling (dark theme, monospace font)
- type-safe, consistent with codebase patterns

### state management

**pattern**: svelte 5 class with `$state` runes (matches `player.svelte.ts`)

```typescript
// lib/toast.svelte.ts
class ToastState {
  toasts = $state<Toast[]>([]);
  // ... methods
}
export const toast = new ToastState();
```

**rationale**:
- consistent with existing player state management
- reactive without stores/context complexity
- simple import/usage: `import { toast } from '$lib/toast.svelte'`
- automatic cleanup via class methods

### toast types

```typescript
type ToastType = 'success' | 'error' | 'info' | 'warning';
```

**auto-dismiss timing**:
- success: 3 seconds (quick confirmation)
- error: 5 seconds (user needs time to read)
- info: 3 seconds (standard message)
- warning: 4 seconds (slightly longer for caution)
- custom duration: `toast.add('message', 'info', 10000)` for flexibility

**visual distinction**:
- left border color matching type
- icon per type (✓ ✕ ℹ ⚠)
- consistent dark theme styling

### positioning

**desktop**: top-right corner
- standard position for non-critical notifications
- doesn't block main content
- natural eye-flow direction

**mobile**: top-center (below header)
- better visibility on narrow screens
- avoids gesture conflict zones (edges)
- respects header nav

**stacking**: newest on top, existing toasts slide down

### accessibility

**requirements**:
- `role="region"` + `aria-live="polite"` on container
- `role="alert"` on individual toasts
- `aria-label="close notification"` on dismiss buttons
- keyboard support: Escape to dismiss focused toast
- respect `prefers-reduced-motion`

**implementation**:
```svelte
<div class="toast-container" role="region" aria-live="polite" aria-label="notifications">
  {#each toast.toasts as item (item.id)}
    <div class="toast" role="alert" transition:fly={{ y: -20, duration: 300 }}>
      <!-- content -->
    </div>
  {/each}
</div>
```

## implementation plan

### 1. core state (`lib/toast.svelte.ts`)

```typescript
interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  dismissible?: boolean;
}

class ToastState {
  toasts = $state<Toast[]>([]);

  add(message: string, type: ToastType, duration = 3000): string
  dismiss(id: string): void
  success(message: string): string
  error(message: string): string
  info(message: string): string
  warning(message: string): string
}
```

### 2. component (`lib/components/Toast.svelte`)

features:
- render toasts from global state
- fly-in animation (respects reduced motion)
- auto-dismiss with timeout
- manual dismiss button
- type-based styling (border color, icon)

### 3. integration (`routes/+layout.svelte`)

```svelte
<script>
  import Toast from '$lib/components/Toast.svelte';
  import Player from '$lib/components/Player.svelte';
</script>

{@render children?.()}
<Player />
<Toast /> <!-- global toast container -->
```

### 4. usage patterns

#### simple notifications
```typescript
import { toast } from '$lib/toast.svelte';

toast.success('track uploaded');
toast.error('upload failed');
```

#### upload feedback (portal/+page.svelte)
```typescript
async function handleUpload(e: SubmitEvent) {
  // ...

  uploading = true;
  const toastId = toast.info(`uploading ${file.name}...`);

  try {
    const response = await fetch(/* ... */);
    if (response.ok) {
      toast.dismiss(toastId);
      toast.success('track uploaded successfully');
      // ...
    }
  } catch (e) {
    toast.dismiss(toastId);
    toast.error(`upload failed: ${e.message}`);
  } finally {
    uploading = false;
  }
}
```

#### error boundaries
```typescript
// future: global error handler
window.addEventListener('unhandledrejection', (event) => {
  toast.error('unexpected error occurred');
});
```

## css variables

use existing theme variables:
```css
.toast {
  background: #1a1a1a; /* --bg-secondary */
  border: 1px solid #2a2a2a; /* --border-default */
  color: white; /* --text-primary */
}

.toast-success { border-left-color: #5ce87b; } /* --success */
.toast-error { border-left-color: #ff6b6b; } /* --error */
.toast-info { border-left-color: #3a7dff; } /* --accent */
.toast-warning { border-left-color: #ffa500; } /* --warning */
```

note: may need to define CSS custom properties in global styles if not already present.

## advanced features (future)

not implementing initially, but design supports:
- **pause on hover**: stop auto-dismiss when user hovers
- **progress bar**: visual timer of remaining duration
- **action buttons**: "undo" for optimistic updates
- **queue limit**: max 3-5 visible toasts, queue overflow
- **persistent toasts**: store critical unread toasts in localStorage

## testing strategy

### manual testing
1. large file upload (>10MB) - verify toast appears immediately
2. network error simulation - verify error toast
3. mobile viewport - verify positioning below header
4. keyboard navigation - verify Escape dismisses
5. reduced motion - verify animations respect preference

### unit tests (future)
```typescript
// tests/lib/toast.test.ts
import { toast } from '$lib/toast.svelte';

test('adds toast and auto-dismisses', async () => {
  const id = toast.success('test');
  expect(toast.toasts).toHaveLength(1);

  await new Promise(r => setTimeout(r, 3100));
  expect(toast.toasts).toHaveLength(0);
});
```

### integration tests (future)
- verify toast appears on upload start
- verify toast updates on upload completion
- verify error toast on network failure

## rollout plan

1. **implement core system**
   - create `lib/toast.svelte.ts`
   - create `lib/components/Toast.svelte`
   - add to `routes/+layout.svelte`

2. **integrate with uploads**
   - update `portal/+page.svelte` handleUpload
   - add large file warning (>10MB)
   - show progress toast during upload

3. **test locally**
   - upload various file sizes
   - test mobile viewport
   - verify accessibility

4. **incremental adoption**
   - start with uploads (immediate need)
   - gradually replace inline messages elsewhere
   - add to error boundaries

5. **monitor in production**
   - watch for toast spam (multiple rapid toasts)
   - gather user feedback on timing/positioning
   - adjust auto-dismiss durations if needed

## success metrics

- users get immediate feedback on upload start (0ms vs current 6000ms delay)
- reduced confusion during long uploads
- consistent notification pattern across app
- zero external dependencies
- accessible to screen readers and keyboard users

## open questions

1. **CSS variables**: do we need to define `--success`, `--error`, `--warning` in global styles?
   - current code has inline hex colors
   - prefer CSS vars for consistency
   - check `frontend/src/app.css` or global styles

2. **max concurrent toasts**: should we limit to 3-5 visible toasts?
   - prevents notification spam
   - can implement later if needed

3. **icon style**: text symbols (✓ ✕) or SVG icons?
   - text is simpler, zero deps
   - SVG would be more polished
   - recommend text initially, can upgrade later

4. **animation library**: use svelte/transition or custom CSS?
   - svelte/transition is built-in, zero deps
   - provides `fly`, `fade`, `scale` out of box
   - respects `prefers-reduced-motion` automatically
   - recommend `svelte/transition`
