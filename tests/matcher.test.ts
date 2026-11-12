import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Dataset, HashRow, Locale, NameRequest } from '../src/contracts';
import { checkName } from '../src/matcher';

function row(word: string, options: Partial<HashRow> = {}): HashRow {
  const normalized = word.toLowerCase().replaceAll('\u00e3\u20ac\u20ac', '');
  return {
    rowIndex: 0,
    hash: createHash('md5').update('phoenix' + normalized, 'utf8').digest('hex'),
    locale: 'en-US', alwaysCheck: false, words: [word], ...options,
  };
}
function beast(name: string, rows: HashRow[], locale: Locale = 'en-US') {
  return checkName({ kind: 'beast', name, locale }, rows);
}
function character(firstName: string, lastName: string, rows: HashRow[], locale: Locale = 'en-US') {
  const request: NameRequest = { kind: 'character', firstName, lastName, locale };
  return checkName(request, rows);
}

describe('bundled table regressions', () => {
  const dataset: Dataset = JSON.parse(readFileSync('public/data/dataset.json', 'utf8'));
  it('finds the contributing fragment in Prometheus and a single-token extension', () => {
    const result = beast('Prometheus', dataset.rows);
    expect(result.verdict).toBe('restricted');
    expect(result.matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'meth', spans: [{ field: 'name', start: 3, end: 7 }],
    })]));
    expect(beast('methx', dataset.rows).matches.some(match => match.candidate === 'meth')).toBe(true);
  });
  it('does not invent matches for Classic or Raven', () => {
    expect(beast('Classic', dataset.rows).verdict).toBe('no-match');
    expect(beast('Raven', dataset.rows).verdict).toBe('no-match');
  });
  it('maps short and separator-crossing matches to original letters', () => {
    expect(beast('Ass', dataset.rows).verdict).toBe('restricted');
    expect(beast('a ss', dataset.rows).matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'ass', spans: [{ field: 'name', start: 0, end: 1 }, { field: 'name', start: 2, end: 4 }],
    })]));
    expect(beast('me-th', dataset.rows).matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'meth', spans: [{ field: 'name', start: 0, end: 2 }, { field: 'name', start: 3, end: 5 }],
    })]));
  });
});

describe('candidate traversal', () => {
  it('scans longer substrings, but not internal three-letter fragments', () => {
    expect(beast('xxabcdefyy', [row('abcdef')]).matches[0].candidate).toBe('abcdef');
    expect(beast('xxabcyy', [row('abc')]).verdict).toBe('no-match');
    expect(beast('abc defg', [row('abc')]).matches[0].rule).toBe('short-token');
  });
  it('returns overlapping and repeated occurrences in traversal order', () => {
    const matches = beast('abcdeabcde', [row('abcd'), row('bcde')]).matches;
    expect(matches.map(m => [m.candidate, m.spans[0].start])).toEqual([
      ['abcd', 0], ['bcde', 1], ['abcd', 5], ['bcde', 6],
    ]);
  });
  it('deduplicates a short token and compact whole with identical spans', () => {
    const matches = beast('abc ', [row('abc')]).matches;
    expect(matches).toHaveLength(1);
    expect(matches[0].rule).toBe('whole');
  });
  it('replaces only the three specified separators and preserves tabs and punctuation', () => {
    for (const separator of ['-', "'", '`']) {
      const match = beast(`me${separator}th`, [row('meth')]).matches[0];
      expect(match.spans).toEqual([{ field: 'name', start: 0, end: 2 }, { field: 'name', start: 3, end: 5 }]);
    }
    expect(beast('me.th', [row('meth')]).verdict).toBe('no-match');
    expect(beast('me\tth', [row('meth')]).verdict).toBe('no-match');
    expect(beast('me\tth', [row('me\tth')]).verdict).toBe('restricted');
  });
  it('checks compact empty strings only for nonempty original input', () => {
    expect(beast('', [row('')]).verdict).toBe('no-match');
    expect(beast('-  ', [row('')]).matches[0]).toMatchObject({ candidate: '', spans: [], rule: 'whole' });
  });
  it('checks exact combined name before last and first, without replacing punctuation', () => {
    const rows = [row('Al-ice Bob'), row('bob'), row('alice')];
    const matches = character('Al-ice', 'Bob', rows).matches;
    expect(matches.map(m => m.rule)).toEqual(['full-name', 'whole', 'substring']);
    expect(matches[0]).toMatchObject({ candidate: 'Al-ice Bob', spans: [
      { field: 'firstName', start: 0, end: 6 }, { field: 'lastName', start: 0, end: 3 },
    ] });
    expect(character('Al-ice', 'Bob', [row('Al ice Bob')]).verdict).toBe('no-match');
  });
  it('respects locale and always-check, even with no recovered plaintext', () => {
    const german = row('unlisted', { locale: 'de-DE', words: [] });
    expect(beast('unlisted', [german]).verdict).toBe('no-match');
    expect(beast('unlisted', [german], 'de-DE').matches[0]).toMatchObject({ candidate: 'unlisted', recoveredWords: [] });
    expect(beast('unlisted', [{ ...german, alwaysCheck: true }], 'ja-JP').verdict).toBe('restricted');
  });
  it('labels Unicode approximate without accent folding and removes the traced sequence when hashing', () => {
    expect(beast('café', [row('cafe')])).toMatchObject({ verdict: 'no-match', unicodeApproximate: true });
    expect(beast('CAFÉ', [row('café')])).toMatchObject({ verdict: 'restricted', unicodeApproximate: true });
    expect(beast('ab\u00e3\u20ac\u20accd', [row('abcd')])).toMatchObject({ verdict: 'restricted', unicodeApproximate: true });
  });
});
