import { useSyncExternalStore } from 'react';
import { RadioFeed } from './radio-feed';
import { radioStations, readRadio, type RadioStation } from './radio';

const feeds = new Map(radioStations.map(station => [station.slug, new RadioFeed(signal => readRadio(station, signal))]));

export function useRadioFeed(station: RadioStation) {
	const feed = feeds.get(station.slug);
	if (!feed) throw new Error('Unknown radio station');
	return useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
}
