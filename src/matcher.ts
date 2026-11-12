import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { HashRow, NameMatch, NameResult, Span } from './contracts';

type MappedText = { text: string; origins: number[] };

function spansFor(origins: readonly number[], start: number, end: number): Span[] {
  const spans: Span[] = [];
  for (let i = start; i < end; i++) {
    const origin = origins[i];
    const previous = spans[spans.length - 1];
    if (previous && previous.end === origin) {
      previous.end++;
    } else {
      spans.push({ start: origin, end: origin + 1 });
    }
  }
  return spans;
}

export function checkName(name: string, rows: readonly HashRow[]): NameResult {
  const active = new Map<string, HashRow>();
  for (const row of rows) active.set(row.hash, row);
  const matches: NameMatch[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();

  function check(candidate: string, origins: readonly number[], start: number, end: number, rule: NameMatch['rule']): void {
    const normalized = candidate.toLowerCase().replaceAll('\u00e3\u20ac\u20ac', '');
    const hash = bytesToHex(md5(encoder.encode('phoenix' + normalized)));
    const row = active.get(hash);
    if (!row) return;
    const spans = spansFor(origins, start, end);
    const key = JSON.stringify([hash, spans]);
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ hash, candidate, locale: row.locale, alwaysCheck: row.alwaysCheck, rule, spans, recoveredWords: row.words });
  }

  function substring(input: MappedText): void {
    if (!input.text.length) return;
    const replaced = input.text.replace(/[-'`]/g, ' ');
    const tokens: { start: number; end: number }[] = [];
    let start = 0;
    while (start < replaced.length) {
      if (replaced[start] === ' ') { start++; continue; }
      let end = start + 1;
      while (end < replaced.length && replaced[end] !== ' ') end++;
      tokens.push({ start, end });
      start = end;
    }
    if (tokens.length > 1) {
      for (const token of tokens) {
        if (token.end - token.start <= 3) {
          check(replaced.slice(token.start, token.end), input.origins, token.start, token.end, 'short-token');
        }
      }
    }
    let compact = '';
    const origins: number[] = [];
    for (let i = 0; i < replaced.length; i++) {
      if (replaced[i] !== ' ') {
        compact += replaced[i];
        origins.push(input.origins[i]);
      }
    }
    if (compact.length <= 3) {
      check(compact, origins, 0, origins.length, 'whole');
    } else {
      for (let i = 0; i <= compact.length - 4; i++) {
        for (let length = 4; length <= compact.length - i; length++) {
          check(compact.slice(i, i + length), origins, i, i + length, 'substring');
        }
      }
    }
  }

  const unicodeApproximate = /[^\x00-\x7f]/.test(name);
  if (name.length) {
    const input: MappedText = { text: name, origins: Array.from({ length: name.length }, (_, offset) => offset) };
    check(name, input.origins, 0, name.length, 'exact');
    substring(input);
  }
  return { verdict: matches.length ? 'restricted' : 'no-match', unicodeApproximate, matches };
}
