import './styles.css';
import { checkName } from './matcher';
import { mountRecovery } from './recovery';
import type { Counts, Dataset, Locale, NameRequest, Span } from './contracts';

const locales: Locale[] = ['en-US', 'de-DE', 'es-ES', 'es-MX', 'fr-FR', 'it-IT', 'pl-PL', 'pt-BR', 'ar-AE', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW'];
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('name-form');
const first = byId<HTMLInputElement>('first-name');
const last = byId<HTMLInputElement>('last-name');
const beast = byId<HTMLInputElement>('beast-name');
const locale = byId<HTMLSelectElement>('checker-locale');
const button = byId<HTMLButtonElement>('check-button');
const result = byId<HTMLDivElement>('result');
const validation = byId<HTMLParagraphElement>('validation');
const status = byId<HTMLParagraphElement>('load-status');
let dataset: Dataset | undefined;

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
function clearResult(): void { result.replaceChildren(); validation.textContent = ''; }
function selectedKind(): 'character' | 'beast' { return (form.elements.namedItem('kind') as RadioNodeList).value === 'beast' ? 'beast' : 'character'; }
function updateMode(): void {
  const isBeast = selectedKind() === 'beast';
  byId('character-fields').hidden = isBeast; byId('beast-fields').hidden = !isBeast;
  first.required = !isBeast; beast.required = isBeast;
}
function highlighted(field: Span['field'], text: string, spans: Span[]): HTMLElement {
  const line = element('p'); line.className = 'highlight-line';
  line.append(element('strong', field === 'firstName' ? 'First name: ' : field === 'lastName' ? 'Last name: ' : 'Name: '));
  const selected = spans.filter(span => span.field === field && span.start < span.end).sort((a, b) => a.start - b.start || a.end - b.end);
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
form.addEventListener('input', clearResult);
form.addEventListener('change', () => { clearResult(); updateMode(); });
form.addEventListener('submit', event => {
  event.preventDefault(); clearResult();
  if (!dataset) return;
  const kind = selectedKind();
  const fields = kind === 'character' ? [first, last] : [beast];
  const required = kind === 'character' ? first : beast;
  if (!required.value.trim()) { validation.textContent = 'Enter a name in the required field.'; required.focus(); return; }
  const tooLong = fields.find(field => field.value.length > 128);
  if (tooLong) { validation.textContent = 'Each field must be at most 128 UTF-16 units for this tool.'; tooLong.focus(); return; }
  const request: NameRequest = kind === 'character' ? { kind, firstName: first.value, lastName: last.value, locale: locale.value as Locale } : { kind, name: beast.value, locale: locale.value as Locale };
  const checked = checkName(request, dataset.rows);
  result.append(element('h3', checked.verdict === 'restricted' ? 'Restricted by the bundled list' : 'No restriction found in the bundled list'));
  if (checked.unicodeApproximate) { const notice = element('p', 'Approximate Unicode check: native Unicode casing and indexing may differ, so this prediction is approximate.'); notice.className = 'notice'; result.append(notice); }
  if (checked.verdict === 'no-match') {
    result.append(element('p', checked.unicodeApproximate ? 'No bundled-list match was found in this approximate check; the game may use an updated online list or other naming rules.' : 'Likely passes this restriction check; the game may use an updated online list or other naming rules.'));
    return;
  }
  const spans = checked.matches.flatMap(match => match.spans);
  const highlights = element('div'); highlights.className = 'highlights';
  if (request.kind === 'character') { highlights.append(highlighted('firstName', request.firstName, spans)); if (request.lastName) highlights.append(highlighted('lastName', request.lastName, spans)); }
  else highlights.append(highlighted('name', request.name, spans));
  result.append(highlights, element('p', 'Matching fragments:'));
  const list = element('ol'); list.className = 'matches';
  for (const match of checked.matches) {
    const item = element('li');
    item.append(element('strong', match.candidate || '(empty fragment)'), document.createTextNode(` — ${dataset.locales.find(l => l.code === match.locale)?.label ?? match.locale} (${match.locale}); ${match.alwaysCheck ? 'always checked' : 'locale-specific'}; ${match.rule}; hash `), element('code', match.hash));
    if (match.recoveredWords.length) item.append(element('p', `Published candidate metadata: ${match.recoveredWords.join(', ')}`));
    list.append(item);
  }
  result.append(list, element('p', 'The game may use an updated online list or other naming rules.'));
});

async function start(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/dataset.json`);
    if (!response.ok) throw new Error('Dataset request failed');
    const data: unknown = await response.json();
    if (!validDataset(data)) throw new Error('Invalid dataset');
    dataset = data;
    for (const entry of data.locales) { const option = element('option', entry.label); option.value = entry.code; locale.append(option); }
    locale.value = 'en-US'; locale.disabled = false; button.disabled = false;
    status.textContent = 'Restriction data loaded.';
    mountRecovery(byId('recovery-content'), data);
  } catch {
    dataset = undefined; locale.disabled = true; button.disabled = true;
    status.textContent = 'Unable to load restriction data. Reload to try again.';
    byId('recovery-content').textContent = 'Unable to load restriction data. Reload to try again.';
  }
}
void start();
