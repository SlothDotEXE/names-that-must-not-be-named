# Help recover the remaining words

The checker already uses every hash. Cracking adds readable words to the recovery browser; it does not unlock extra matching coverage.

## Check existing work first

The [README heatmap](../README.md) shows **imported** results. Run `npm run data:build` for current counts and remaining targets in `public/data/language-segments/summary.json`.

The [coverage ledger](coverage.json) keeps exact masks, flags, target checksums and dictionary versions in one place. It includes the reconciled research results as of **12 November 2026**: **6,019 verified recoveries and 1,595 remaining hashes**, including the completed longer Unicode queue. No recorded session is pending merge. Completion evidence remains qualified below; saved matches alone do not prove exhaustive traversal.

| Search | Scope | Recorded coverage |
| --- | --- | --- |
| Lowercase ASCII + digits, lengths 1–4; lowercase length 5 | All locales | Completed enumeration recorded; original command not retained |
| `words_alpha.txt`, `words.txt`, initial profanity lists | All locales | Direct dictionary passes completed; versions/checksums in ledger |
| Lowercase ASCII, lengths 6–10 | Latin-script locales | User supplied final `Exhausted` status; saved matches verified |
| Lowercase ASCII + digits, lengths 5–8 | Latin-script locales | User-reported complete, part of the combined queue |
| Lowercase ASCII + digits + punctuation/space, lengths 1–7 | Latin-script locales | User-reported complete; no final traversal log supplied |
| Pinned FrequencyWords dictionaries | All locales | Completed; original and lowercase candidates, not generated phrases |
| Short Unicode byte masks | All locales | Observed `Exhausted`: kana 1–4 units, CJK/Hangul 1–2, Russian/Arabic 1–5 |
| Longer Unicode queue | All-locales unresolved snapshot, 2,179 targets | Retained log confirms all 7 masks exhausted: kana 5, Hangul/CJK 3, Russian/Arabic 6–7; 584 new recoveries merged |

The Latin-script group includes English, German, both Spanish lists, French, Italian, Polish and Brazilian Portuguese. It overlaps those individual exports. Every coverage claim applies only to its recorded target snapshot: a completed Latin-only search says nothing about targets outside that input. Locale does **not** prove a word's alphabet. Unicode lengths above count repeated byte-pattern units, not arbitrary Unicode characters; the ledger contains the exact masks.

**Useful uncompleted work:** lowercase letters + digits at length 9; new dictionaries or phrase/accent rules; kana at six units (prepared but unrun; only speed-tested). Lowercase length 11 and punctuation/space length 8 were proposed but can be very expensive. None is a promise of recovery or a confirmed free assignment—check issues and the ledger first. A speed benchmark, runtime cap, partial output or `Cracked` target set is not proof that an entire candidate space was exhausted.

## Claim a search

[Open an issue](https://github.com/SlothDotEXE/names-that-must-not-be-named/issues) before a long run. Include:

- Target scope and SHA-256 of the exact input; dataset `snapshotId`.
- Hashcat version, full command, masks/custom charsets, lengths and any `--skip`/`--limit` partition.
- Dictionary URL/version/SHA-256, normalization and rule files, if used.
- Owner and state: planned, running, partial, exhausted, or all targets recovered.

Afterward, post the final status and completed queue entries, even if there are no new words. Record uncompleted ranges and rejected candidates. Update `research/coverage.json` with the result and issue link; only claim the scope and ranges actually searched. Do not add game-code dumps, wordlist copies, potfiles or terminal transcripts to the repo. Before sharing evidence, remove usernames, home-directory paths and other personal-machine details; retain target/mask digests and useful completion facts.

## Prepare a stable input

Requirements: Node.js 24+, npm, Python 3 and Hashcat. From the repo root:

```sh
npm ci
npm run data:build
mkdir -p .cracking
cp public/data/language-segments/latin-script-all/unresolved.hashcat .cracking/latin-input.hashcat
sha256sum .cracking/latin-input.hashcat
```

Use `all` or an individual locale such as `ja-JP` instead of `latin-script-all` when appropriate. Generated inputs contain only currently unresolved `hash:phoenix` entries. `.cracking/` is ignored local state. Use a fresh filename for each search; never overwrite a running or paused session's target/mask files. Regenerating `public/data/` is safe only because the run uses its separate snapshot.

## Run an agreed search

Hashcat **mode 20** is `md5($salt.$pass)`: the salt is already in each input row. Do not prepend `phoenix` to candidates or use mode 0/10 with these files. Hashcat does not lowercase words for you. `?l` means lowercase ASCII, `?d` digits, and `?s` ASCII punctuation **including space**.

For example, after claiming the uncompleted length-nine alphanumeric space:

```sh
hashcat -m 20 -a 3 -O -w 2 \
  -1 '?l?d' \
  --session latin-alnum9 \
  --restore-file-path "$PWD/.cracking/latin-alnum9.restore" \
  --potfile-path "$PWD/.cracking/recovery.potfile" \
  --outfile "$PWD/.cracking/new-matches.txt" --outfile-format 1,2 \
  --status --status-timer 30 \
  .cracking/latin-input.hashcat '?1?1?1?1?1?1?1?1?1'
```

This is an example command, **not a completed search**. Check `hashcat -I` for devices; historical `-d 1` is machine-specific. `-O` has a byte-length limit: check Hashcat's displayed supported lengths before longer candidates. Unicode byte masks require `--hex-charset`; they do not cover every word in a language. The importer rejects invalid UTF-8 candidates.

Press `c` for a checkpoint and wait for exit. Resume from the same directory:

```sh
hashcat --session latin-alnum9 --restore \
  --restore-file-path "$PWD/.cracking/latin-alnum9.restore"
```

A timeout or checkpoint means **partial**, not exhausted. Keep restore files locally until the run is finished. If existing potfile hits were skipped, export them with `hashcat -m 20 --show --outfile-format 1,2 --potfile-path .cracking/recovery.potfile .cracking/latin-input.hashcat` to a local results file too.

## Import and submit results

Keep complete `hash:phoenix:candidate` lines, including `$HEX[...]` wrappers. Do not trim whitespace, split candidate colons, lowercase recovered output again, or paste a partially written last line. Finish/checkpoint the run before importing its output.

```sh
python3 tools/import_recoveries.py .cracking/new-matches.txt
npm run data:build
npm run test:data
npm test
```

The importer accepts one or more result files, verifies every candidate against the authoritative table, preserves existing recoveries and deduplicates repeats. Any invalid record rejects the import without changing the source. Valid results are merged into **`research/source/recovered-words.csv`**; no separate Hashcat result files are kept in the repository.

The repository's sources of truth are `research/source/restricted-word-hashes.csv` (immutable original table), `research/source/recovered-words.csv` (verified candidates), and `research/coverage.json` (search coverage, evidence and pending merges). `research/source/locales.json` supplies language labels/grouping. `public/data/unrecovered-hashes.csv` is generated as the original table minus recovered hashes; it is never maintained separately. All other public exports and both heatmaps derive from these inputs.

Open a pull request with that CSV, the regenerated **`research/recovery.svg`**, and the coverage-ledger update. Do not commit `public/data/`, `dist/` or `.cracking/`. The dataset and both visualizers share the same sources; CI rejects a stale README image. A coverage-only contribution is useful even with zero new matches.
