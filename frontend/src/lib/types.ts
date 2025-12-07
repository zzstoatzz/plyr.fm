export interface FeaturedArtist {
	did: string;
	handle: string;
	display_name: string;
	avatar_url?: string;
}

export interface AlbumSummary {
	id: string;
	title: string;
	slug: string;
	track_count: number;
	total_plays: number;
	image_url?: string;
}

export interface AlbumMetadata extends AlbumSummary {
	description?: string | null;
	artist: string;
	artist_handle: string;
}

export interface AlbumResponse {
	metadata: AlbumMetadata;
	tracks: Track[];
}

export interface Track {
	id: number;
	title: string;
	artist: string;
	album?: AlbumSummary | null;
	file_id: string;
	file_type: string;
	artist_handle: string;
	artist_avatar_url?: string;
	r2_url?: string;
	atproto_record_uri?: string;
	atproto_record_url?: string;
	play_count: number;
	like_count?: number;
	comment_count?: number;
	features?: FeaturedArtist[];
	tags?: string[];
	created_at?: string;
	image_url?: string;
	is_liked?: boolean;
	copyright_flagged?: boolean | null; // null = not scanned, false = clear, true = flagged
	copyright_match?: string | null; // "Title by Artist" of primary match
}

export interface User {
	did: string;
	handle: string;
}

export interface Artist {
	did: string;
	handle: string;
	display_name: string;
	avatar_url?: string;
	bio?: string;
}

export interface QueueState {
	track_ids: string[];
	current_index: number;
	current_track_id: string | null;
	shuffle: boolean;
	original_order_ids: string[];
	auto_advance?: boolean;
}

export interface QueueResponse {
	state: QueueState;
	revision: number;
	tracks: Track[];
}

export interface TopItem {
	id: number;
	title: string;
	play_count: number;
}

export interface Analytics {
	total_plays: number;
	total_items: number;
	top_item: TopItem | null;
	top_liked: TopItem | null;
}

export interface ArtistAlbumSummary extends AlbumSummary {}

export interface TokenInfo {
	session_id: string;
	name: string | null;
	created_at: string;
	expires_at: string | null;
}

