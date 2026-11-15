import { useSyncExternalStore } from 'react';
import { createRadioFeeds, type RadioFeedState } from '@plyr/next-core/radio-feed';
import type { RadioStation } from '@plyr/next-core/radio';

const feeds = createRadioFeeds();
const idle: RadioFeedState = Object.freeze({ snapshot: undefined, error: '' });
const none = () => () => {};

export function useRadioFeed(station: RadioStation | null): RadioFeedState {
	const feed = station ? feeds.get(station.slug) : undefined;
	return useSyncExternalStore(feed?.subscribe ?? none, feed?.getSnapshot ?? (() => idle), feed?.getSnapshot ?? (() => idle));
}
