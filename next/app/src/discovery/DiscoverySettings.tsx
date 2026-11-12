import { useState } from 'react';
import { View } from 'react-native';
import Compass from 'lucide-react-native/icons/compass';
import { Action, Copy, Field, row } from '../controls';
import { DEFAULT_HIDDEN_TAGS, hiddenTags } from './preferences';
import { useAppPreferences } from '../preference-context';
import { SettingsRow, SettingsSection } from '../SettingsPieces';
import { Sheet } from '../Sheet';

export function DiscoverySettings() {
  const { preferences, setPreferences } = useAppPreferences();
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  function save(tags: string[]) {
    setPreferences({ hiddenTags: tags });
    setDraft(undefined);
    setError(undefined);
  }
  return <>
    <SettingsSection title="discovery" icon={Compass}>
      <SettingsRow label="hidden tags" value={preferences.hiddenTags.join(', ') || 'none'}
        detail="keep these tags out of latest tracks. artist pages and search still show them."
        onPress={() => { setDraft(preferences.hiddenTags.join(', ')); setError(undefined); }} />
    </SettingsSection>
    {draft !== undefined && <Sheet title="hidden tags" close={() => setDraft(undefined)}>
      <Copy>hide tracks with these tags from latest tracks. hiding ai also includes accounts labeled for AI-generated audio by plyr.fm.</Copy>
      <Field label="Tags, separated by commas" value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} multiline />
      {error && <Copy live>{error}</Copy>}
      <View style={row}>
        <Action primary label="Save hidden tags" onPress={() => {
          const tags = hiddenTags(draft.split(',').filter(tag => tag.trim()));
          if (!tags) setError('use up to 10 tags, each no longer than 200 bytes.');
          else save(tags);
        }} />
        <Action label="Show all tags" onPress={() => save([])} />
        <Action label="Restore defaults" onPress={() => save([...DEFAULT_HIDDEN_TAGS])} />
      </View>
    </Sheet>}
  </>;
}
