import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signal = () => new AbortController().signal;
const payload = (text = 'A definition.') => [{ meanings: [{ definitions: [{ definition: text }] }] }];
const success = () => Response.json(payload());

// Dynamic imports after resetModules isolate the private page-lifetime cache per test.
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('dictionary selection and attribution', () => {
  it('selects the first nonblank sense in API order and attributes only its entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([
      null,
      { sourceUrls: ['https://wrong.example/'], license: { name: 'Wrong' }, meanings: [null, {}, { definitions: [null, {}, { definition: '  ' }] }] },
      { sourceUrls: ['javascript:alert(1)', '/relative', 'https://example.org/selected', 'https://example.org/later'], license: { name: 'Selected license', url: 'https://example.org/license' }, meanings: [false, { definitions: 'invalid' }, { definitions: [{ definition: 7 }, { definition: '\n Original definition.  ' }, { definition: 'Later sense' }] }] },
      { meanings: [{ definitions: [{ definition: 'Later entry' }] }] },
    ])));
    const { lookupDefinition } = await import('../src/dictionary');
    expect(await lookupDefinition('word', signal())).toEqual({ text: '\n Original definition.  ', sourceUrl: 'https://example.org/selected', license: { name: 'Selected license', url: 'https://example.org/license' } });
  });

  it.each([
    [{}, { sourceUrl: null, license: null }],
    [{ sourceUrls: ['http://unsafe.example', '//relative.example', 'data:text/html,bad'], license: { name: 'Plain credit', url: 'javascript:alert(1)' } }, { sourceUrl: null, license: { name: 'Plain credit', url: null } }],
    [{ sourceUrls: 'https://not-an-array.example', license: { name: '  ', url: 'https://example.org' } }, { sourceUrl: null, license: null }],
  ])('retains a definition with missing or unsafe metadata (%j)', async (metadata, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ ...payload()[0], ...metadata }])));
    const { lookupDefinition } = await import('../src/dictionary');
    expect(await lookupDefinition('word', signal())).toEqual({ text: 'A definition.', ...expected });
  });
});

describe('page-lifetime caching', () => {
  it('reuses definitions and genuine 404 misses without another outbound request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    const definition = await lookupDefinition('known', signal());
    expect(definition?.text).toBe('A definition.');
    expect(await lookupDefinition('known', signal())).toEqual(definition);
    expect(await lookupDefinition('missing', signal())).toBeNull();
    expect(await lookupDefinition('missing', signal())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['network', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['429', () => Promise.resolve(new Response(null, { status: 429 }))],
    ['500', () => Promise.resolve(new Response(null, { status: 500 }))],
    ['malformed payload', () => Promise.resolve(Response.json({ meanings: [] }))],
    ['no definition', () => Promise.resolve(Response.json([{ meanings: [{ definitions: [{ definition: '' }] }] }]))],
    ['invalid JSON', () => Promise.resolve(new Response('{not json'))],
  ])('does not cache %s failures', async (_label, firstResponse) => {
    const fetch = vi.fn().mockImplementationOnce(firstResponse).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    expect(await lookupDefinition('word', signal())).toBeNull();
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('cancellation and deadline', () => {
  it('does not request or return a cached definition for an already-aborted signal', async () => {
    const fetch = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    const controller = new AbortController(); controller.abort();
    expect(await lookupDefinition('word', controller.signal)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
    expect(await lookupDefinition('word', controller.signal)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('settles in-flight aborts without caching absence', async () => {
    const fetch = vi.fn().mockImplementationOnce((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    const controller = new AbortController();
    const pending = lookupDefinition('word', controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
  });

  it.each([200, 404])('ignores a late HTTP %s response after cancellation without publishing it to cache', async status => {
    let resolve!: (response: Response) => void;
    const late = new Promise<Response>(r => { resolve = r; });
    const fetch = vi.fn().mockReturnValueOnce(late).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    const controller = new AbortController();
    const pending = lookupDefinition('word', controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    resolve(status === 200 ? Response.json(payload('Obsolete')) : new Response(null, { status }));
    await late;
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('discards a body that finishes parsing after cancellation', async () => {
    let resolve!: (value: unknown) => void;
    const body = new Promise<unknown>(r => { resolve = r; });
    const response = success();
    vi.spyOn(response, 'json').mockReturnValue(body);
    const fetch = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    const controller = new AbortController();
    const pending = lookupDefinition('word', controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toBeNull();
    resolve(payload('Obsolete'));
    await body;
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
  });

  it('stops at 5,000ms even if fetch ignores abort, and permits a later successful lookup', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const late = new Promise<Response>(r => { resolve = r; });
    const fetch = vi.fn().mockReturnValueOnce(late).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    let settled = false;
    const pending = lookupDefinition('word', signal()).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    resolve(Response.json(payload('Too late')));
    await late;
    expect((await lookupDefinition('word', signal()))?.text).toBe('A definition.');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('lookup privacy boundary', () => {
  it('does not request empty or unencodable keys', async () => {
    const fetch = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    expect(await lookupDefinition('', signal())).toBeNull();
    expect(await lookupDefinition('\uD800', signal())).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('encodes reserved characters in one path segment and omits credentials and referrers', async () => {
    const fetch = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetch);
    const { lookupDefinition } = await import('../src/dictionary');
    await lookupDefinition('a/b?c#d %', signal());
    expect(fetch).toHaveBeenCalledWith('https://api.dictionaryapi.dev/api/v2/entries/en/a%2Fb%3Fc%23d%20%25', {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: expect.any(AbortSignal),
    });
  });
});
