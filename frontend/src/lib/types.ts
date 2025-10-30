export interface Track {
	id: number;
	title: string;
	artist: string;
	album?: string;
	file_id: string;
	file_type: string;
	artist_handle: string;
	r2_url?: string;
	atproto_record_uri?: string;
}

export interface User {
	did: string;
	handle: string;
}
