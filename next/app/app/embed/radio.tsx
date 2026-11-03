import { useEffect } from 'react';
import { Platform } from 'react-native';
import Radio from '../radio';

export default function RadioEmbed() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = 'html, body, #root { background: transparent !important; }';
    document.head.append(style);
    return () => style.remove();
  }, []);

  return <Radio compact />;
}
