import { trackArtwork, collectionArtwork } from '@plyr/next-core/artwork';
import { ArrowsDownUp, CaretRight as ChevronRight, CurrencyCircleDollar, Disc, Globe, LinkSimple, Lock, MagnifyingGlass, PencilSimple as Pencil, ShareNetwork, Tag, Trash, UploadSimple, X, type Icon as IconGlyph } from './icons';
import { Link, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewProps, type ScrollViewInstance } from 'react-native';
import { api } from './api-client';
import { ApiError, type Artist, type ListSummary, type Track } from '@plyr/next-core/api';
import { accessLabel } from '@plyr/next-core/access/label';
import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { catalogDuration, facets, filterAlbums, filterTracks, loadAll, type AccessGroup, type OwnedSort } from '@plyr/next-core/catalog/owned';
import { artistOffers, storeName, supportLink } from '@plyr/next-core/selling';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { useAuth } from './auth';
import { useAppearance } from './appearance';
import { AUDIO_SPACE_TYPE } from './auth-config';
import { Action, Copy, inputFontSize, pageFrame, row } from './controls';
import { Cover, Row, trackCount, trackMeta } from './CatalogPieces';
import { privatePds } from './publishing/private-pds';
import { Text } from './Text';
import { WaveLoading } from './WaveLoading';
import { useTabs } from './behaviors/use-tabs';
import { shareLink } from './ShareLink';
import { createPds } from './pds';
import { toast } from './toast';
import { confirmTrackDelete } from './publishing/confirm-delete';

const portalTabs = ['tracks', 'albums'] as const;
/** rows rendered at once; a big catalog grows on request instead of mounting hundreds of rows */
const PAGE = 60;
type PortalTab = typeof portalTabs[number];

export function Portal() {
  const auth = useAuth();
  if (!auth.ready) return <PortalPage><WaveLoading label="Loading account" /></PortalPage>;
  if (!auth.did) return <PortalPage>
    <Copy>sign in to manage your uploads.</Copy>
    <View style={row}><Action label="sign in" href={{ pathname: '/login', params: { return_to: '/portal' } }} /></View>
  </PortalPage>;
  return <AccountPortal key={auth.did} did={auth.did} handle={auth.handle} />;
}

function PortalPage({ children, scrollRef, ...props }: {
  children: ReactNode; scrollRef?: Ref<ScrollViewInstance>;
} & Pick<ScrollViewProps, 'onScroll' | 'onContentSizeChange'>) {
  const theme = useAppearance();
  return <ScrollView ref={scrollRef} {...props} scrollEventThrottle={16} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
    style={{ backgroundColor: theme.background }} contentContainerStyle={{ ...pageFrame, gap: 16, paddingTop: 16, paddingBottom: 32 }}>
    {children}
  </ScrollView>;
}

