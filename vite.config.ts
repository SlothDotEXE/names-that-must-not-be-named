import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'archive-page-chrome',
    transformIndexHtml(html) {
      const header = readFileSync(new URL('./src/site-header.html', import.meta.url), 'utf8');
      const footer = readFileSync(new URL('./src/site-footer.html', import.meta.url), 'utf8');
      return html.replace('<!-- site-header -->', header).replace('<!-- site-footer -->', footer);
    },
  }],
});
