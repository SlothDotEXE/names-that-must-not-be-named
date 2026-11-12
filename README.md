# Hogwarts Legacy Name Check

A browser-based predictor of the traced bundled name restriction check in Steam build **26175237**. Innocent names can contain restricted fragments. The intended GitHub Pages address is <https://slothdotexe.github.io/names-that-must-not-be-named/>; publication and live availability depend on the Pages deployment.

The bundled table contains 7,614 hash rows in this snapshot. **The checker uses every eligible hash, including those without a recovered word.** Recovery statistics count rows with verified candidate preimages, not the number of readable words or evidence of original capitalization. Public hashes and recovery exports are intentional for auditing; recovered words can contain offensive terms and are hidden in the interface until explicitly revealed.

## Use the checker

Choose character or beast/pet mode, select the game's locale, and submit a name. Character mode checks the combined first and last name exactly and then checks each field separately for fragments; beast mode checks its name for fragments. Rows marked always-check apply regardless of locale. The checker reports matching input fragments even when no published plaintext is recovered. The selected locale controls which other rows apply; it is independent of the recovery explorer.

Substring mode replaces ASCII hyphens, apostrophes and backticks with spaces, checks short separate tokens, and checks the compact name or all eligible substrings of four or more UTF-16 units. The site collects all matches rather than stopping at the first. There is a **tool limit**, not a claimed game limit, of 128 UTF-16 units per field. Non-ASCII results, positive and negative, are approximate: native Unicode casing and indexing equivalence is not established. A no-match result is not a guarantee of game acceptance: the game may use an updated online list or other naming rules.

Names remain in the browser: the checker does not send them in requests, URLs or analytics, or save them to storage. The recovery explorer offers All, individual locales, and a combined Latin-script group. Latin overlaps its constituent locales and must not be added to All; locale labels are game-authored classifications, not language inference for unknown words. Downloads reflect the selected scope, with the full hash list also available.

## Local development

Requirements: Node.js 24 or newer, npm, and Python 3. From the repository root:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. `predev` automatically builds the dataset first. Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run data:build` | Validate committed inputs and regenerate public datasets and exports. |
| `npm run typecheck` | Type-check without emitting files. |
| `npm run test:data` | Run Python importer tests. |
| `npm run build` | Generate data, type-check, and build the static site in `dist/`. |
| `npm test` | Run matcher tests; run the build or data generation first so the real-data fixture exists. |
| `npm run preview` | Serve the production build locally. |

`public/data/` and `dist/` are generated and ignored, not committed. The site and downloads can be served under a project subpath; no backend is required.

## Updating recovery inputs

The importer reads exactly these repository-contained files under `research/source/`:

- `restricted-word-hashes.csv`: authoritative rows with `row_index,hash,locale,always_check,asset_offset`.
- `recovered-words.csv`: baseline preimages with `row_index,word,hash,locale,always_check,asset_offset`.
- `language-segments/hashcat-new-matches.txt`: complete `hash:phoenix:candidate` lines; an empty file is valid.
- `language-segments/summary.json`: locale labels and the Latin-script grouping, not current recovery counts.

CSV fields use real CSV quoting. Recovery metadata must agree with the authoritative row. Hashcat output splits at the first two colons, so later colons and leading or trailing candidate spaces are meaningful; preserve them exactly. Complete `$HEX[...]` wrappers represent candidate bytes and must decode as valid UTF-8. The importer verifies the MD5 of the literal salt `phoenix` followed by the exact candidate UTF-8 bytes, without trimming or normalization, against an existing row. It rejects malformed records, mismatches and unknown hashes instead of publishing a partial dataset, and deduplicates identical hash/candidate pairs. Counts are recomputed from the merged inputs; multiple candidates for a hash count as one recovered row. Source digests are computed from the original file bytes.

For example, after a permitted local Hashcat recovery, review and append complete results, then regenerate:

```sh
npm run data:build
hashcat -m 20 -a 0 --outfile-format 1,2 \
  -o new-matches.txt public/data/language-segments/all/unresolved.hashcat \
  /path/to/your-wordlist.txt
cat new-matches.txt >> research/source/language-segments/hashcat-new-matches.txt
npm run data:build
```

Commit the updated input files, not generated exports, and push the commit normally to `main`. The Pages workflow validates the change and deploys the resulting `dist/`; pull requests are validated but never uploaded or deployed. There is no watcher, scheduled recovery, or automatic push.

## Reproduce the table extraction

The extractor is specific to the matching owned Windows Steam build and reads the installation without modifying it. It checks the build and container/chunk integrity and rejects unexpected formats. Install the pinned decompressor if needed, then provide paths to your own installation and a new or empty output directory:

```sh
cargo install oozextract --version 0.5.7 --features cli --locked
python3 tools/extract_table.py \
  --paks "$HOME/path/to/Hogwarts Legacy/Phoenix/Content/Paks" \
  --unoodle "$HOME/.cargo/bin/unoodle" \
  --output "$HOME/wizardwords-extraction"
```

This emits the table CSV and extraction report, not game binaries. Extraction is not needed for ordinary site builds or recovery updates. See the [methodology](research/methodology.md) for detailed extraction, matching and recovery procedures, technical limitations, and bounded native disassembly commands. Review the [input provenance](research/provenance.json), [sanitized evidence](research/evidence/), [evidence provenance](research/evidence/provenance.json), and [original name-map helper](tools/research/zen_reader.py). The extractor does not independently derive the native-code findings; those are documented separately in the evidence.
