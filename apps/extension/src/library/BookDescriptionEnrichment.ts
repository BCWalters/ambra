/**
 * Fetches a short fallback description for a book whose EPUB doesn't
 * declare its own `dc:description`, from free, keyless, no-cost APIs:
 * Open Library first (an Internet Archive nonprofit project; supports a
 * precise ISBN lookup when the book has one), falling back to
 * Wikipedia's REST summary API (a Wikimedia Foundation nonprofit
 * project; much broader coverage for well-known/classic titles, which
 * make up a large share of what a from-scratch EPUB reader is likely to
 * see — public-domain classics, popular fiction, etc.).
 *
 * This is the *only* place this extension makes an outbound network
 * request to a third party — everything else (parsing, rendering,
 * annotations, search) is fully local. That's a deliberate, narrow
 * exception to the project's general offline-first stance, made
 * because:
 *  - it only ever runs for a book that has no author-supplied
 *    description to show instead (see `ReaderController`'s trigger
 *    condition), so a reader who never opens Book Details for such a
 *    book never causes any network activity from this;
 *  - it sends only the book's own title/author/ISBN — the same
 *    information already shown in the Book Details panel — never file
 *    contents, reading position, annotations, or any other activity;
 *  - failures are silent and non-blocking: nothing about opening or
 *    reading a book depends on this succeeding; and
 *  - both services are nonprofit-run, require no API key/account, and
 *    are used strictly read-only.
 *
 * Neither service's terms allow presenting their content without
 * attribution, so every result carries a `sourceName`/`sourceUrl` the
 * Book Details panel shows as a "via ..." link back to the source.
 */

import { abbreviateMetadata, METADATA_TEXT_LIMITS } from "../MetadataText.js";

export interface DescriptionEnrichmentResult {
  readonly description: string;
  readonly sourceName: "Open Library" | "Wikipedia";
  readonly sourceUrl: string;
}

function truncate(text: string): string {
  const limits = METADATA_TEXT_LIMITS.description;
  return abbreviateMetadata(text.trim(), limits.preview, limits.paragraphs);
}

/** Open Library descriptions conventionally end with their own
 * "([source](url))" Markdown note pointing back to wherever *they*
 * scraped the description from — always redundant here since the Book
 * Details panel already shows its own "via Open Library" attribution
 * link (see this module's doc comment), and worse, `truncate` cutting
 * through the middle of one left a dangling, half-rendered link visible
 * to the reader (issue #71). Stripped from the *raw*, untruncated text
 * before `truncate` ever sees it, rather than trying to detect/repair a
 * partial link after the fact. Wikipedia's REST summary extract has no
 * equivalent convention, so this is only ever applied to Open Library's
 * own description field. */
function stripTrailingSourceNote(text: string): string {
  const match = text.match(/\(\s*\[source\][\s\S]*\)\s*$/i);
  if (!match || match.index === undefined) {
    return text;
  }
  return text.slice(0, match.index).trimEnd();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  return response.json();
}

/** Open Library's `description` field is inconsistently shaped across
 * records in the wild: sometimes a plain string, sometimes an object
 * like `{ type: "/type/text", value: "..." }`. */
function extractOpenLibraryDescription(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

/** Looks up a book on Open Library, preferring a direct ISBN lookup
 * (precise — resolves to one specific edition/work) and falling back to
 * a title/author search when there's no ISBN or the ISBN isn't in Open
 * Library's catalog. An edition record sometimes carries its own
 * description directly; otherwise this follows its `works` reference to
 * the work-level record, which much more commonly has one. */
async function tryOpenLibrary(
  title: string,
  creator: string | undefined,
  isbn: string | undefined,
): Promise<DescriptionEnrichmentResult | undefined> {
  let workKey: string | undefined;

  if (isbn) {
    const normalizedIsbn = isbn.replace(/[^0-9Xx]/g, "");
    try {
      const edition = (await fetchJson(
        `https://openlibrary.org/isbn/${encodeURIComponent(normalizedIsbn)}.json`,
      )) as { works?: { key?: string }[]; description?: unknown };
      const inlineDescription = extractOpenLibraryDescription(edition.description);
      if (inlineDescription) {
        return {
          description: truncate(stripTrailingSourceNote(inlineDescription)),
          sourceName: "Open Library",
          sourceUrl: `https://openlibrary.org/isbn/${normalizedIsbn}`,
        };
      }
      workKey = edition.works?.[0]?.key;
    } catch {
      // No edition found for this ISBN (or the request failed) — fall
      // through to a title/author search below rather than giving up.
    }
  }

  if (!workKey) {
    try {
      const query = new URLSearchParams({ title, limit: "1" });
      if (creator) {
        query.set("author", creator);
      }
      const searchResult = (await fetchJson(`https://openlibrary.org/search.json?${query.toString()}`)) as {
        docs?: { key?: string }[];
      };
      workKey = searchResult.docs?.[0]?.key;
    } catch {
      return undefined;
    }
  }
  if (!workKey) {
    return undefined;
  }

  try {
    const work = (await fetchJson(`https://openlibrary.org${workKey}.json`)) as { description?: unknown };
    const description = extractOpenLibraryDescription(work.description);
    if (!description) {
      return undefined;
    }
    return {
      description: truncate(stripTrailingSourceNote(description)),
      sourceName: "Open Library",
      sourceUrl: `https://openlibrary.org${workKey}`,
    };
  } catch {
    return undefined;
  }
}

/** Looks up a book on Wikipedia: a full-text search for the title
 * (plus author, to disambiguate common titles) to find the most likely
 * article, then that article's REST API summary (a short, clean
 * extract meant for exactly this kind of use). */
async function tryWikipedia(
  title: string,
  creator: string | undefined,
): Promise<DescriptionEnrichmentResult | undefined> {
  try {
    const searchQuery = creator ? `${title} ${creator}` : title;
    const searchParams = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: searchQuery,
      format: "json",
      origin: "*",
      srlimit: "1",
    });
    const searchResult = (await fetchJson(`https://en.wikipedia.org/w/api.php?${searchParams.toString()}`)) as {
      query?: { search?: { title?: string }[] };
    };
    const pageTitle = searchResult.query?.search?.[0]?.title;
    if (!pageTitle) {
      return undefined;
    }

    const summary = (await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`,
    )) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
    if (!summary.extract) {
      return undefined;
    }
    return {
      description: truncate(summary.extract),
      sourceName: "Wikipedia",
      sourceUrl: summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
    };
  } catch {
    return undefined;
  }
}

/** Tries Open Library first, then Wikipedia — returns `undefined` if
 * neither has anything usable (a normal, expected outcome for an
 * obscure or self-published book) rather than throwing. Never throws:
 * every internal failure is caught and treated as "this source has
 * nothing", so a network hiccup can't surface as an error anywhere a
 * caller would need to handle it. */
export async function fetchBookDescription(
  title: string,
  creator: string | undefined,
  isbn: string | undefined,
): Promise<DescriptionEnrichmentResult | undefined> {
  const fromOpenLibrary = await tryOpenLibrary(title, creator, isbn);
  if (fromOpenLibrary) {
    return fromOpenLibrary;
  }
  return tryWikipedia(title, creator);
}
