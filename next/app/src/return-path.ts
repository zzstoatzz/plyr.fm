import type { Href } from 'expo-router';
import { returnPath as sameSitePath } from '@plyr/next-core/return-path';

export function returnPath(value: unknown): Href | undefined {
	return sameSitePath(value) as Href | undefined;
}
