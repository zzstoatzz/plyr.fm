import { useSyncExternalStore } from 'react';
import { createRadioFeeds, type RadioFeedState } from '@plyr/next-core/radio-feed';
import type { RadioStation } from '@plyr/next-core/radio';
import { API_URL } from './config';

const feeds = createRadioFeeds(API_URL);
const idle: RadioFeedState = Object.freeze({ snapshot: undefined, error: '' });
const none = () => () => {};

export function useRadioFeed(station: RadioStation | null): RadioFeedState {
	const feed = station ? feeds.get(station.slug) : undefined;
	return useSyncExternalStore(feed?.subscribe ?? none, feed?.getSnapshot ?? (() => idle), feed?.getSnapshot ?? (() => idle));
}
