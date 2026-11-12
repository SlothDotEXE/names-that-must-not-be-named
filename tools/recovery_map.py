#!/usr/bin/env python3
"""Render the README recovery map from the same dataset as the site."""
import argparse
import json
import math
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public/data/dataset.json'
OUTPUT = ROOT / 'research/recovery.svg'


def percentage(item):
    return f"{item['recovered'] / item['total'] * 100 if item['total'] else 0:.1f}%"


def color(item):
    ratio = item['recovered'] / item['total'] if item['total'] else 0
    # JavaScript Math.round, used by the interactive map, rounds positive halves up.
    return '#%02x%02x%02x' % tuple(math.floor(base + delta * ratio + 0.5) for base, delta in ((34, 22), (51, 55), (72, 14)))


def layout(items, x, y, width, height):
    """Use the site's longest-side, nearest-half recursive partition."""
    if len(items) == 1:
        return [(items[0], x, y, width, height)]
    total = sum(item['total'] for item in items)
    running = 0
    split = 1
    best = float('inf')
    for index in range(1, len(items)):
        running += items[index - 1]['total']
        difference = abs(total / 2 - running)
        if difference < best:
            best, split = difference, index
    fraction = sum(item['total'] for item in items[:split]) / total if total else split / len(items)
    if width >= height:
        return layout(items[:split], x, y, width * fraction, height) + layout(items[split:], x + width * fraction, y, width * (1 - fraction), height)
    return layout(items[:split], x, y, width, height * fraction) + layout(items[split:], x, y + height * fraction, width, height * (1 - fraction))


def render(dataset):
    locales = dataset['locales']
    overall = dataset['counts']['all']
    for item in [overall, *locales]:
        if any(not isinstance(item[key], int) or isinstance(item[key], bool) or item[key] < 0 for key in ('total', 'recovered', 'unrecovered')) or item['recovered'] + item['unrecovered'] != item['total']:
            raise ValueError('Invalid recovery counts in dataset')
    if not locales or any(sum(item[key] for item in locales) != overall[key] for key in ('total', 'recovered', 'unrecovered')):
        raise ValueError('Locale counts do not match overall counts')
    languages = sorted(locales, key=lambda item: -item['total'])
    description = (f"{overall['recovered']:,} of {overall['total']:,} entries recovered; "
                   f"{overall['unrecovered']:,} remaining. Tile area represents entries and color represents recovery percentage. "
                   + '; '.join(f"{item['label']}: {percentage(item)} recovered" for item in languages) + '.')
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="630" viewBox="0 0 900 630" role="img" aria-labelledby="title description">',
        '  <title id="title">Restricted word recovery by language</title>',
        f'  <desc id="description">{escape(description)}</desc>',
        '  <defs><linearGradient id="scale"><stop stop-color="#223348"/><stop offset="1" stop-color="#386a56"/></linearGradient></defs>',
        '  <rect width="900" height="630" fill="#0c1422"/>',
        '  <text x="28" y="43" fill="#eee5d2" font-family="Palatino, Georgia, serif" font-size="27">Recovery by language</text>',
        f'  <text x="28" y="70" fill="#a9b8c5" font-family="Segoe UI, Arial, sans-serif" font-size="15">{overall["recovered"]:,} recovered  /  {overall["unrecovered"]:,} remaining  /  {overall["total"]:,} total</text>',
    ]
    short = {'en-US': 'English\nUS', 'es-ES': 'Spanish\nSpain', 'es-MX': 'Spanish\nMexico', 'pt-BR': 'Portuguese\nBrazil', 'zh-CN': 'Chinese\nSimplified', 'zh-TW': 'Chinese\nTraditional'}
    for item, x, y, w, h in layout(languages, 28, 94, 844, 480):
        out.append(f'  <rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="{color(item)}" stroke="#0c1422" stroke-width="3"/>')
        label = item['label'] if w >= 170 else short.get(item['code'], item['label'])
        lines = label.split('\n')
        # Keep every language named; abbreviate the longest regional qualifiers.
        lines = [line if len(line) * 6.5 <= w - 16 else {'Simplified': 'Simpl.', 'Traditional': 'Trad.'}.get(line, item['code']) for line in lines]
        for index, line in enumerate(lines):
            out.append(f'  <text x="{x + 8:.3f}" y="{y + 20 + index * 16:.3f}" fill="#eee5d2" font-family="Segoe UI, Arial, sans-serif" font-size="13">{escape(line)}</text>')
        if h >= 28 + len(lines) * 16:
            out.append(f'  <text x="{x + 8:.3f}" y="{y + 24 + len(lines) * 16:.3f}" fill="#eee5d2" font-family="Segoe UI, Arial, sans-serif" font-size="12">{percentage(item)}</text>')
    out.extend([
        '  <text x="28" y="605" fill="#a9b8c5" font-family="Segoe UI, Arial, sans-serif" font-size="13">Tile area: entries</text>',
        '  <text x="343" y="605" fill="#a9b8c5" font-family="Segoe UI, Arial, sans-serif" font-size="13">Recovery</text>',
        '  <text x="405" y="605" fill="#a9b8c5" font-family="Segoe UI, Arial, sans-serif" font-size="13">0%</text>',
        '  <rect x="434" y="595" width="105" height="9" fill="url(#scale)"/>',
        '  <text x="545" y="605" fill="#a9b8c5" font-family="Segoe UI, Arial, sans-serif" font-size="13">100%</text>',
        '</svg>',
    ])
    return '\n'.join(out) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the SVG is missing or stale; do not rewrite it')
    args = parser.parse_args()
    content = render(json.loads(DATA.read_text(encoding='utf-8')))
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding='utf-8') != content:
            parser.exit(1, f'{OUTPUT.relative_to(ROOT)} is missing or stale; run npm run data:build\n')
    else:
        OUTPUT.write_text(content, encoding='utf-8')


if __name__ == '__main__':
    main()
