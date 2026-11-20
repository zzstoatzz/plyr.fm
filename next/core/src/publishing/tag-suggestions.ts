import type { Page } from '../api.ts';

export type TagCount = { name: string; track_count: number };
type TagPages = (limit: number, cursor?: string) => Promise<Page<TagCount>>;

const PAGE = 100, PAGES = 5;

/** The tags typed so far, one per line, in the order they were added. */
export function tagList(value: string): string[] {
  return [...new Set(value.split('\n').map(tag => tag.trim()).filter(Boolean))];
}

/** Adds a typed or picked tag the way production does: trimmed, lowercased, deduplicated. */
export function addTag(value: string, tag: string): string {
  const next = tag.trim().toLowerCase().replace(/\s+/gu, ' ');
  const tags = tagList(value);
  return (next && !tags.includes(next) ? [...tags, next] : tags).join('\n');
}

export function removeTag(value: string, tag: string): string {
  return tagList(value).filter(item => item !== tag).join('\n');
}

/** Existing tags for what's being typed: prefix matches first, then other matches, each most-used first. */
export function suggestTags(catalog: readonly TagCount[], query: string, chosen: readonly string[], limit = 6): TagCount[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const open = catalog.filter(tag => !chosen.includes(tag.name) && tag.name.includes(q));
  const rank = (tag: TagCount) => tag.name.startsWith(q) ? 0 : 1;
  return open.map((tag, at) => ({ tag, at })).sort((a, b) => rank(a.tag) - rank(b.tag) || b.tag.track_count - a.tag.track_count || a.at - b.at)
    .slice(0, limit).map(({ tag }) => tag);
}

/** The catalog's most-used tags, a few pages deep; one load shared by every field, retried after a failure. */
export function tagCatalog(pages: TagPages) {
  let loading: Promise<TagCount[]> | undefined;
  return () => loading ??= (async () => {
    const tags: TagCount[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGES; page++) {
      const result = await pages(PAGE, cursor);
      tags.push(...result.data);
      if (!result.has_more || !result.next_cursor || result.next_cursor === cursor) break;
      cursor = result.next_cursor;
    }
    return tags;
  })().catch(failure => { loading = undefined; throw failure; });
}
