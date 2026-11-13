import { useSyncExternalStore } from 'react';
import { RadioFeed, type RadioFeedState } from './radio-feed';
import { radioStations, readRadio, type RadioStation } from './radio';

const feeds = new Map(radioStations.map(station => [station.slug, new RadioFeed(signal => readRadio(station, signal))]));
const idle: RadioFeedState = Object.freeze({ snapshot: undefined, error: '' });
const none = () => () => {};

export function useRadioFeed(station: RadioStation | null): RadioFeedState {
	const feed = station ? feeds.get(station.slug) : undefined;
	return useSyncExternalStore(feed?.subscribe ?? none, feed?.getSnapshot ?? (() => idle), feed?.getSnapshot ?? (() => idle));
}