function AccountPortal({ did, handle }: { did: string; handle: string | null }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [profile, setProfile] = useState<Artist | null>();
  const [tracks, setTracks] = useState<Track[]>();
  const [privateTracks, setPrivateTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<ListSummary[]>();
  const [errors, setErrors] = useState({ profile: false, catalog: false, albums: false, private: false });
  const [privateSettled, setPrivateSettled] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [tab, setTab] = useState<PortalTab>('tracks');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<OwnedSort>('recent');
  const [access, setAccess] = useState<AccessGroup>();
  const [album, setAlbum] = useState<string>();
  const [tag, setTag] = useState<string>();
  const pds = useMemo(() => auth.did === did && (auth.privatePublishing || auth.privateDeleting) ? privatePds(auth) : undefined,
    [auth.did, auth.rpc, auth.privatePublishing, auth.privateDeleting, did]);
  const generation = useRef(0);
  const revisions = useRef('');
  const revision = () => (['tracks', 'collections', 'profile'] as const).map(scope => catalogRevision(did, scope)).join('|');

  const load = useCallback(async () => {
    const current = ++generation.current;
    revisions.current = revision();
    const live = () => current === generation.current;
    const fail = (key: keyof typeof errors, value: boolean) => { if (live()) setErrors(previous => ({ ...previous, [key]: value })); };
    await Promise.all([
      api.artist(did).catch(error => { if (error instanceof ApiError && error.status === 404) return null; throw error; })
        .then(value => { if (live()) { setProfile(value); fail('profile', false); } }, () => fail('profile', true)),
      loadAll(cursor => api.tracks({ artist_did: did, limit: 100, cursor }))
        .then(value => { if (live()) { setTracks(value); fail('catalog', false); } }, () => fail('catalog', true)),
      loadAll(cursor => api.albums(did, { limit: 100, cursor }))
        .then(value => { if (live()) { setAlbums(value); fail('albums', false); } }, () => fail('albums', true)),
      (pds ? loadAll(async cursor => {
        const page = await pds.list(cursor);
        return { object: 'list', data: page.tracks, has_more: !!page.cursor, next_cursor: page.cursor };
      }) : Promise.resolve([])).then(value => { if (live()) { setPrivateTracks(value); fail('private', false); } }, () => fail('private', true))
        .finally(() => { if (live()) setPrivateSettled(true); })
    ]);
  }, [did, pds]);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { if (revisions.current && revisions.current !== revision()) void load(); }, [load]));

  const label = useCallback((track: Track) => accessLabel(track, AUDIO_SPACE_TYPE), []);
  const everything = useMemo(() => tracks && privateSettled ? [...tracks, ...privateTracks] : undefined, [tracks, privateTracks, privateSettled]);
  const found = useMemo(() => everything ? filterTracks(everything, { query, sort, access, album, tag }, label) : [], [everything, query, sort, access, album, tag, label]);
  const foundAlbums = useMemo(() => albums ? filterAlbums(albums, query) : [], [albums, query]);
  const options = useMemo(() => facets(everything ?? [], label), [everything, label]);
  // a deleted or edited track can take the last album or tag with it; drop that filter rather than show nothing
  useEffect(() => {
    if (!everything) return;
    if (album && !options.albums.some(option => option.name === album)) setAlbum(undefined);
    if (tag && !options.tags.some(option => option.name === tag)) setTag(undefined);
    if (access && !options.access.some(group => group.value === access)) setAccess(undefined);
  }, [everything, options, album, tag, access]);
  useEffect(() => setShown(PAGE), [query, sort, access, album, tag]);
  const plays = everything?.reduce((sum, track) => sum + (isPrivateTrack(track) ? 0 : track.metrics.play_count), 0) ?? 0;
  const seconds = everything?.reduce((sum, track) => sum + (track.metadata.duration_seconds ?? 0), 0) ?? 0;
  const support = supportLink(profile ?? undefined);
  const offers = artistOffers(profile ?? undefined).length;
  const paidStatus = [support && storeName(support), offers && `${offers} buy ${offers === 1 ? 'link' : 'links'}`].filter(Boolean).join(' · ');
  const name = profile?.display_name || handle || 'your uploads';
  const publicPath = '/u/' + (handle || did);
  const remove = (track: Track) => {
    setTracks(current => current?.filter(item => item.record.uri !== track.record.uri));
    setPrivateTracks(current => current.filter(item => item.record.uri !== track.record.uri));
  };
  const text = (size: number, color = theme.text, weight: '400' | '600' | '700' | '800' = '400') =>
    ({ color, fontFamily: theme.fontFamily, fontSize: size * theme.scale, fontWeight: weight });
  const sorts: OwnedSort[] = ['recent', 'title', 'plays'];
  const catalogTabs = useTabs({ label: 'your catalog', value: tab, onChange: setTab });
  const sortLabel = { recent: 'recent', title: 'title', plays: 'most played' } as const;

  return <PortalPage>
    <Link href={{ pathname: '/u/[handle]', params: { handle: handle || did } }} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`${name}, view your page`} style={{ paddingTop: 4 }}>
        {({ pressed }) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.7 : 1 }}>
          <Cover uri={profile?.avatar_url} size={60} round />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={text(22, theme.text, '800')}>{name}</Text>
            {handle && <Text numberOfLines={1} style={text(14, theme.muted)}>@{handle}</Text>}
          </View>
          <ChevronRight size={20} color={theme.muted} />
        </View>}
      </Pressable>
    </Link>
    {everything && <View accessible accessibilityLabel={`${plays} plays, ${everything.length} tracks, ${catalogDuration(seconds)} of audio`}
      style={[styles.numbers, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
      {[[plays.toLocaleString(), 'plays'], [everything.length.toLocaleString(), everything.length === 1 ? 'track' : 'tracks'], [catalogDuration(seconds), 'of audio']].map(([value, caption], index) =>
        <View key={caption} style={[styles.number, index < 2 && { borderRightWidth: StyleSheet.hairlineWidth, borderColor: theme.hairline }]}>
          <Text numberOfLines={1} style={text(19, theme.text, '700')}>{value}</Text>
          <Text numberOfLines={1} style={text(12, theme.faint)}>{caption}</Text>
        </View>)}
    </View>}
    <View style={styles.tools}>
      <Tool primary icon={UploadSimple} label="upload" href="/(main)/(publish)/upload" />
      <Tool icon={Disc} label="album" accessibilityLabel="new album" href="/create-album" />
      <Tool icon={CurrencyCircleDollar} label="get paid" accessibilityLabel={`get paid, ${paidStatus || 'not set up yet'}`} href="/get-paid" dot={!!paidStatus} />
      <Tool icon={Pencil} label="edit" accessibilityLabel="edit profile" href="/edit-profile" />
      <Tool icon={ShareNetwork} label="share" accessibilityLabel="share your page" onPress={() => void shareLink(publicPath)} />
    </View>
    {errors.profile && <View style={row}><Copy>couldn’t load your profile.</Copy><Action label="retry" onPress={() => void load()} /></View>}

    <View style={[styles.search, { borderColor: theme.line, backgroundColor: theme.surface }]}>
      <MagnifyingGlass size={18} color={theme.muted} />
      <TextInput value={query} onChangeText={setQuery} placeholder="search your tracks and albums" placeholderTextColor={theme.muted}
        accessibilityLabel="search your tracks and albums" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="never"
        style={{ flex: 1, minHeight: 44, color: theme.text, fontFamily: theme.fontFamily, fontSize: inputFontSize(theme.scale) }} />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel="clear search" onPress={() => setQuery('')} hitSlop={8}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}><X size={16} color={theme.muted} /></Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -20 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, alignItems: 'center' }}>
      <View {...catalogTabs.list} style={{ flexDirection: 'row', gap: 8 }}>
        <Chip {...catalogTabs.tab('tracks')} label={`tracks${everything ? ' · ' + everything.length : ''}`} />
        <Chip {...catalogTabs.tab('albums')} label={`albums${albums ? ' · ' + albums.length : ''}`} />
      </View>
      {tab === 'tracks' && <>
        <Chip icon={ArrowsDownUp} label={sortLabel[sort]} accessibilityLabel={`sort: ${sortLabel[sort]}`} onPress={() => setSort(sorts[(sorts.indexOf(sort) + 1) % sorts.length])} />
        {options.access.length > 1 && options.access.map(group => <Chip key={group.value} label={group.label} selected={access === group.value}
          icon={group.value === 'everyone' ? Globe : group.value === 'link' ? LinkSimple : Lock} onPress={() => setAccess(access === group.value ? undefined : group.value)} />)}
        {options.albums.slice(0, 8).map(option => <Chip key={'album:' + option.name} icon={Disc} label={option.name} accessibilityLabel={`album: ${option.name}`} selected={album === option.name} onPress={() => setAlbum(album === option.name ? undefined : option.name)} />)}
        {options.tags.slice(0, 8).map(option => <Chip key={'tag:' + option.name} icon={Tag} label={option.name} accessibilityLabel={`tag: ${option.name}`} selected={tag === option.name} onPress={() => setTag(tag === option.name ? undefined : option.name)} />)}
      </>}
    </ScrollView>

    {tab === 'tracks' ? <View {...catalogTabs.panel('tracks')} style={{ gap: 8 }}>
      {query.trim() && foundAlbums.length > 0 && <>
        <Text style={text(13, theme.muted)}>albums</Text>
        {foundAlbums.slice(0, 3).map(list => <Row key={list.record.uri} title={list.metadata.name || 'untitled album'} image={collectionArtwork(list)}
          subtitle={`album · ${trackCount(list.metrics.member_count)}`} href={{ pathname: '/album/[id]', params: { id: list.id } }} />)}
        {everything && <Text style={[text(13, theme.muted), { marginTop: 6 }]}>tracks · {found.length} of {everything.length}</Text>}
      </>}
      {found.slice(0, shown).map(track => {
        const hidden = isPrivateTrack(track);
        const subtitle = [label(track) === 'anyone with the link' ? 'with the link' : label(track), !hidden && trackMeta(track), track.metadata.album].filter(Boolean).join(' · ');
        return <Row key={track.record.uri} title={track.metadata.title} image={trackArtwork(track)} subtitle={subtitle}
          href={{ pathname: '/track/[id]', params: { id: track.id } }}
          action={hidden ? undefined : <View style={{ flexDirection: 'row', marginRight: -6 }}>
            <Edit label={`edit ${track.metadata.title}`} href={{ pathname: '/edit-track/[id]', params: { id: track.id } }} />
            <DeleteTrack track={track} deleted={() => remove(track)} />
          </View>} />;
      })}
      {found.length > shown && <View style={row}><Action label={`show more · ${found.length - shown} left`} onPress={() => setShown(count => count + PAGE)} /></View>}
      {everything && everything.length > 0 && !found.length && <View style={[row, { paddingVertical: 12 }]}>
        <Copy live>nothing matches.</Copy>
        <Action label="clear search and filters" onPress={() => { setQuery(''); setAccess(undefined); setAlbum(undefined); setTag(undefined); }} />
      </View>}
      {errors.private && <View style={row}><Copy>couldn’t load your private tracks.</Copy><Action label="try again" onPress={() => void load()} /></View>}
      {everything && !everything.length && !errors.catalog && <View style={{ gap: 12, paddingVertical: 16 }}>
        <Copy>nothing uploaded yet.</Copy>
        <View style={row}><Action primary label="upload your first track" href="/(main)/(publish)/upload" /></View>
      </View>}
    </View> : <View {...catalogTabs.panel('albums')} style={{ gap: 8 }}>
      {foundAlbums.map(list => <Row key={list.record.uri} title={list.metadata.name || 'untitled album'} image={collectionArtwork(list)}
        subtitle={trackCount(list.metrics.member_count) + (list.metrics.total_plays ? ` · ${list.metrics.total_plays} ${list.metrics.total_plays === 1 ? 'play' : 'plays'}` : '')}
        href={{ pathname: '/album/[id]', params: { id: list.id } }} />)}
      {albums && !albums.length && <View style={{ gap: 12, paddingVertical: 16 }}>
        <Copy>no albums yet. make one from what you've uploaded.</Copy>
        <View style={row}><Action label="new album" href="/create-album" /></View>
      </View>}
      {albums && albums.length > 0 && !foundAlbums.length && <Copy live>no albums match “{query.trim()}”.</Copy>}
      {errors.albums && <View style={row}><Copy live>couldn’t load your albums.</Copy><Action label="retry" onPress={() => void load()} /></View>}
      {!albums && !errors.albums && <WaveLoading label="Loading your albums" />}
    </View>}
    {errors.catalog ? <View style={{ gap: 10 }}><Copy live>couldn’t load your uploads.</Copy><View style={row}><Action label="retry" onPress={() => void load()} /></View></View>
      : tab === 'tracks' && !everything ? <WaveLoading label="Loading your uploads" /> : null}
  </PortalPage>;
}

