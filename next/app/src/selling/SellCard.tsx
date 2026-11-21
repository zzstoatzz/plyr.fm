import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { parsePrice, priceText } from '@plyr/next-core/access/policy';
import { findReleases, linkedReleases, normalizeLink, offerLabel, readSelling, sellableReleases, storeName, withBuyLink, type Release, type SellingSettings, type StoredOffer } from '@plyr/next-core/selling';
import { api } from '../api-client';
import { useAuth } from '../auth';
import { getAuth } from '../auth-state';
import { useAppearance } from '../appearance';
import { Choice } from '../AccountPieces';
import { Action, Copy, Field, inputFontSize, row } from '../controls';
import { Cover } from '../CatalogPieces';
import { Sheet } from '../Sheet';
import { CaretDown, CaretUp } from '../icons';
import { accountSettings } from '../preference-sync';
import { Text } from '../Text';
import { toast } from '../toast';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
const SHOWN = 50;
const GROUPS = [{ label: 'all', value: undefined }, { label: 'albums', value: 'album' }, { label: 'tracks', value: 'track' }] as const;

/** portal: where listeners can pay you: a support link, and buy links on the releases you pick. plyr.fm links out, never takes the payment. */
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
  const [sheet, setSheet] = useState<{ picking: boolean; release?: Release }>();
  const controller = useRef<AbortController>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const call = useCallback(() => {
    const current = getAuth();
    if (!current.agent || !current.accountSync) throw new Error('reconnect to change where listeners can pay you.');
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
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'could not load your payment settings.'); }
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
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`get paid, ${summary}`}
      onPress={() => setOpen(value => !value)} style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 17 * theme.scale, fontWeight: '700' }}>get paid</Text>
        <Text numberOfLines={1} style={small}>{summary}</Text>
      </View>
      {open ? <CaretUp size={18} color={theme.muted} /> : <CaretDown size={18} color={theme.muted} />}
    </Pressable>
    {open && <View style={{ gap: 14 }}>
      <Copy>point listeners to wherever you already sell or take tips. buttons show up on your artist page and on what you've uploaded. plyr.fm never sees the payment.</Copy>
      {!auth.accountSync ? <View style={{ gap: 8 }}>
        <Copy>reconnect to choose where listeners can pay you.</Copy>
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
          <Text style={small}>a buy button on one track or album, pointing wherever it's sold.</Text>
          {linkedReleases(releases, settings.buyLinks).map(({ release, offer }) =>
            <Pressable key={release.uri} accessibilityRole="button" onPress={() => setSheet({ picking: false, release })}
              accessibilityLabel={`edit buy link for ${release.title}: ${offerLabel(offer)}`}
              style={({ pressed }) => [styles.release, { borderTopColor: theme.hairline, opacity: pressed ? 0.7 : 1 }]}>
              <ReleaseLine release={release} detail={release.group} />
              <View style={[styles.tag, { borderColor: theme.accent }]}>
                <Text numberOfLines={1} style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: '700' }}>{offerLabel(offer)}</Text>
              </View>
            </Pressable>)}
          {!releases.length ? <Copy>upload something first, then add where it's sold.</Copy>
            : settings.buyLinks.length < releases.length && <View style={[row, { marginTop: 8 }]}>
              <Pressable accessibilityRole="button" onPress={() => setSheet({ picking: true })}
                style={({ pressed }) => [styles.add, { borderColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: theme.accent, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '700' }}>+ add a buy link</Text>
              </Pressable>
            </View>}
        </View>
      </>}
    </View>}
    {sheet && settings && releases && <BuySheet releases={releases} links={settings.buyLinks} picking={sheet.picking} release={sheet.release} busy={busy}
      choose={release => setSheet({ ...sheet, release })} close={() => { if (!busy) setSheet(undefined); }}
      save={async (release, next) => {
        const done = next.url ? `${release.title}: buy ${offerLabel(next)}` : `removed the buy link for ${release.title}`;
        if (await save({ buyLinks: withBuyLink(settings.buyLinks, next) }, done)) setSheet(undefined);
      }} />}
  </View>;
}

