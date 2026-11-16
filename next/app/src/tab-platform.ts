import { Platform } from 'react-native';

export const usesLiquidTabs = Platform.OS === 'ios' && parseInt(Platform.Version, 10) >= 26;
