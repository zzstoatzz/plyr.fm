import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { parsePrice, priceText } from '@plyr/next-core/access/policy';
import { normalizeLink, offerLabel, readSelling, sellableReleases, storeName, withBuyLink, type Release, type SellingSettings, type StoredOffer } from '@plyr/next-core/selling';
import { api } from '../api-client';
import { useAuth } from '../auth';
import { getAuth } from '../auth-state';
import { useAppearance } from '../appearance';
import { Choice } from '../AccountPieces';
import { Action, Copy, Field, row } from '../controls';
import { CaretDown, CaretUp } from '../icons';
import { accountSettings } from '../preference-sync';
import { Text } from '../Text';
import { toast } from '../toast';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

/** portal: where listeners can support you and buy each release. plyr links out, never takes the payment. */
export function SellCard({ did }: { did: string }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<SellingSettings>();
  const [releases, setReleases] = useState<Release[]>();
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState('');
  const [supportError, setSupportError] = useState('');
  const [editing, setEditing] = useState<string>();
  const controller = useRef<AbortController>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const call = useCallback(() => {
    const current = getAuth();
    if (!current.agent || !current.accountSync) throw new Error('reconnect to change how you sell your music.');
    controller.current ??= new AbortController();
    return accountSettings(current.agent, controller.current.signal);
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [value, list] = await Promise.all([call()(), sellableReleases({
        albums: cursor => api.albums(did, { limit: 100, cursor }),
        tracks: cursor => api.tracks({ artist_did: did, limit: 100, cursor }),
      })]);
      const next = readSelling(value);
      setSettings(next); setSupport(next.supportUrl); setReleases(list);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'could not load your selling settings.'); }
  }, [call, did]);
  useEffect(() => { if (auth.accountSync && auth.agent) void load(); }, [auth.accountSync, auth.agent, load]);

  const save = async (patch: Partial<SellingSettings>, done: string) => {
    setBusy(true);
    try {
      setSettings(readSelling(await call()(patch)));
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'could not save that. try again.');
      return false;
    } finally { setBusy(false); }
  };

  const saveSupport = async () => {
    setSupportError('');
    const text = support.trim();
    const url = text ? normalizeLink(text) : '';
    if (url === undefined) { setSupportError('use a full https link, like https://ko-fi.com/you.'); return; }
    if (await save({ supportUrl: url }, url ? `support link saved: ${storeName(url)}` : 'support link removed')) setSupport(url);
  };

  const summary = !settings ? 'buy and support links' : [
    settings.supportUrl ? `support on ${storeName(settings.supportUrl)}` : null,
    settings.buyLinks.length ? `${settings.buyLinks.length} buy ${settings.buyLinks.length === 1 ? 'link' : 'links'}` : null,
  ].filter(Boolean).join(' · ') || 'not set up yet';
  const small = { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale };

  return <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.surface }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`sell your music, ${summary}`}
      onPress={() => setOpen(value => !value)} style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>sell your music</Text>
        <Text numberOfLines={1} style={small}>{summary}</Text>
      </View>
      {open ? <CaretUp size={18} color={theme.muted} /> : <CaretDown size={18} color={theme.muted} />}
    </Pressable>
    {open && <View style={{ gap: 14 }}>
      <Copy>point listeners at wherever you already sell. buttons show up on your artist page and releases. plyr never sees the payment.</Copy>
      {!auth.accountSync ? <View style={{ gap: 8 }}>
        <Copy>reconnect to choose where listeners can buy your music.</Copy>
        <View style={row}><Action primary label="reconnect" href={{ pathname: '/login', params: { return_to: '/portal' } }} /></View>
      </View> : loadError ? <View style={{ gap: 8 }}>
        <Copy live>{loadError}</Copy>
        <View style={row}><Action label="try again" onPress={() => void load()} /></View>
      </View> : !settings || !releases ? <Copy live>loading…</Copy> : <>
        <View style={{ gap: 8 }}>
          <Field label="support link" value={support} onChangeText={setSupport} placeholder="https://ko-fi.com/you" autoCapitalize="none" autoCorrect={false}
            keyboardType="url" textContentType="URL" returnKeyType="done" onSubmitEditing={() => void saveSupport()} />
          {supportError ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 14 * theme.scale }}>{supportError}</Text>
            : <Text style={small}>{settings.supportUrl ? `shows as "support on ${storeName(settings.supportUrl)}" on your artist page and downloads.` : 'shown on your artist page and when someone downloads.'}</Text>}
          <View style={row}><Action primary label="save support link" disabled={busy || support.trim() === settings.supportUrl} onPress={() => void saveSupport()} /></View>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>buy links</Text>
          <Text style={small}>optional, per release. leave the price empty to just say "buy on Bandcamp".</Text>
          {!releases.length && <Copy>upload something first, then add where it's sold.</Copy>}
          {releases.map(release => {
            const offer = settings.buyLinks.find(link => link.subject === release.uri);
            return <View key={release.uri} style={[styles.release, { borderTopColor: theme.hairline }]}>
              <View style={styles.releaseRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{release.title}</Text>
                  <Text style={small}>{release.kind}</Text>
                </View>
                {editing !== release.uri && <Pressable accessibilityRole="button" onPress={() => setEditing(release.uri)}
                  accessibilityLabel={offer ? `edit buy link for ${release.title}: ${offerLabel(offer)}` : `add a buy link for ${release.title}`}
                  style={({ pressed }) => [styles.pill, { borderColor: offer ? theme.accent : theme.line, opacity: pressed ? 0.7 : 1 }]}>
                  <Text numberOfLines={1} style={{ color: offer ? theme.accent : theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: offer ? '700' : '400' }}>{offer ? offerLabel(offer) : 'add a buy link'}</Text>
                </Pressable>}
              </View>
              {editing === release.uri && <BuyEditor release={release} offer={offer} busy={busy} cancel={() => setEditing(undefined)}
                save={async next => {
                  const links = withBuyLink(settings.buyLinks, next);
                  const done = next.url ? `${release.title}: buy ${offerLabel(next)}` : `removed the buy link for ${release.title}`;
                  if (await save({ buyLinks: links }, done)) setEditing(undefined);
                }} />}
            </View>;
          })}
        </View>
      </>}
    </View>}
  </View>;
}

