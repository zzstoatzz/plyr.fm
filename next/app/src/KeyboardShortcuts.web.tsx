import { router, usePathname, type Href } from 'expo-router';
import { useContext, useEffect, useRef } from 'react';
import { usePlayback } from './playback';
import { useAppPreferences } from './preference-context';
import { RadioContext } from './RadioPlayer';

export function KeyboardShortcuts({ origin }: { origin: string }) {
  const player = usePlayback();
  const radio = useContext(RadioContext);
  const preferences = useAppPreferences();
  const path = usePathname();
  const latest = useRef({ player, radio, preferences, path, origin });
  latest.current = { player, radio, preferences, path, origin };
  const unmuted = useRef(1);
  const queueOrigin = useRef('/');
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const { player, radio, preferences, path, origin } = latest.current;
      if (path !== '/now-playing' && [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length && !dialog.closest('[aria-hidden="true"]'))) return;
      const key = event.key.toLowerCase();
      const navigate = (href: '/settings' | '/queue') => path === '/now-playing' ? router.replace(href) : router.navigate(href);
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        if (key === 'k') {
          event.preventDefault();
          const href = { pathname: '/search' as const, params: { focus: Date.now().toString() } };
          if (path === '/now-playing') router.replace(href); else router.navigate(href);
        } else if (key === ',') { event.preventDefault(); navigate('/settings'); }
        return;
      }
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const trackControl = key === ' ' && player.current && target?.closest('[data-testid="track-play-control"]');
      if (!trackControl && (key === ' ' || key.startsWith('arrow')) && target?.closest('button,a,[role="button"],[role="slider"],[role="tab"],[role="combobox"]')) return;
      if (![' ', 'arrowleft', 'arrowright', 'j', 'l', 'q', 'm'].includes(key)) return;
      event.preventDefault();
      if (event.repeat && !key.startsWith('arrow')) return;
      if (key === ' ') { if (radio.station) radio.togglePlayback?.(); else player.toggle(); }
      else if (key === 'm') {
        const volume = preferences.preferences.volume;
        if (volume > 0) unmuted.current = volume;
        preferences.setPreferences({ volume: volume > 0 ? 0 : unmuted.current });
      } else if (key === 'q') {
        if (path === '/queue') router.replace(queueOrigin.current as Href);
        else { queueOrigin.current = path === '/now-playing' ? origin : path; navigate('/queue'); }
      } else if (!radio.station) {
        if (key === 'j') player.previous();
        else if (key === 'l') void player.next();
        else player.skip(key === 'arrowleft' ? -10 : 10);
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  return null;
}
