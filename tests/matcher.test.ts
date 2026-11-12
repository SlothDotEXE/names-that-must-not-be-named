import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Dataset, HashRow } from '../src/contracts';
import { checkName } from '../src/matcher';

function row(word: string, options: Partial<HashRow> = {}): HashRow {
  const normalized = word.toLowerCase().replaceAll('\u00e3\u20ac\u20ac', '');
  return {
    rowIndex: 0,
    hash: createHash('md5').update('phoenix' + normalized, 'utf8').digest('hex'),
    locale: 'en-US', alwaysCheck: false, words: [word], ...options,
  };
}

describe('bundled table regressions', () => {
  const dataset: Dataset = JSON.parse(readFileSync('public/data/dataset.json', 'utf8'));
  it('finds the contributing fragment in Prometheus and a single-token extension', () => {
    const result = checkName('Prometheus', dataset.rows);
    expect(result.verdict).toBe('restricted');
    expect(result.matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'meth', spans: [{ start: 3, end: 7 }],
    })]));
    expect(checkName('methx', dataset.rows).matches.some(match => match.candidate === 'meth')).toBe(true);
  });
  it('includes the German match in Classic while leaving Raven unmatched', () => {
    expect(checkName('Classic', dataset.rows).matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidate: 'assi', locale: 'de-DE', spans: [{ start: 2, end: 6 }] }),
    ]));
    expect(checkName('Raven', dataset.rows).verdict).toBe('no-match');
  });
  it('maps short and separator-crossing matches to original letters', () => {
    expect(checkName('Ass', dataset.rows).verdict).toBe('restricted');
    expect(checkName('a ss', dataset.rows).matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'ass', spans: [{ start: 0, end: 1 }, { start: 2, end: 4 }],
    })]));
    expect(checkName('me-th', dataset.rows).matches).toEqual(expect.arrayContaining([expect.objectContaining({
      candidate: 'meth', spans: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
    })]));
  });
  it('finds fragments across spaces without guessing first and last names', () => {
    expect(checkName('Me Thom', dataset.rows).matches).toEqual([
      expect.objectContaining({
        candidate: 'MeTh', locale: 'en-US', rule: 'substring',
        spans: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
      }),
    ]);
  });
});

describe('candidate traversal', () => {
  it('scans longer substrings, but not internal three-letter fragments', () => {
    expect(checkName('xxabcdefyy', [row('abcdef')]).matches[0].candidate).toBe('abcdef');
    expect(checkName('xxabcyy', [row('abc')]).verdict).toBe('no-match');
    expect(checkName('abc defg', [row('abc')]).matches[0].rule).toBe('short-token');
  });
  it('returns overlapping and repeated occurrences in traversal order', () => {
    const matches = checkName('abcdeabcde', [row('abcd'), row('bcde')]).matches;
    expect(matches.map(m => [m.candidate, m.spans[0].start])).toEqual([
      ['abcd', 0], ['bcde', 1], ['abcd', 5], ['bcde', 6],
    ]);
  });
  it('reports an exact match once when substring traversal finds the same occurrence', () => {
    expect(checkName('abcd', [row('abcd')]).matches).toEqual([
      expect.objectContaining({ candidate: 'abcd', rule: 'exact', spans: [{ start: 0, end: 4 }] }),
    ]);
  });
  it('replaces only the three specified separators and preserves tabs and punctuation', () => {
    for (const separator of ['-', "'", '`']) {
      const match = checkName(`me${separator}th`, [row('meth')]).matches[0];
      expect(match.spans).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }]);
    }
    expect(checkName('me.th', [row('meth')]).verdict).toBe('no-match');
    expect(checkName('me\tth', [row('meth')]).verdict).toBe('no-match');
    expect(checkName('me\tth', [row('me\tth')]).verdict).toBe('restricted');
  });
  it('checks compact empty strings only for nonempty original input', () => {
    expect(checkName('', [row('')]).verdict).toBe('no-match');
    expect(checkName('-  ', [row('')]).matches[0]).toMatchObject({ candidate: '', spans: [], rule: 'whole' });
  });
  it('checks the untouched entry before short tokens and longer fragments', () => {
    const rows = [row('Al-ice Bob'), row('bob'), row('alice')];
    const matches = checkName('Al-ice Bob', rows).matches;
    expect(matches.map(m => [m.candidate, m.rule, m.spans])).toEqual([
      ['Al-ice Bob', 'exact', [{ start: 0, end: 10 }]],
      ['Bob', 'short-token', [{ start: 7, end: 10 }]],
      ['Alice', 'substring', [{ start: 0, end: 2 }, { start: 3, end: 6 }]],
    ]);
    expect(checkName('Al-ice Bob', [row('Al ice Bob')]).verdict).toBe('no-match');
  });
  it('preserves leading and trailing spaces in the exact check', () => {
    const name = ' Al-ice Bob ';
    const rows = [row(name)];
    expect(checkName(name, rows).matches).toEqual([
      expect.objectContaining({ candidate: name, rule: 'exact', spans: [{ start: 0, end: 12 }] }),
    ]);
    expect(checkName('Al-ice Bob', rows).verdict).toBe('no-match');
  });
  it('checks every language and retains its source even without recovered words', () => {
    const rows = [
      row('unlisted', { locale: 'de-DE', words: [] }),
      row('another', { locale: 'ja-JP' }),
      row('common', { locale: 'en-US', alwaysCheck: true }),
    ];
    const matches = checkName('unlisted-another-common', rows).matches;
    expect(matches.map(match => [match.candidate, match.locale, match.alwaysCheck])).toEqual([
      ['unlisted', 'de-DE', false], ['another', 'ja-JP', false], ['common', 'en-US', true],
    ]);
    expect(matches[0].recoveredWords).toEqual([]);
  });
  it('labels Unicode approximate without accent folding and removes the traced sequence when hashing', () => {
    expect(checkName('café', [row('cafe')])).toMatchObject({ verdict: 'no-match', unicodeApproximate: true });
    expect(checkName('CAFÉ', [row('café')])).toMatchObject({ verdict: 'restricted', unicodeApproximate: true });
    expect(checkName('ab\u00e3\u20ac\u20accd', [row('abcd')])).toMatchObject({ verdict: 'restricted', unicodeApproximate: true });
    expect(checkName('\u{1F989}me-th', [row('meth')]).matches[0].spans).toEqual([
      { start: 2, end: 4 }, { start: 5, end: 7 },
    ]);
  });
});