function BuyEditor({ release, offer, busy, save, cancel }: {
  release: Release; offer?: StoredOffer; busy: boolean;
  save: (next: StoredOffer | { subject: string; url?: undefined }) => Promise<void>; cancel: () => void;
}) {
  const theme = useAppearance();
  const [url, setUrl] = useState(offer?.url ?? '');
  const [currency, setCurrency] = useState(offer?.currency ?? 'USD');
  const [price, setPrice] = useState(offer?.amount !== undefined && offer.currency ? priceText(offer.amount, offer.currency) : '');
  const [error, setError] = useState('');
  const submit = () => {
    setError('');
    const link = normalizeLink(url);
    if (!link) { setError('paste the full link to where you sell it.'); return; }
    let amount: number | undefined;
    if (price.trim()) {
      amount = parsePrice(price, currency);
      if (amount === undefined) { setError('enter a price like 8 or 7.50, or leave it empty.'); return; }
    }
    void save({ subject: release.uri, url: link, ...(amount !== undefined ? { amount, currency } : {}) });
  };
  return <View style={{ gap: 10, paddingTop: 8 }}>
    <Field label={`buy link for ${release.title}`} value={url} onChangeText={setUrl} placeholder="https://you.bandcamp.com/album/…"
      autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" />
    <Field label="price (optional)" value={price} onChangeText={setPrice} placeholder="8" keyboardType="decimal-pad" />
    <Text style={{ color: theme.text, fontSize: 15 * theme.scale }}>currency</Text>
    <View style={[row, { marginTop: -4 }]}>
      {CURRENCIES.map(code => <Choice key={code} label={code} selected={currency === code} onPress={() => setCurrency(code)} />)}
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 14 * theme.scale }}>{error}</Text> : null}
    <View style={row}>
      <Action primary label="save" disabled={busy} onPress={submit} />
      {offer && <Action label="remove" disabled={busy} onPress={() => void save({ subject: release.uri })} />}
      <Action label="cancel" onPress={cancel} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  release: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  releaseRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { minHeight: 44, maxWidth: '55%', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1 },
});
