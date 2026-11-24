-- Quotas: how much of a metered resource an account may spend per window, and
-- how much everyone together may. One place answers "may this account do this
-- now?" for every process (the api's report limit, the Osprey worker's
-- fingerprint scans), so limits, tiers and, later, paid plans live here
-- instead of in each caller.
--
-- Callers only use the functions below (SECURITY DEFINER); none of them reads
-- or writes the tables directly. Like the moderation log, none of this can be
-- rebuilt from the network.

CREATE SCHEMA IF NOT EXISTS plyr_quota;

-- what can be spent: per window_seconds (fixed windows from the epoch), with
-- an optional ceiling across all accounts together
CREATE TABLE IF NOT EXISTS plyr_quota.meters (
    meter TEXT PRIMARY KEY CHECK (meter ~ '^[a-z][a-z0-9_]{0,63}$'),
    window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
    global_limit BIGINT CHECK (global_limit >= 0),
    description TEXT NOT NULL
);

-- how much one account gets per window on each tier; a NULL amount means no
-- per-account limit (the global ceiling still applies). A meter with no row
-- for a tier allows nothing on that tier.
CREATE TABLE IF NOT EXISTS plyr_quota.allowances (
    tier TEXT NOT NULL CHECK (tier ~ '^[a-z][a-z0-9_]{0,31}$'),
    meter TEXT NOT NULL REFERENCES plyr_quota.meters (meter),
    amount BIGINT CHECK (amount >= 0),
    PRIMARY KEY (tier, meter)
);

