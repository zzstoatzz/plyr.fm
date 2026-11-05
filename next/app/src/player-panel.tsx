import { createContext, useContext, type RefObject } from 'react';
import type { ViewInstance } from 'react-native';

export const PlayerPanelContext = createContext<{
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  trigger: RefObject<ViewInstance | null>;
}>({ expanded: false, setExpanded: () => {}, trigger: { current: null } });
export const usePlayerPanel = () => useContext(PlayerPanelContext);
