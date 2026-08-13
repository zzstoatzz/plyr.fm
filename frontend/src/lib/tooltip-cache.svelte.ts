/**
 * Simple in-memory cache for tooltip data (likers, commenters).
 * - Lazy: only fetched on hover
 * - Cached: subsequent hovers use cached data
 * - Invalidatable: cache entries can be cleared when data changes
 */

import type { TrackId } from './types';

interface CacheEntry<T> {
	data: T;
	timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// separate caches for different data types
const likersCache = new Map<TrackId, CacheEntry<LikerData[]>>();
const commentersCache = new Map<TrackId, CacheEntry<CommenterData[]>>();

export interface LikerData {
	did: string;
	handle: string;
	display_name: string | null;
	avatar_url: string | null;
	liked_at: string;
}

export interface CommenterData {
	did: string;
	handle: string;
	display_name: string | null;
	avatar_url: string | null;
}

function isExpired(entry: CacheEntry<unknown>): boolean {
	return Date.now() - entry.timestamp > CACHE_TTL_MS;
}

// likers cache
export function getLikers(trackId: TrackId): LikerData[] | null {
	const entry = likersCache.get(trackId);
	if (!entry || isExpired(entry)) {
		return null;
	}
	return entry.data;
}

export function setLikers(trackId: TrackId, data: LikerData[]): void {
	likersCache.set(trackId, { data, timestamp: Date.now() });
}

export function invalidateLikers(trackId: TrackId): void {
	likersCache.delete(trackId);
}

// commenters cache
export function getCommenters(trackId: TrackId): CommenterData[] | null {
	const entry = commentersCache.get(trackId);
	if (!entry || isExpired(entry)) {
		return null;
	}
	return entry.data;
}

export function setCommenters(trackId: TrackId, data: CommenterData[]): void {
	commentersCache.set(trackId, { data, timestamp: Date.now() });
}

export function invalidateCommenters(trackId: TrackId): void {
	commentersCache.delete(trackId);
}
