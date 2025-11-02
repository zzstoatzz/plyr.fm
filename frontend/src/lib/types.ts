export interface FeaturedArtist {
	did: string;
	handle: string;
	display_name: string;
	avatar_url?: string;
}

export interface Track {
	id: number;
	title: string;
	artist: string;
	album?: string;
	file_id: string;
	file_type: string;
	artist_handle: string;
	artist_avatar_url?: string;
	r2_url?: string;
	atproto_record_uri?: string;
	atproto_record_url?: string;
	play_count: number;
	features?: FeaturedArtist[];
	created_at?: string;
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
