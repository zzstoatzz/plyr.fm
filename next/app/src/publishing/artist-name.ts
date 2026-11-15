import { useEffect, useState } from 'react';
import { api } from '../api-client';
import type { Auth } from '../auth-state';
import { creditName } from '@plyr/next-core/publishing/credit-name';

/** The name a new track is credited to: the account's profile name, else its handle. A name made of blank characters counts as no name. */
export function useArtistName(auth: Auth): string {
  const [profileName, setProfileName] = useState<string>();
  useEffect(() => {
    if (!auth.did) return;
    let live = true;
    api.artist(auth.did).then(profile => { if (live) setProfileName(creditName(profile.display_name)); }, () => {});
    return () => { live = false; };
  }, [auth.did]);
  return profileName || auth.handle || auth.did || '';
}
