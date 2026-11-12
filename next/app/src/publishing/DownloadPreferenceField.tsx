import { View } from 'react-native';
import { Action, Copy } from '../controls';
import type { DownloadPreference } from './track-download-policy';

export function DownloadPreferenceField({ value, onChange, disabled }: { value?: DownloadPreference; onChange: (value: DownloadPreference) => void; disabled: boolean }) {
  return <View style={{ gap: 8 }}>
    <Copy>downloads</Copy>
    {value === undefined ? <Copy>these download settings stay unchanged. manage protected or other download settings in the current app.</Copy> : <>
      <Action label="Downloads allowed" selected={value === 'open'} disabled={disabled} onPress={() => onChange('open')} />
      <Action label="Allowed, with a support prompt" selected={value === 'ask'} disabled={disabled} onPress={() => onChange('ask')} />
      <Action label="Downloads off" selected={value === 'off'} disabled={disabled} onPress={() => onChange('off')} />
      <Copy>changes downloads in plyr. previously public files and saved copies stay available.</Copy>
    </>}
  </View>;
}
