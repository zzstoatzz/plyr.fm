import { Copy, Field } from '../controls';

export function TagsField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <>
    <Field label="Tags" value={value} onChangeText={onChange} multiline editable={!disabled} autoCapitalize="none" autoCorrect={false} />
    <Copy>one tag per line, up to 20. use ai for AI-generated music.</Copy>
  </>;
}
