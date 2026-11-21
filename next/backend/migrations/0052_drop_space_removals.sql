-- Drop the artists' private removal lists from 0051. Access to a gated space
-- must follow from public data alone: the artist's policy records, the
-- attested payments both sides hold, and plyr's public moderation. A list only
-- plyr could see, able to override a purchase, tied the music to plyr. The
-- track index from 0051 stays: the takedown check uses it.

DROP TABLE IF EXISTS plyr_account.space_removals;
