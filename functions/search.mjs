// Dynamic live search module for robotics references and character/animal morphology.
// No hardcoded themes or dictionaries: searches external encyclopedic and robotics resources
// for whatever theme, character, or morphology the user requested.

// Wikimedia asks API clients to identify themselves with a contact URL.
const WM_HEADERS = { 'User-Agent': 'PICOCEO-Builder/1.0 (https://cyberbuild-ai.web.app; robot design reference search)' };

async function getJson(url, signal) {
  const res = await fetch(url, { headers: WM_HEADERS, signal });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }   // rate-limit pages are plain text
}

/**
 * Visual references for a subject the AI named (e.g. "frog", "ladybird beetle", "great white shark"): the
 * Wikipedia lead image + extract and up to three freely licensed Wikimedia Commons photos. The lead image is
 * also returned as a data URL so it can go to the vision-capable design steps as the reference image.
 * About three requests per design; returns null when nothing usable is found.
 */
export async function searchVisualReferences(subject) {
  const s = String(subject || '').trim().slice(0, 80);
  if (!s) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const summaryOf = t => getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}?redirect=true`, controller.signal);
    let sum = await summaryOf(s);
    if (!sum || sum.type === 'disambiguation' || !sum.thumbnail) {
      const hit = (await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(s)}&srlimit=1&format=json`, controller.signal))?.query?.search?.[0];
      sum = hit ? await summaryOf(hit.title) : null;
    }
    if (!sum?.thumbnail?.source) return null;

    const images = [{ title: sum.title, thumb: sum.thumbnail.source, page: sum.content_urls?.desktop?.page ?? '', license: 'Wikipedia lead image' }];
    const commons = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${sum.title}`)}&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=360&format=json`, controller.signal);
    for (const p of Object.values(commons?.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl || !/^image\/(jpeg|png|webp)$/.test(ii.mime ?? '') || images.length >= 4) continue;
      images.push({ title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''), thumb: ii.thumburl, page: ii.descriptionurl, license: ii.extmetadata?.LicenseShortName?.value ?? 'Wikimedia Commons' });
    }

    // the lead image as a data URL for the AI (thumbnails are small; skip anything over 600 KB)
    let image = null;
    try {
      const res = await fetch(images[0].thumb, { headers: WM_HEADERS, signal: controller.signal });
      const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      if (buf && buf.length < 600_000 && mimeType.startsWith('image/')) image = { name: `${sum.title} (reference)`, mimeType, dataUrl: `data:${mimeType};base64,${buf.toString('base64')}` };
    } catch { /* references still useful without the inline image */ }

    return { subject: s, title: sum.title, description: sum.description ?? '', extract: String(sum.extract ?? '').slice(0, 600), images, image };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchDesignReferences(prompt) {
  const p = String(prompt || '').trim();
  if (!p) return null;

  // Clean prompt stop-words to extract the core subject / concept
  const cleanTerms = p
    .replace(/\b(?:create|make|build|design|generate|give|me|a|an|the|with|and|in|of|shape|style|using|\d+\s*kits?|cyberbrick|please|robot|bot|for|my|desk|tiny|small|biped|bipedal|walking|wheeled|arm)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const querySubject = cleanTerms || p.slice(0, 60).trim();
  if (!querySubject) return null;

  const searchQuery = `${querySubject} morphology anatomy`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&utf8=&format=json`;
    let res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PICOCEO-Builder/1.0 (robotics reference search)' },
    });

    let data = res.ok ? await res.json() : null;
    let hits = data?.query?.search || [];

    // If query was too specific, retry with just the subject
    if (!hits.length && cleanTerms) {
      const fallbackUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(querySubject)}&utf8=&format=json`;
      res = await fetch(fallbackUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'PICOCEO-Builder/1.0 (robotics reference search)' },
      });
      data = res.ok ? await res.json() : null;
      hits = data?.query?.search || [];
    }

    clearTimeout(timer);

    const snippets = hits
      .slice(0, 4)
      .map(s => (s.snippet || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim())
      .filter(s => s.length > 25);

    if (!snippets.length) return null;

    return {
      query: querySubject,
      snippets,
    };
  } catch {
    return null;
  }
}
