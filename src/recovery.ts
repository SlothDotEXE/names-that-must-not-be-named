import type { Dataset, Locale } from './contracts';
import './recovery.css';

export function mountRecovery(root: HTMLElement, dataset: Dataset): void {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const number = (value: number): string => value.toLocaleString();
  const percentage = (part: number, total: number): string => `${(total ? part / total * 100 : 0).toFixed(1)}%`;
  const progressColor = (recovered: number, total: number): string => {
    const ratio = total ? recovered / total : 0;
    return `rgb(${Math.round(34 + 22 * ratio)}, ${Math.round(51 + 55 * ratio)}, ${Math.round(72 + 14 * ratio)})`;
  };
  root.replaceChildren();
  root.className = 'recovery-workspace';

  const overview = node('div'); overview.className = 'recovery-overview';
  const map = node('div'); map.className = 'language-treemap'; map.setAttribute('role', 'group'); map.setAttribute('aria-label', 'Language filters. Tile area represents list entries; color represents the percentage recovered.');
  const legend = node('div'); legend.className = 'recovery-legend';
  const scale = node('span'); scale.className = 'recovery-scale'; scale.setAttribute('aria-hidden', 'true');
  legend.append(node('span', 'Recovered'), node('span', '0%'), scale, node('span', '100%'));
  overview.append(map, legend);

  const explorer = node('section'); explorer.className = 'recovery-explorer'; explorer.setAttribute('aria-labelledby', 'recovery-explorer-heading');
  const heading = node('h3', 'Recovered words'); heading.id = 'recovery-explorer-heading'; heading.tabIndex = -1;
  const filterBar = node('div'); filterBar.className = 'recovery-filter-bar';
  const filter = node('span'); filter.className = 'recovery-filter'; filter.setAttribute('aria-live', 'polite'); filter.setAttribute('aria-atomic', 'true');
  const swatch = node('span'); swatch.className = 'recovery-swatch'; swatch.setAttribute('aria-hidden', 'true');
  const selectedLabel = node('span');
  const clear = node('button', '×'); clear.type = 'button'; clear.id = 'all-languages'; clear.className = 'clear-language'; clear.setAttribute('aria-label', 'Clear language filter'); clear.title = 'All languages';
  filter.append(swatch, selectedLabel); filterBar.append(filter, clear);
  const searchField = node('div'); searchField.className = 'recovery-search-field';
  const searchLabel = node('label', 'Search words'); searchLabel.htmlFor = 'recovery-search';
  const search = node('input'); search.type = 'search'; search.id = 'recovery-search'; search.autocomplete = 'off'; search.spellcheck = false;
  searchField.append(searchLabel, search);
  const reveal = node('button'); reveal.type = 'button'; reveal.className = 'secondary recovery-reveal'; reveal.setAttribute('aria-controls', 'recovery-list');
  const consent = node('p', 'Contains offensive language.'); consent.className = 'recovery-consent'; consent.id = 'recovery-consent';
  reveal.setAttribute('aria-describedby', consent.id);
  const listing = node('div'); listing.id = 'recovery-list'; listing.className = 'recovery-list'; listing.tabIndex = 0; listing.setAttribute('role', 'region'); listing.setAttribute('aria-label', 'Recovered word results');
  const status = node('p'); status.className = 'recovery-status'; status.setAttribute('role', 'status');
  const pagination = node('nav'); pagination.className = 'recovery-pagination'; pagination.setAttribute('aria-label', 'Word list pages');
  const previous = node('button', 'Previous'); previous.type = 'button'; previous.className = 'secondary';
  const pageLabel = node('span');
  const next = node('button', 'Next'); next.type = 'button'; next.className = 'secondary';
  pagination.append(previous, pageLabel, next);
  explorer.append(heading, filterBar, searchField, reveal, consent, status, listing, pagination);
  root.append(overview, explorer);

  let selected: Locale | null = null;
  let revealed = false;
  let page = 0;
  const languages = [...dataset.locales].sort((a, b) => b.total - a.total);
  const labels = new Map(dataset.locales.map(language => [language.code, language.label]));
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const words = dataset.rows.flatMap(row => row.words.map(word => ({
    word, locale: row.locale, search: `${word}\n${row.locale}\n${labels.get(row.locale)}`.toLowerCase(),
  }))).sort((a, b) => collator.compare(a.word, b.word));
  const shortLabels: Partial<Record<Locale, string>> = {
    'en-US': 'English\nUS', 'es-ES': 'Spanish\nSpain', 'es-MX': 'Spanish\nMexico',
    'pt-BR': 'Portuguese\nBrazil', 'zh-CN': 'Chinese\nSimpl.', 'zh-TW': 'Chinese\nTrad.',
  };
  const tiles = languages.map(language => {
    const button = node('button'); button.type = 'button'; button.className = 'language-tile'; button.dataset.locale = language.code;
    button.style.setProperty('--tile-color', progressColor(language.recovered, language.total));
    button.setAttribute('aria-controls', 'recovery-list');
    button.setAttribute('aria-label', `${language.label}: ${percentage(language.recovered, language.total)} recovered, ${number(language.recovered)} of ${number(language.total)} entries. Filter recovered words.`);
    button.title = `${language.label}: ${percentage(language.recovered, language.total)} recovered`;
    const name = node('span'); name.className = 'language-tile-name';
    const rate = node('span'); rate.className = 'language-tile-rate';
    button.append(name, rate); map.append(button);
    button.addEventListener('click', () => {
      selected = language.code; page = 0; render();
      if (matchMedia('(max-width: 900px)').matches) {
        heading.focus({ preventScroll: true });
        explorer.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
    return { language, button, name, rate };
  });
  const weights = [0];
  for (const tile of tiles) weights.push(weights[weights.length - 1] + tile.language.total);

  // Split near half the weight along the longer side, preserving exact areas.
  function layout(): void {
    const width = map.clientWidth;
    const height = map.clientHeight;
    if (!width || !height) return;
    function place(start: number, end: number, x: number, y: number, w: number, h: number): void {
      if (end - start === 1) {
        const tile = tiles[start];
        Object.assign(tile.button.style, { left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${w / width * 100}%`, height: `${h / height * 100}%` });
        tile.name.textContent = w >= 140 && h >= 65 ? tile.language.label : shortLabels[tile.language.code] ?? tile.language.label;
        tile.button.classList.toggle('language-tile-small', w < 100 || h < 65);
        tile.rate.textContent = w >= 100 && h >= 80 ? percentage(tile.language.recovered, tile.language.total) : '';
        return;
      }
      const total = weights[end] - weights[start];
      let split = start + 1; let best = Infinity;
      for (let i = start + 1; i < end; i++) {
        const difference = Math.abs(total / 2 - (weights[i] - weights[start]));
        if (difference < best) { best = difference; split = i; }
      }
      const fraction = total ? (weights[split] - weights[start]) / total : (split - start) / (end - start);
      if (w >= h) { place(start, split, x, y, w * fraction, h); place(split, end, x + w * fraction, y, w * (1 - fraction), h); }
      else { place(start, split, x, y, w, h * fraction); place(split, end, x, y + h * fraction, w, h * (1 - fraction)); }
    }
    if (tiles.length) place(0, tiles.length, 0, 0, width, height);
  }
  new ResizeObserver(layout).observe(map);

  function render(): void {
    const language = selected ? languages.find(item => item.code === selected)! : null;
    const counts = language ?? dataset.counts.all;
    root.style.setProperty('--selection-color', progressColor(counts.recovered, counts.total));
    root.classList.toggle('has-language', selected !== null);
    for (const tile of tiles) tile.button.setAttribute('aria-pressed', String(tile.language.code === selected));
    selectedLabel.textContent = language ? `${language.label} (${percentage(language.recovered, language.total)})` : 'All languages';
    clear.hidden = selected === null;
    reveal.textContent = revealed ? 'Hide words' : 'Show words'; reveal.setAttribute('aria-expanded', String(revealed));
    consent.hidden = revealed;
    searchField.hidden = !revealed;
    listing.hidden = !revealed;
    listing.replaceChildren(); listing.scrollTop = 0;
    const query = search.value.toLowerCase();
    const items = words.filter(item => (!selected || item.locale === selected) && item.search.includes(query));
    const pages = Math.max(1, Math.ceil(items.length / 50));
    page = Math.min(page, pages - 1);
    status.textContent = revealed ? `${number(items.length)} ${query ? 'matching ' : ''}${items.length === 1 ? 'word' : 'words'}` : '';
    if (revealed) {
      if (!items.length) listing.append(node('p', query ? 'No words match. Clear or change your search.' : 'No words recovered in this language yet.'));
      else {
        const list = node('ul'); list.className = 'recovered-words';
        for (let index = page * 50; index < Math.min(items.length, (page + 1) * 50); index++) {
          const item = items[index]; const row = node('li'); row.dataset.locale = item.locale;
          const word = node('span', item.word); word.className = 'recovery-candidate'; row.append(word);
          if (!selected) row.append(node('small', labels.get(item.locale)));
          list.append(row);
        }
        listing.append(list);
      }
    }
    pagination.hidden = !revealed || pages === 1;
    pageLabel.textContent = `${page + 1} / ${pages}`;
    previous.disabled = page === 0; next.disabled = page + 1 >= pages;
  }
  clear.addEventListener('click', () => {
    selected = null; page = 0; render();
    heading.focus({ preventScroll: true });
  });
  search.addEventListener('input', () => { page = 0; render(); });
  reveal.addEventListener('click', () => { revealed = !revealed; page = 0; render(); });
  previous.addEventListener('click', () => { if (page > 0) { page--; render(); } });
  next.addEventListener('click', () => { page++; render(); });
  render();
}
