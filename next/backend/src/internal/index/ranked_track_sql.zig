//! The multi-tag discovery listing, kept beside the composed store it shares joins with.

const composed = @import("postgres_composed_track_store.zig");
const track_tag_sql = @import("track_tag_sql.zig");

/// A multi-tag listing: tracks with any of the tags, those carrying more of them first, then
/// newest. Rows carry their tags so a client can show why each one is there. The cursor stays
/// (created_at, uri); its track's tag count is looked up again, and a track that is gone
/// counts as carrying every tag, so the next page repeats rows rather than skips them.
const tag_rank = track_tag_sql.hits("v.record_uri", "v.record_cid");
const ranked_order = "ORDER BY page.hits DESC, v.record_created_at_us DESC, v.record_uri DESC";
fn rankedQuery(comptime filter: []const u8, comptime limit: []const u8) []const u8 {
    return "WITH page AS MATERIALIZED (\nSELECT v.record_uri, " ++ tag_rank ++ " AS hits\n" ++ composed.page_from ++
        "\nWHERE v.record_created_at_us IS NOT NULL\n" ++ filter ++
        "\nORDER BY hits DESC, v.record_created_at_us DESC, v.record_uri DESC\nLIMIT " ++ limit ++ "\n)\nSELECT\n" ++
        composed.projected_columns ++ ",\n" ++ track_tag_sql.detail_tags ++
        "\nFROM page\nJOIN plyr_index.track_records AS v ON v.record_uri = page.record_uri\n" ++
        composed.projected_joins ++ "\n" ++ ranked_order;
}
const ranked_filter = composed.discovery_policy ++ track_tag_sql.filter ++ track_tag_sql.hidden_filter;
pub const query = rankedQuery(ranked_filter, "$6::bigint");
pub const after_query = rankedQuery(ranked_filter ++ "\n  AND (" ++ tag_rank ++ ", v.record_created_at_us, v.record_uri) < (" ++
    "COALESCE((SELECT " ++ track_tag_sql.hits("cursor_track.record_uri", "cursor_track.record_cid") ++
    " FROM plyr_index.track_records AS cursor_track WHERE cursor_track.record_uri = $7), cardinality($4::text[])), $6::bigint, $7)", "$8::bigint");