function ReleaseLine({ release, detail }: { release: Release; detail: string }) {
  const theme = useAppearance();
  return <View style={styles.releaseLine}>
    <Cover uri={release.art} size={44} radius={6} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: theme.text, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, fontWeight: '600' }}>{release.title}</Text>
      <Text numberOfLines={1} style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>{detail}</Text>
    </View>
  </View>;
}

/** add a buy link: find the release first, then its link. editing an existing link skips the finding. */
function BuySheet({ releases, links, picking, release, busy, choose, close, save }: {
  releases: Release[]; links: StoredOffer[]; picking: boolean; release?: Release; busy: boolean;
  choose: (release: Release | undefined) => void; close: () => void;
  save: (release: Release, next: StoredOffer | { subject: string; url?: undefined }) => Promise<void>;
}) {
  const theme = useAppearance();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Release['group']>();
  const [focused, setFocused] = useState(false);
  const offer = release && links.find(link => link.subject === release.uri);
  const found = findReleases(releases, links, query, group);
  const small = { color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale, lineHeight: 18 * theme.scale };
  return <Sheet title={offer ? 'edit buy link' : 'add a buy link'} close={close}>
    {release ? <>
      <View style={[styles.picked, { backgroundColor: theme.hover }]}>
        <ReleaseLine release={release} detail={release.kind} />
        {picking && !offer && <Action label="change" onPress={() => choose(undefined)} />}
      </View>
      <BuyEditor release={release} offer={offer} busy={busy} save={next => save(release, next)} />
    </> : <>
      <TextInput value={query} onChangeText={setQuery} placeholder="find a track or album" accessibilityLabel="find a track or album" autoFocus
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholderTextColor={theme.muted}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={[styles.search, { color: theme.text, backgroundColor: theme.surface, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale), borderColor: focused ? theme.accent : theme.border }]} />
      <View style={row}>{GROUPS.map(option => <Choice key={option.label} label={option.label} selected={group === option.value} onPress={() => setGroup(option.value)} />)}</View>
      <View>
        {found.slice(0, SHOWN).map(item => <Pressable key={item.uri} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.kind}`} onPress={() => choose(item)}
          style={({ pressed }) => [styles.release, { borderTopColor: theme.hairline, opacity: pressed ? 0.7 : 1 }]}>
          <ReleaseLine release={item} detail={item.kind} />
        </Pressable>)}
        {!found.length && <Copy>{query.trim() ? `nothing without a buy link matches "${query.trim()}".` : 'everything here already has a buy link.'}</Copy>}
        {found.length > SHOWN && <Text style={[small, { marginTop: 8 }]}>showing {SHOWN} of {found.length}. keep typing to narrow it down.</Text>}
      </View>
    </>}
  </Sheet>;
}

function BuyEditor({ release, offer, busy, save }: {
  release: Release; offer?: StoredOffer; busy: boolean;
  save: (next: StoredOffer | { subject: string; url?: undefined }) => Promise<void>;
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
    <Field label="where it's sold" value={url} onChangeText={setUrl} placeholder="https://you.bandcamp.com/album/…"
      autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" />
    <Field label="price (optional)" value={price} onChangeText={setPrice} placeholder="8" keyboardType="decimal-pad" />
    <Text style={{ color: theme.text, fontSize: 15 * theme.scale }}>currency</Text>
    <View style={[row, { marginTop: -4 }]}>
      {CURRENCIES.map(code => <Choice key={code} label={code} selected={currency === code} onPress={() => setCurrency(code)} />)}
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.danger, fontSize: 14 * theme.scale }}>{error}</Text>
      : <Text style={{ color: theme.faint, fontFamily: theme.fontFamily, fontSize: 13 * theme.scale }}>leave the price empty to just say "buy on Bandcamp".</Text>}
    <View style={row}>
      <Action primary label="save buy link" disabled={busy} onPress={submit} />
      {offer && <Action label="remove" destructive disabled={busy} onPress={() => void save({ subject: release.uri })} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  release: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10 },
  releaseLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  tag: { maxWidth: '50%', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  add: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22, borderWidth: 1 },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12 },
  search: { minHeight: 48, padding: 12, borderRadius: 8, borderWidth: 1 },
});
