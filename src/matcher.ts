import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { HashRow, NameMatch, NameRequest, NameResult, Span } from './contracts';

type Field = Span['field'];
type Origin = { field: Field; offset: number } | null;
type MappedText = { text: string; origins: Origin[] };

function fieldText(text: string, field: Field): MappedText {
  return { text, origins: Array.from({ length: text.length }, (_, offset) => ({ field, offset })) };
}

function spansFor(origins: Origin[]): Span[] {
  const spans: Span[] = [];
  for (const origin of origins) {
    if (!origin) continue;
    const previous = spans[spans.length - 1];
    if (previous && previous.field === origin.field && previous.end === origin.offset) {
      previous.end++;
    } else {
      spans.push({ field: origin.field, start: origin.offset, end: origin.offset + 1 });
    }
  }
  return spans;
}

export function checkName(request: NameRequest, rows: readonly HashRow[]): NameResult {
  const active = new Map<string, HashRow>();
  for (const row of rows) {
    if (row.alwaysCheck || row.locale === request.locale) active.set(row.hash, row);
  }
  const matches: NameMatch[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();

  function check(candidate: string, origins: Origin[], rule: NameMatch['rule']): void {
    const normalized = candidate.toLowerCase().replaceAll('\u00e3\u20ac\u20ac', '');
    const hash = bytesToHex(md5(encoder.encode('phoenix' + normalized)));
    const row = active.get(hash);
    if (!row) return;
    const spans = spansFor(origins);
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
          check(replaced.slice(token.start, token.end), input.origins.slice(token.start, token.end), 'short-token');
        }
      }
    }
    let compact = '';
    const origins: Origin[] = [];
    for (let i = 0; i < replaced.length; i++) {
      if (replaced[i] !== ' ') {
        compact += replaced[i];
        origins.push(input.origins[i]);
      }
    }
    if (compact.length <= 3) {
      check(compact, origins, 'whole');
    } else {
      for (let i = 0; i <= compact.length - 4; i++) {
        for (let length = 4; length <= compact.length - i; length++) {
          check(compact.slice(i, i + length), origins.slice(i, i + length), 'substring');
        }
      }
    }
  }

  const fields = request.kind === 'character' ? [request.firstName, request.lastName] : [request.name];
  const unicodeApproximate = fields.some(text => /[^\x00-\x7f]/.test(text));
  if (request.kind === 'character') {
    const first = fieldText(request.firstName, 'firstName');
    const last = fieldText(request.lastName, 'lastName');
    const full = request.firstName + ' ' + request.lastName;
    if (full.length) check(full, [...first.origins, null, ...last.origins], 'full-name');
    substring(last);
    substring(first);
  } else {
    substring(fieldText(request.name, 'name'));
  }
  return { verdict: matches.length ? 'restricted' : 'no-match', unicodeApproximate, matches };
}
