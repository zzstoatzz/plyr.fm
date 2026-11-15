CREATE TABLE plyr_index.legacy_album_covers (
    record_uri TEXT PRIMARY KEY,
    cover_url TEXT NOT NULL,
    CONSTRAINT ck_legacy_album_cover_record CHECK (
        record_uri ~ '^at://did:[^/]+/[^/]+/[^/]+$'
    ),
    CONSTRAINT ck_legacy_album_cover_url CHECK (
        cover_url ~ '^https://(images[.]plyr[.]fm(/images)?|pub-308b393655d9474fa790a0ff4200a3ca[.]r2[.]dev)/[A-Za-z0-9_-]+[.](jpe?g|png|webp|gif)$'
    )
);
