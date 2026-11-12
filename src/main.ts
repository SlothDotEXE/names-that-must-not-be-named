import './styles.css';
import './methodology.css';
import { checkName } from './matcher';
import { mountRecovery } from './recovery';
import type { Counts, Dataset, Locale, Span } from './contracts';
import { lookupDefinition, type DictionaryDefinition } from './dictionary';

const locales: Locale[] = ['en-US', 'de-DE', 'es-ES', 'es-MX', 'fr-FR', 'it-IT', 'pl-PL', 'pt-BR', 'ar-AE', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW'];
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('name-form');
const nameInput = byId<HTMLInputElement>('name');
const result = byId<HTMLDivElement>('result');
const validation = byId<HTMLParagraphElement>('validation');
const status = byId<HTMLParagraphElement>('load-status');
const checkStatus = byId<HTMLParagraphElement>('check-status');
const recoveryRoot = byId<HTMLDivElement>('recovery-content');
let dataset: Dataset | undefined;
let revision = 0;
let checkTimer: number | undefined;
let composing = false;
let observedValue = nameInput.value;
let definitionController: AbortController | undefined;

function isCounts(value: unknown): value is Counts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const counts = value as Record<string, unknown>;
  return ['total', 'recovered', 'unrecovered'].every(k => Number.isSafeInteger(counts[k]) && (counts[k] as number) >= 0) && counts.total === (counts.recovered as number) + (counts.unrecovered as number);
}
function sameCounts(a: Counts, b: Counts): boolean {
  return a.total === b.total && a.recovered === b.recovered && a.unrecovered === b.unrecovered;
}
function validDataset(input: unknown): input is Dataset {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.buildId !== '26175237' || typeof value.snapshotId !== 'string' || !/^[0-9a-f]{64}$/.test(value.snapshotId) || typeof value.sourceDigests !== 'object' || value.sourceDigests === null || Array.isArray(value.sourceDigests) || !Object.values(value.sourceDigests).every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) || !Array.isArray(value.rows) || !Array.isArray(value.locales) || !Array.isArray(value.latinScriptLocales) || typeof value.counts !== 'object' || value.counts === null || Array.isArray(value.counts)) return false;
  const counts = value.counts as Record<string, unknown>;
  if (!isCounts(counts.all) || !isCounts(counts.latinScript)) return false;
  if (value.locales.length !== locales.length || value.latinScriptLocales.length === 0 || new Set(value.latinScriptLocales).size !== value.latinScriptLocales.length || !value.latinScriptLocales.every(c => locales.includes(c))) return false;
  const totals = new Map<Locale, Counts>(locales.map(code => [code, { total: 0, recovered: 0, unrecovered: 0 }]));
  const seenLocales = new Set<string>();
  for (const item of value.locales) {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || typeof item.code !== 'string' || !locales.includes(item.code as Locale) || seenLocales.has(item.code) || typeof item.label !== 'string' || !item.label) return false;
    seenLocales.add(item.code);
    if (!isCounts(item)) return false;
  }
  const hashes = new Set<string>();
  const indices = new Set<number>();
  for (const row of value.rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row) || !Number.isSafeInteger(row.rowIndex) || (row.rowIndex as number) < 0 || indices.has(row.rowIndex as number) || typeof row.hash !== 'string' || !/^[0-9a-f]{32}$/.test(row.hash) || hashes.has(row.hash) || typeof row.locale !== 'string' || !locales.includes(row.locale as Locale) || typeof row.alwaysCheck !== 'boolean' || !Array.isArray(row.words) || !row.words.every((word: unknown) => typeof word === 'string')) return false;
    indices.add(row.rowIndex as number); hashes.add(row.hash);
    const count = totals.get(row.locale as Locale)!;
    count.total++; if (row.words.length) count.recovered++; else count.unrecovered++;
  }
  const sum = (codes: Locale[]): Counts => codes.reduce((a, code) => { const b = totals.get(code)!; return { total: a.total + b.total, recovered: a.recovered + b.recovered, unrecovered: a.unrecovered + b.unrecovered }; }, { total: 0, recovered: 0, unrecovered: 0 });
  return value.rows.length > 0 && value.locales.every(item => sameCounts(item as Counts, totals.get(item.code as Locale)!)) && sameCounts(counts.all, sum(locales)) && sameCounts(counts.latinScript, sum(value.latinScriptLocales as Locale[]));
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
function clearResult(): void {
  result.replaceChildren(); delete result.dataset.verdict; validation.textContent = '';
  nameInput.removeAttribute('aria-invalid');
  checkStatus.textContent = '';
}
function highlighted(text: string, spans: Span[]): HTMLElement {
  const line = element('p'); line.className = 'highlight-line';
  const selected = spans.filter(span => span.start < span.end).sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  for (let i = 0; i < selected.length; i++) {
    const start = Math.max(0, Math.min(text.length, selected[i].start));
    let end = Math.max(start, Math.min(text.length, selected[i].end));
    while (i + 1 < selected.length && selected[i + 1].start <= end) { i++; end = Math.max(end, Math.min(text.length, selected[i].end)); }
    line.append(document.createTextNode(text.slice(cursor, start)));
    const mark = element('mark', text.slice(start, end)); line.append(mark); cursor = end;
  }
  line.append(document.createTextNode(text.slice(cursor))); return line;
}
function invalidateCheck(): void {
  revision++;
  clearTimeout(checkTimer);
  checkTimer = undefined;
  definitionController?.abort();
  definitionController = undefined;
  clearResult();
}

