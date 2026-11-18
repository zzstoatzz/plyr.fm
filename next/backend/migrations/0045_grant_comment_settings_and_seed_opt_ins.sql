-- Timed comments are off unless the artist opts in (prod's allow_comments,
-- default false). The setting lives with the account's other settings in
-- plyr_account.preferences, written by the Jam coordinator; the API only
-- reads it to decide whether a track shows and invites comments.

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_account TO plyr_zig_canary;
        GRANT SELECT ON plyr_account.preferences TO plyr_zig_canary;
    END IF;
END
$grants$;

-- Artists who had turned comments on in prod as of 2026-11-18 (read from
-- prod's public comments endpoint, one track per artist). Prod's setting is not
-- a record, so a replay cannot bring it back; this carries it over once and
-- never overrides a choice already made on next.
INSERT INTO plyr_account.preferences (owner_did, value)
SELECT did, '{"allowComments": true}'::jsonb
FROM unnest(ARRAY[
    'did:plc:4kzir5a5i7ihw2pfkdqdlloz',
    'did:plc:5mytd3a2edhiy2653zmiti6x',
    'did:plc:dcc2pvqrzildaqmme6lnaf4i',
    'did:plc:e5c2dgv4buuzvzcuwflnclyn',
    'did:plc:fip3nyk6tjo3senpq4ei2cxw',
    'did:plc:hsqwcidfez66lwm3gxhfv5in',
    'did:plc:irs2tcoeuvuwj3m4yampbuco',
    'did:plc:is5qpjqmogkpaejhm57fr3xm',
    'did:plc:jiak3t3q3hnj2o6xbqr3ei76',
    'did:plc:l37td5yhxl2irrzrgvei4qay',
    'did:plc:lhsgcwmucs4xqlhbz72kv7pv',
    'did:plc:mvye2uys3c2ly3vmsgxsfou7',
    'did:plc:n2romueix7j5qqlc6n4263qv',
    'did:plc:ohgsqpfsbocaaxusxqlgfvd7',
    'did:plc:qk32jywgqrtfmmrxqzjogd4l',
    'did:plc:rqbqpaaluty5v47jwciowpik',
    'did:plc:s2rczyxit2v5vzedxqs326ri',
    'did:plc:so3ysj7gypel6w7mixdfjhkh',
    'did:plc:stznz7qsokto2345qtdzogjb',
    'did:plc:v46ojbiop5ebs5h7gaomixcc',
    'did:plc:w7x22x56pgtta23uulbcahbo',
    'did:plc:xbtmt2zjwlrfegqvch7fboei',
    'did:plc:ygja2cua5eieiepwctxyopcx',
    'did:plc:zqngs5cvyewmfzifevacxunk'
]) AS did
ON CONFLICT (owner_did) DO UPDATE SET
    value = plyr_account.preferences.value || EXCLUDED.value,
    updated_at = clock_timestamp()
WHERE NOT (plyr_account.preferences.value ? 'allowComments');