function Tool({ icon: Glyph, label, accessibilityLabel, href, onPress, primary = false, dot = false }: {
  icon: IconGlyph; label: string; accessibilityLabel?: string; href?: Href; onPress?: () => void; primary?: boolean; dot?: boolean;
}) {
  const theme = useAppearance();
  const ink = primary ? theme.onAccent : theme.text;
  const body = <Pressable accessibilityRole={href ? 'link' : 'button'} accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
    style={({ pressed }) => StyleSheet.flatten([styles.tool, { borderColor: primary ? theme.accent : theme.hairline, backgroundColor: primary ? theme.accent : pressed ? theme.hover : theme.surface, opacity: pressed && primary ? 0.85 : 1 }])}>
    <Glyph size={22} color={primary ? ink : theme.accent} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: ink, fontFamily: theme.fontFamily, fontSize: 12.5 * theme.scale, fontWeight: '700' }}>{label}</Text>
    {dot && <View style={styles.dot} />}
  </Pressable>;
  return href ? <Link href={href} asChild>{body}</Link> : body;
}

function Chip({ label, accessibilityLabel, selected, onPress, icon: Glyph, role, nativeID, 'aria-controls': controls }: {
  label: string; accessibilityLabel?: string; selected?: boolean; onPress: () => void; icon?: IconGlyph;
  /** set by useTabs when the chip is a tab */
  role?: ReturnType<ReturnType<typeof useTabs>['tab']>['role']; nativeID?: string; 'aria-controls'?: string;
}) {
  const theme = useAppearance();
  return <Pressable accessibilityRole={role ?? 'button'} nativeID={nativeID} aria-controls={controls} accessibilityLabel={accessibilityLabel ?? label} accessibilityState={selected === undefined ? undefined : { selected }} aria-selected={role ? selected : undefined} aria-pressed={role || selected === undefined ? undefined : selected}
    onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1,
      borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.accent + '2e' : pressed ? theme.hover : 'transparent' })}>
    {Glyph && <Glyph size={14} color={selected ? theme.text : theme.muted} />}
    <Text numberOfLines={1} style={{ color: selected ? theme.text : theme.muted, fontFamily: theme.fontFamily, fontSize: 14 * theme.scale, fontWeight: selected ? '700' : '500', maxWidth: 180 }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  numbers: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
  number: { flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 12 },
  tools: { flexDirection: 'row', gap: 6 },
  tool: { flex: 1, minWidth: 0, height: 66, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot: { position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: '#4fc37a' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 6, borderRadius: 12, borderWidth: 1 },
});

function DeleteTrack({ track, deleted }: { track: Track; deleted: () => void }) {
  const theme = useAppearance();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const confirm = () => confirmTrackDelete(track.metadata.title, () => {
    setBusy(true);
    createPds(auth).deleteTrack(track.record.uri).then(() => {
      toast.success(`deleted "${track.metadata.title}"`);
      deleted();
    }, failure => {
      setBusy(false);
      toast.error(failure instanceof Error ? failure.message : 'could not delete this track. try again.');
    });
  });
  return <Pressable accessibilityRole="button" accessibilityLabel={`delete ${track.metadata.title}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={confirm}
    style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}>
    <Trash color={theme.muted} size={18} />
  </Pressable>;
}

function Edit({ label, href }: { label: string; href: Href }) {
  const theme = useAppearance();
  return <Link href={href} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Pencil color={theme.muted} size={18} />
    </Pressable>
  </Link>;
}