function scheduleCheck(): void {
  const name = nameInput.value;
  observedValue = name;
  invalidateCheck();
  if (composing || !name.trim()) return;
  if (name.length > 128) {
    validation.textContent = 'This name exceeds the tool’s 128 UTF-16 unit limit.';
    nameInput.setAttribute('aria-invalid', 'true');
    return;
  }
  if (!dataset) return;
  const capturedRevision = revision;
  checkTimer = window.setTimeout(() => renderCheck(name, capturedRevision), 250);
}

function renderCheck(name: string, capturedRevision: number): void {
  if (capturedRevision !== revision || composing || nameInput.value !== name || !dataset) return;
  checkTimer = undefined;
  const checked = checkName(name, dataset.rows);
  const definitionRows = new Map<string, HTMLLIElement>();
  result.dataset.verdict = checked.unicodeApproximate ? 'approximate' : checked.verdict;
  result.append(element('h2', checked.verdict === 'restricted' ? 'Matches found' : 'No matches found'));
  if (checked.unicodeApproximate) {
    const notice = element('p', 'Approximate check: the game may handle non-ASCII characters differently.');
    notice.className = 'notice'; result.append(notice);
  }
  if (checked.verdict === 'restricted') {
    const spans = checked.matches.flatMap(match => match.spans);
    result.append(highlighted(name, spans), element('p', 'Matching text:'));
    const list = element('ol'); list.className = 'matches';
    for (const match of checked.matches) {
      const item = element('li');
      item.append(element('strong', match.candidate || '(empty fragment)'));
      const language = element('span', dataset.locales.find(l => l.code === match.locale)?.label ?? match.locale);
      language.className = 'match-language';
      if (match.alwaysCheck) language.append(element('small', 'Applies in every language'));
      item.append(language);
      list.append(item);
      const key = match.candidate.trim().toLowerCase();
      if (key && !definitionRows.has(key)) definitionRows.set(key, item);
    }
    result.append(list, element('p', 'Matches may not apply to every language or naming context.'));
  } else {
    result.append(element('p', 'Nothing matched the built-in lists in any language.'));
  }
  checkStatus.textContent = checked.verdict === 'restricted'
    ? `Matches found. ${checked.matches.length} matching fragment${checked.matches.length === 1 ? '' : 's'}.`
    : 'No matches found.';
  if (checked.unicodeApproximate) checkStatus.append(' Approximate check: the game may handle non-ASCII characters differently.');
  if (definitionRows.size) {
    definitionController = new AbortController();
    void enrichMatches(capturedRevision, definitionRows, definitionController.signal);
  }
}

function externalLink(text: string, url: string): HTMLAnchorElement {
  const link = element('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function appendDefinition(row: HTMLLIElement, definition: DictionaryDefinition): void {
  const gloss = element('p', `English definition: ${definition.text}`);
  gloss.className = 'match-definition';
  const credit = element('p');
  credit.className = 'definition-credit';
  if (definition.sourceUrl) credit.append(externalLink('Source', definition.sourceUrl), ' via ');
  credit.append(externalLink('Dictionary API', 'https://dictionaryapi.dev/'));
  if (definition.license) {
    credit.append(' (');
    credit.append(definition.license.url
      ? externalLink(definition.license.name, definition.license.url)
      : document.createTextNode(definition.license.name));
    credit.append(')');
  }
  row.append(gloss, credit);
}

async function enrichMatches(capturedRevision: number, rows: Map<string, HTMLLIElement>, signal: AbortSignal): Promise<void> {
  for (const [word, row] of rows) {
    if (capturedRevision !== revision || signal.aborted) return;
    const definition = await lookupDefinition(word, signal);
    if (capturedRevision !== revision || signal.aborted) return;
    if (definition && row.isConnected) appendDefinition(row, definition);
  }
}

nameInput.addEventListener('input', scheduleCheck);
nameInput.addEventListener('compositionstart', () => {
  composing = true;
  observedValue = nameInput.value;
  invalidateCheck();
});
nameInput.addEventListener('compositionend', () => {
  composing = false;
  scheduleCheck();
});
nameInput.addEventListener('change', () => {
  if (nameInput.value !== observedValue) scheduleCheck();
});
form.addEventListener('submit', event => event.preventDefault());

async function start(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/dataset.json`);
    if (!response.ok) throw new Error('Dataset request failed');
    const data: unknown = await response.json();
    if (!validDataset(data)) throw new Error('Invalid dataset');
    dataset = data;
    status.textContent = '';
    mountRecovery(recoveryRoot, data);
    scheduleCheck();
  } catch {
    dataset = undefined;
    invalidateCheck();
    status.textContent = 'Unable to load restriction data. Reload to try again.';
    status.classList.add('load-error');
    recoveryRoot.textContent = 'Unable to load restriction data. Reload to try again.';
  }
}
void start();
