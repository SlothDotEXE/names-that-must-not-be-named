import type { Dataset, HashRow } from './contracts';

export function mountRecovery(root: HTMLElement, dataset: Dataset): void {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;
  };
  root.replaceChildren();
  root.append(node('p', `Bundled build ${dataset.buildId} · Dataset fingerprint ${dataset.snapshotId.slice(0, 12)}`));
  const label = node('label', 'Recovery scope'); label.htmlFor = 'recovery-scope';
  const scope = node('select'); scope.id = 'recovery-scope';
  for (const [value, text] of [['all', 'All locales'], ['latin-script-all', 'Combined Latin-script locales'], ...dataset.locales.map(l => [l.code, l.label])]) {
    const option = node('option', text); option.value = value; scope.append(option);
  }
  const note = node('p'); note.className = 'hint';
  const counts = node('div'); counts.className = 'stats'; counts.setAttribute('aria-live', 'polite');
  const breakdownTitle = node('h3', 'Locale breakdown');
  const breakdownWrap = node('div'); breakdownWrap.className = 'table-wrap';
  const breakdown = node('table');
  const caption = node('caption', 'All bundled rows by game locale');
  const thead = node('thead'); const headers = node('tr');
  for (const text of ['Game locale', 'Total hashes', 'Recovered', 'Unrecovered']) headers.append(node('th', text));
  thead.append(headers); const tbody = node('tbody');
  for (const entry of dataset.locales) {
    const tr = node('tr'); const th = node('th', `${entry.label} (${entry.code})`); th.scope = 'row'; tr.append(th);
    for (const value of [entry.total, entry.recovered, entry.unrecovered]) tr.append(node('td', value.toLocaleString()));
    tbody.append(tr);
  }
  breakdown.append(caption, thead, tbody); breakdownWrap.append(breakdown);
  const explorerTitle = node('h3', 'Explore rows');
  const tabs = node('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Recovery status');
  const recoveredTab = node('button', 'Recovered'); recoveredTab.type = 'button'; recoveredTab.id = 'recovered-tab'; recoveredTab.setAttribute('role', 'tab');
  const unresolvedTab = node('button', 'Unrecovered'); unresolvedTab.type = 'button'; unresolvedTab.id = 'unrecovered-tab'; unresolvedTab.setAttribute('role', 'tab');
  tabs.append(recoveredTab, unresolvedTab);
  const reveal = node('button', 'Show recovered words (contains offensive terms)'); reveal.type = 'button'; reveal.className = 'secondary';
  const searchLabel = node('label', 'Search words or hashes'); searchLabel.htmlFor = 'recovery-search';
  const search = node('input'); search.type = 'search'; search.id = 'recovery-search'; search.autocomplete = 'off';
  const listing = node('div'); listing.id = 'recovery-list'; listing.setAttribute('role', 'tabpanel'); listing.setAttribute('aria-live', 'polite');
  const pagination = node('div'); pagination.className = 'pagination';
  const previous = node('button', 'Previous'); previous.type = 'button'; previous.className = 'secondary';
  const pageLabel = node('span');
  const next = node('button', 'Next'); next.type = 'button'; next.className = 'secondary';
  pagination.append(previous, pageLabel, next);
  const downloadsTitle = node('h3', 'Download this scope');
  const downloads = node('ul'); downloads.className = 'downloads';
  root.append(label, scope, note, counts, breakdownTitle, breakdownWrap, explorerTitle, tabs, reveal, searchLabel, search, listing, pagination, downloadsTitle, downloads);
  let tab: 'recovered' | 'unrecovered' = 'recovered';
  let revealed = false;
  let page = 0;
  const base = `${import.meta.env.BASE_URL}data/`;
  function render(): void {
    const selected = scope.value;
    const rows = dataset.rows.filter(row => selected === 'all' || (selected === 'latin-script-all' ? dataset.latinScriptLocales.includes(row.locale) : row.locale === selected));
    const recovered = rows.filter(row => row.words.length > 0).length;
    note.textContent = selected === 'latin-script-all' ? 'Combined Latin-script locales overlap with the individual locales; do not add them to the overall total. Locale is the game’s classification, not an inference about unknown words.' : 'Locale is the game’s classification, not an inference about unknown words. Recovery scope does not change the checker language.';
    counts.replaceChildren();
    for (const [name, value] of [['Total hashes', rows.length], ['Recovered hashes', recovered], ['Unrecovered hashes', rows.length - recovered]] as const) {
      const stat = node('div'); stat.append(node('strong', value.toLocaleString()), node('span', name)); counts.append(stat);
    }
    recoveredTab.setAttribute('aria-selected', String(tab === 'recovered')); unresolvedTab.setAttribute('aria-selected', String(tab === 'unrecovered'));
    recoveredTab.tabIndex = tab === 'recovered' ? 0 : -1; unresolvedTab.tabIndex = tab === 'unrecovered' ? 0 : -1;
    listing.setAttribute('aria-labelledby', tab === 'recovered' ? recoveredTab.id : unresolvedTab.id);
    reveal.hidden = tab !== 'recovered'; reveal.textContent = revealed ? 'Hide recovered words' : 'Show recovered words (contains offensive terms)'; reveal.setAttribute('aria-expanded', String(revealed));
    searchLabel.hidden = tab === 'recovered' && !revealed; search.hidden = searchLabel.hidden;
    listing.replaceChildren();
    const query = search.value.toLowerCase();
    type Item = { row: HashRow; word?: string };
    const items: Item[] = [];
    for (const row of rows) {
      if (tab === 'recovered') {
        for (const word of row.words) if (word.toLowerCase().includes(query) || row.hash.includes(query) || row.locale.toLowerCase().includes(query)) items.push({ row, word });
      } else if (!row.words.length && (row.hash.includes(query) || row.locale.toLowerCase().includes(query))) items.push({ row });
    }
    const visible = tab !== 'recovered' || revealed;
    pagination.hidden = !visible;
    if (!visible) listing.append(node('p', 'Recovered words are hidden until you choose to show them.'));
    else if (!items.length) listing.append(node('p', 'No rows match this search.'));
    else {
      const wrap = node('div'); wrap.className = 'table-wrap'; const table = node('table'); const head = node('thead'); const tr = node('tr');
      for (const text of tab === 'recovered' ? ['Verified candidate', 'Locale', 'Hash'] : ['Hash', 'Locale']) tr.append(node('th', text));
      head.append(tr); const body = node('tbody');
      for (const item of items.slice(page * 50, page * 50 + 50)) {
        const row = node('tr');
        if (tab === 'recovered') row.append(node('td', item.word));
        const hash = node('td'); hash.append(node('code', item.row.hash));
        const localeCell = node('td', item.row.locale);
        if (tab === 'recovered') row.append(localeCell, hash); else row.append(hash, localeCell);
        body.append(row);
      }
      table.append(head, body); wrap.append(table); listing.append(wrap);
    }
    const pages = Math.max(1, Math.ceil(items.length / 50));
    pageLabel.textContent = `Page ${page + 1} of ${pages} · ${items.length.toLocaleString()} ${tab === 'recovered' ? 'candidates' : 'rows'}`;
    previous.disabled = page === 0; next.disabled = page + 1 >= pages;
    downloads.replaceChildren();
    for (const [text, path] of [
      ['Recovered candidates (CSV)', `language-segments/${selected}/recovered-words.csv`],
      ['Recovered candidates (text)', `language-segments/${selected}/recovered-words.txt`],
      ['Unresolved rows (CSV)', `language-segments/${selected}/unresolved-rows.csv`],
      ['Unresolved hashes (Hashcat)', `language-segments/${selected}/unresolved.hashcat`],
      ['Full bundled hash list (CSV)', 'restricted-word-hashes.csv'],
    ]) {
      const li = node('li'); const link = node('a', text); link.href = base + path; link.setAttribute('download', ''); li.append(link); downloads.append(li);
    }
  }
  scope.addEventListener('change', () => { page = 0; render(); });
  search.addEventListener('input', () => { page = 0; render(); });
  for (const [button, value] of [[recoveredTab, 'recovered'], [unresolvedTab, 'unrecovered']] as const) button.addEventListener('click', () => { tab = value; page = 0; render(); });
  tabs.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); tab = tab === 'recovered' ? 'unrecovered' : 'recovered'; page = 0; render(); (tab === 'recovered' ? recoveredTab : unresolvedTab).focus();
  });
  reveal.addEventListener('click', () => { revealed = !revealed; page = 0; render(); });
  previous.addEventListener('click', () => { if (page > 0) { page--; render(); } });
  next.addEventListener('click', () => { page++; render(); });
  render();
}
