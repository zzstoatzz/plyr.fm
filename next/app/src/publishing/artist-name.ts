import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Auth } from '../auth-state';

/** The name a new track is credited to: the account's profile name, else its handle. */
export function useArtistName(auth: Auth): string {
  const [profileName, setProfileName] = useState<string>();
  useEffect(() => {
    if (!auth.did) return;
    let live = true;
    api.artist(auth.did).then(profile => { if (live) setProfileName(profile.display_name || undefined); }, () => {});
    return () => { live = false; };
  }, [auth.did]);
  return profileName || auth.handle || auth.did || '';
}
