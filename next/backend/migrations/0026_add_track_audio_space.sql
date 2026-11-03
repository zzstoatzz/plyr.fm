-- Gated audio: the space record (on the artist's own PDS) that holds the
-- audio blob, from the authored track's `audioSpace`. Listeners read it from
-- the PDS with a space credential; the appview never holds the audio.
ALTER TABLE plyr_index.track_records ADD COLUMN audio_space TEXT;
