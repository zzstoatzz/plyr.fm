# toast notification system

## status

**IMPLEMENTED** - this feature is live in production

## overview

lightweight, zero-dependency toast notification system providing immediate user feedback for async operations (file uploads, network errors, etc.).

## use cases

the toast system provides UX feedback for:
- **uploads**: "uploading track... 45%" → "track uploaded successfully!"
- **upload errors**: detailed error messages with specific failure reasons
- **network errors**: "network error: connection failed"
- **processing updates**: real-time SSE progress updates during transcoding
- **general notifications**: success/error/info/warning messages throughout the app

## implementation

### state management

uses svelte 5 class with `$state` runes (consistent with `player.svelte.ts` and other state managers):

```typescript
// frontend/src/lib/toast.svelte.ts
class ToastState {
  toasts = $state<Toast[]>([]);

  add(message: string, type: ToastType = 'info', duration = 3000): string
  dismiss(id: string): void
  update(id: string, message: string, type?: ToastType): void
  success(message: string, duration = 3000): string
  error(message: string, duration = 5000): string
  info(message: string, duration = 3000): string
  warning(message: string, duration = 4000): string
}
export const toast = new ToastState();
```

### toast types and timing

- **success**: 3s auto-dismiss, ✓ icon, green accent
- **error**: 5s auto-dismiss, ✕ icon, red accent
- **info**: 3s auto-dismiss, ℹ icon, blue accent
- **warning**: 4s auto-dismiss, ⚠ icon, orange accent
- custom duration supported: `toast.add('message', 'info', 10000)`

### visual design

- dark background with glassmorphism (backdrop-filter blur)
- type-specific icon colors using CSS variables
- positioned bottom-left (above player on mobile)
- fade transitions (respects `prefers-reduced-motion`)

### positioning

**all devices**: bottom-left corner
- positioned above player footer using `calc(var(--player-height) + 1rem)`
- doesn't block main content
- stacks vertically with newest on top
- responsive padding adjustments for mobile

### accessibility

implemented features:
- `role="region"` + `aria-live="polite"` on container
- `role="alert"` on individual toasts
- `aria-hidden="true"` on decorative icons
- respects `prefers-reduced-motion` media query
- auto-dismiss ensures toasts don't linger indefinitely

## usage patterns

### simple notifications
```typescript
import { toast } from '$lib/toast.svelte';

toast.success('track uploaded');
toast.error('upload failed');
toast.info('processing...');
toast.warning('approaching rate limit');
```

### progress updates (uploader pattern)
```typescript
// initial upload progress
const toastId = toast.info('uploading track...');

// update progress inline
xhr.upload.addEventListener('progress', (e) => {
  const percent = Math.round((e.loaded / e.total) * 100);
  toast.update(toastId, `uploading track... ${percent}%`);
});

// processing updates via SSE
eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  if (update.status === 'processing') {
    toast.update(toastId, update.message);
  }
  if (update.status === 'completed') {
    toast.dismiss(toastId);
    toast.success('track uploaded successfully!');
  }
};
```

## styling

uses CSS custom properties from the global theme:
- `--accent`: info toast icon color
- `--success`: success toast icon color
- `--error`: error toast icon color
- `--warning`: warning toast icon color
- `--text-primary`: message text
- glassmorphism background with `backdrop-filter: blur(12px)`

## key features

- **in-place updates**: `toast.update(id, newMessage)` allows progress tracking without spawning multiple toasts
- **long-running tasks**: custom durations (e.g., 30s for uploads) prevent premature dismissal
- **zero dependencies**: custom implementation, no external libraries
- **type-safe**: full TypeScript support with exported types
- **consistent patterns**: matches other Svelte 5 rune-based state managers

### action links

toasts can include an optional action link:

```typescript
export interface ToastAction {
  label: string;
  href: string;
}

// usage
toast.success('track uploaded!', 3000, { label: 'view track', href: `/track/${trackId}` });
```

action links render as styled anchor tags. internal links stay in the same tab; external links open in new tabs.

## future enhancements

potential additions (not currently implemented):
- pause on hover to prevent auto-dismiss
- manual dismiss buttons
- progress bars for visual timing
- toast queue limiting to prevent spam