-- an account's tier when it is set rather than earned: an operator's grant
-- now, a paid plan later
CREATE TABLE IF NOT EXISTS plyr_quota.account_tiers (
    subject TEXT PRIMARY KEY CHECK (subject LIKE 'did:%' AND length(subject) <= 512),
    tier TEXT NOT NULL CHECK (tier ~ '^[a-z][a-z0-9_]{0,31}$'),
    source TEXT NOT NULL CHECK (source IN ('operator', 'plan')),
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- how an account's metered work has turned out (a scan that found nothing is
-- clean); an account earns the 'established' tier with enough clean outcomes
-- and none flagged
CREATE TABLE IF NOT EXISTS plyr_quota.standing (
    subject TEXT PRIMARY KEY CHECK (length(subject) BETWEEN 1 AND 512),
    clean BIGINT NOT NULL DEFAULT 0 CHECK (clean >= 0),
    flagged BIGINT NOT NULL DEFAULT 0 CHECK (flagged >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- spend per subject per window; subject '*' is everyone together
CREATE TABLE IF NOT EXISTS plyr_quota.usage (
    meter TEXT NOT NULL REFERENCES plyr_quota.meters (meter),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
    window_start_us BIGINT NOT NULL CHECK (window_start_us >= 0),
    used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0),
    PRIMARY KEY (meter, subject, window_start_us)
);

CREATE INDEX IF NOT EXISTS usage_window_idx ON plyr_quota.usage (window_start_us);

INSERT INTO plyr_quota.meters (meter, window_seconds, global_limit, description) VALUES
    ('scan_seconds', 86400, 108000, 'seconds of audio fingerprinted, per day'),
    ('reports', 3600, NULL, 'moderation reports sent, per hour')
ON CONFLICT (meter) DO NOTHING;

INSERT INTO plyr_quota.allowances (tier, meter, amount) VALUES
    ('new', 'scan_seconds', 3600),
    ('established', 'scan_seconds', 21600),
    ('unmetered', 'scan_seconds', NULL),
    ('new', 'reports', 30),
    ('established', 'reports', 30),
    ('unmetered', 'reports', NULL)
ON CONFLICT (tier, meter) DO NOTHING;

CREATE OR REPLACE FUNCTION plyr_quota.tier_of(p_subject TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(
        (SELECT tier FROM plyr_quota.account_tiers WHERE subject = p_subject),
        (SELECT 'established' FROM plyr_quota.standing
         WHERE subject = p_subject AND clean >= 5 AND flagged = 0),
        'new')
$$;

-- when the current window of a meter ends (when a denied spend can try again)
CREATE OR REPLACE FUNCTION plyr_quota.window_end_us(p_meter TEXT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT (floor(extract(epoch FROM clock_timestamp()) / window_seconds) + 1)::bigint * window_seconds * 1000000
    FROM plyr_quota.meters WHERE meter = p_meter
$$;

-- Spend p_amount of p_meter for p_subject in the current window, or nothing.
-- Granted when the subject's allowance and the meter's global ceiling both
-- have room. One item larger than the subject's whole allowance is granted
-- when it is the subject's first spend in the window, so a long file waits a
-- window instead of forever. Runs in the caller's transaction: a rollback
-- returns the spend.
CREATE OR REPLACE FUNCTION plyr_quota.spend(p_meter TEXT, p_subject TEXT, p_amount BIGINT)
RETURNS TABLE (granted BOOLEAN, tier TEXT, used BIGINT, allowance BIGINT, retry_at_us BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
    m plyr_quota.meters%ROWTYPE;
    v_tier TEXT;
    v_allowance BIGINT;
    v_allowed BOOLEAN;
    v_window BIGINT;
    v_used BIGINT;
    v_global BIGINT;
BEGIN
    IF p_amount < 0 OR p_subject = '*' THEN
        RAISE EXCEPTION 'quota: bad spend' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO m FROM plyr_quota.meters WHERE meter = p_meter;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quota: unknown meter %', p_meter USING ERRCODE = '22023';
    END IF;
    v_tier := plyr_quota.tier_of(p_subject);
    SELECT a.amount, true INTO v_allowance, v_allowed
    FROM plyr_quota.allowances a WHERE a.tier = v_tier AND a.meter = p_meter;
    v_allowed := coalesce(v_allowed, false);
    IF NOT v_allowed THEN
        v_allowance := 0;
    END IF;
    v_window := floor(extract(epoch FROM clock_timestamp()) / m.window_seconds)::bigint * m.window_seconds * 1000000;
    retry_at_us := v_window + m.window_seconds::bigint * 1000000;

    -- the global row first, then the subject's, always in that order
    INSERT INTO plyr_quota.usage AS u (meter, subject, window_start_us) VALUES (p_meter, '*', v_window)
    ON CONFLICT (meter, subject, window_start_us) DO UPDATE SET used = u.used
    RETURNING u.used INTO v_global;
    INSERT INTO plyr_quota.usage AS u (meter, subject, window_start_us) VALUES (p_meter, p_subject, v_window)
    ON CONFLICT (meter, subject, window_start_us) DO UPDATE SET used = u.used
    RETURNING u.used INTO v_used;

    tier := v_tier;
    allowance := CASE WHEN v_allowed THEN v_allowance ELSE 0 END;
    granted := (m.global_limit IS NULL OR v_global + p_amount <= m.global_limit)
        AND (v_allowed AND (v_allowance IS NULL OR v_used + p_amount <= v_allowance OR v_used = 0));
    IF granted THEN
        UPDATE plyr_quota.usage SET used = used + p_amount
        WHERE meter = p_meter AND window_start_us = v_window AND subject IN ('*', p_subject);
        v_used := v_used + p_amount;
    END IF;
    used := v_used;
    RETURN NEXT;
END
$$;

-- give back a spend (the work it paid for failed before it cost anything),
-- from the window it was spent in: p_window_end_us is the retry_at_us that
-- spend returned
CREATE OR REPLACE FUNCTION plyr_quota.release(p_meter TEXT, p_subject TEXT, p_amount BIGINT, p_window_end_us BIGINT)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE plyr_quota.usage u SET used = greatest(u.used - p_amount, 0)
    FROM plyr_quota.meters m
    WHERE m.meter = p_meter AND u.meter = p_meter AND u.subject IN ('*', p_subject) AND p_amount > 0
      AND u.window_start_us = p_window_end_us - m.window_seconds::bigint * 1000000
$$;

-- record how a subject's metered work turned out
CREATE OR REPLACE FUNCTION plyr_quota.record_outcome(p_subject TEXT, p_clean BOOLEAN) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    INSERT INTO plyr_quota.standing AS s (subject, clean, flagged)
    VALUES (p_subject, CASE WHEN p_clean THEN 1 ELSE 0 END, CASE WHEN p_clean THEN 0 ELSE 1 END)
    ON CONFLICT (subject) DO UPDATE SET
        clean = s.clean + EXCLUDED.clean, flagged = s.flagged + EXCLUDED.flagged, updated_at = clock_timestamp()
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA plyr_quota FROM PUBLIC;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_quota TO plyr_zig_canary;
        GRANT EXECUTE ON FUNCTION plyr_quota.spend(TEXT, TEXT, BIGINT), plyr_quota.tier_of(TEXT)
            TO plyr_zig_canary;
    END IF;
END
$grants$;
