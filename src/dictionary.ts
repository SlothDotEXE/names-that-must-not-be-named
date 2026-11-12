export type DictionaryDefinition = {
  text: string;
  sourceUrl: string | null;
  license: { name: string; url: string | null } | null;
};

const cache = new Map<string, DictionaryDefinition | null>();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function selectDefinition(payload: unknown): DictionaryDefinition | undefined {
  if (!Array.isArray(payload)) return undefined;
  for (const entry of payload) {
    if (!record(entry) || !Array.isArray(entry.meanings)) continue;
    for (const meaning of entry.meanings) {
      if (!record(meaning) || !Array.isArray(meaning.definitions)) continue;
      for (const sense of meaning.definitions) {
        if (!record(sense) || typeof sense.definition !== 'string' || !sense.definition.trim()) continue;
        let sourceUrl: string | null = null;
        if (Array.isArray(entry.sourceUrls)) {
          for (const source of entry.sourceUrls) {
            sourceUrl = httpsUrl(source);
            if (sourceUrl) break;
          }
        }
        const license = record(entry.license) && typeof entry.license.name === 'string' && entry.license.name.trim()
          ? { name: entry.license.name, url: httpsUrl(entry.license.url) }
          : null;
        return { text: sense.definition, sourceUrl, license };
      }
    }
  }
  return undefined;
}

// Only definitions and genuine 404s are cacheable; undefined means try again on a later check.
async function requestDefinition(word: string, signal: AbortSignal): Promise<DictionaryDefinition | null | undefined> {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal,
    });
    if (signal.aborted) return undefined;
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    return signal.aborted ? undefined : selectDefinition(payload);
  } catch {
    return undefined;
  }
}

export async function lookupDefinition(word: string, signal: AbortSignal): Promise<DictionaryDefinition | null> {
  if (!word || signal.aborted) return null;
  if (cache.has(word)) return cache.get(word)!;
  const controller = new AbortController();
  const abort = () => controller.abort();
  let cancel!: () => void;
  const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
  controller.signal.addEventListener('abort', cancel, { once: true });
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, 5_000);
  try {
    // Also settle promptly if a response implementation ignores cancellation.
    const definition = await Promise.race([requestDefinition(word, controller.signal), cancelled]);
    if (signal.aborted || controller.signal.aborted) return null;
    if (definition !== undefined) cache.set(word, definition);
    return definition ?? null;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
  }
}
