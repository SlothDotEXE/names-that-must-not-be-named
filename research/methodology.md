# Research and reproduction methodology

## Scope and motivation

Some otherwise innocent names contain a fragment on a restriction list. A [community discussion](https://www.reddit.com/r/HarryPotterGame/comments/1xu2n97/really_in_a_single_player_game/) motivated this investigation; it is not evidence for the technical findings. The tool models the traced bundled restriction check from Steam build **26175237**. It does not establish acceptance in a running game, all naming rules, or the contents of the current online list. The traced setup can replace the bundled list with a nonempty online-manager list. No game launch, live server response, or in-game acceptance was observed in this research.

The bundled `DT_WizardWords` table contains 7,614 unique hash rows classified by 14 game locales. The table extraction is complete for the matching build; readable candidate recovery is not. The checker compares every eligible submitted candidate with the entire active hash set, including rows without a recovered word. English `always-check` rows are included for every selected locale; other rows are included when their game-authored locale matches. Locale is not an inference about an unknown word's language. The combined Latin-script reporting group overlaps the individual locale groups and is not an additional set to add to the total.

## Extract the owned matching build

This read-only extractor is deliberately specific to the matching Windows Steam build, not a general Unreal asset extractor. It requires Python 3 and an `unoodle` executable. To install the pinned open-source decompressor with Cargo:

```sh
cargo install oozextract --version 0.5.7 --features cli --locked
```

From the repository root, provide your own installation's Paks directory and a new or empty output directory. Substitute the paths as appropriate; no game files are included here:

```sh
python3 tools/extract_table.py \
  --paks "$HOME/path/to/Hogwarts Legacy/Phoenix/Content/Paks" \
  --unoodle "$HOME/.cargo/bin/unoodle" \
  --output "$HOME/wizardwords-extraction"
```

The extractor rejects a TOC whose exact SHA-256, version, header layout, flags, target chunk location, or format do not match. It reads the necessary container blocks only, decompresses Oodle blocks in temporary files with a timeout, verifies the chunk's SHA-1 and SHA-256, and parses all rows through exact EOF. It checks the names, properties, flags, locales, and complete hash-name set. Output is `restricted-word-hashes.csv` and `extraction-report.json`; row offsets refer to the decompressed chunk. The copied [original name-map helper](https://github.com/SlothDotEXE/names-that-must-not-be-named/blob/main/tools/research/zen_reader.py) is used by the extractor. No chunks, containers, or executables are published. The extractor does not derive the separate native-code conclusions below.

## Hashing and candidate recovery

For ordinary ASCII the observed operation matches lowercase hexadecimal MD5 of UTF-8 `phoenix` plus the lowercased input. Native code also removes the UTF-16 sequence U+00E3 U+20AC U+20AC before UTF-8 encoding. The recovered values are **verified normalized candidate preimages** of salted hashes, not reversible encryption and not proof of original capitalization or unique original plaintext. A candidate is retained only when its exact UTF-8 bytes with the `phoenix` salt reproduce an authoritative row hash.

After installing Hashcat and choosing a permitted local wordlist, one reproducible dictionary attack against the generated unresolved set is:

```sh
npm run data:build
hashcat -m 20 -a 0 --outfile-format 1,2 \
  -o new-matches.txt public/data/language-segments/all/unresolved.hashcat \
  /path/to/your-wordlist.txt
```

Hashcat mode 20 uses `hash:phoenix`; output format 1,2 produces `hash:phoenix:candidate`, potentially with `$HEX[...]` candidate bytes. Preserve complete lines and exact candidate bytes, including whitespace and colons. Review and append complete output lines to `research/source/language-segments/hashcat-new-matches.txt`, then regenerate:

```sh
cat new-matches.txt >> research/source/language-segments/hashcat-new-matches.txt
npm run data:build
```

The importer validates every candidate against its existing hash, decodes complete `$HEX[...]` wrappers as UTF-8, rejects malformed or conflicting inputs, and deduplicates repeated pairs. Commit the updated source input, not the generated `public/data` output. No GPU search is necessary to use the site. Historical benchmark figures in the original research are not forecasts or current progress.

## Matching model

The decoded shared Blueprint checks an exact-mode input whole, without separator replacement or tokenization. In substring mode, empty original input yields no checks; ASCII hyphen-minus, apostrophe and backtick become literal spaces. With more than one nonempty space-delimited token, each token of at most three UTF-16 units is checked whole first. Then literal spaces are removed. A compact string of at most three units is checked whole; otherwise every substring of length four or more is checked, including longer substrings and those in single-token input. Tabs and unrelated punctuation are not removed. The original stops at the first hit; the website continues to show all distinct matching spans. Character mode checks first name plus an inserted space plus last name in exact mode, then last name and first name separately in substring mode. The traced beast naming input uses substring mode.

An offline interpreter of the decoded bytecode using modeled ASCII engine operations found `Prometheus` restricted by `meth`, `Classic` not restricted, and `Ass`, `a ss`, `me-th` and `methx` restricted. These are offline model results, not gameplay observations. Native Unicode casing and indexing equivalence is not established; the site uses JavaScript lowercasing and UTF-16 slicing and labels both positive and negative Unicode predictions approximate. Neither a no-match result nor complete bundled hash coverage guarantees live approval: online replacement and other naming validations remain possible.

## Reviewable evidence

The [sanitized evidence directory](https://github.com/SlothDotEXE/names-that-must-not-be-named/tree/main/research/evidence) includes the decoded matcher and caller streams, offline examples, native and setup evidence, and [original-versus-sanitized checksums](https://github.com/SlothDotEXE/names-that-must-not-be-named/blob/main/research/evidence/provenance.json). The separate [input provenance](https://github.com/SlothDotEXE/names-that-must-not-be-named/blob/main/research/provenance.json) records the portable data snapshot. Historical counts in original evidence describe their original snapshots, not current recovery statistics. The website's generated counts come from validated current inputs.

The native evidence records preferred virtual addresses, not raw file offsets. For an independently owned matching executable, bounded disassembly examples are:

```sh
objdump -D -Mintel --start-address=0x145f76750 --stop-address=0x145f76b00 /path/to/HogwartsLegacy.exe
objdump -D -Mintel --start-address=0x1434cc6c0 --stop-address=0x1434cc920 /path/to/HogwartsLegacy.exe
objdump -D -Mintel --start-address=0x1434b9980 --stop-address=0x1434b9a80 /path/to/HogwartsLegacy.exe
```

See `native-hash-and-online-evidence.txt` for the supporting addresses, hash constants, string replacement, UTF-8 conversion, list-fetch observations, and their limitations; `consumer-callsite-evidence.txt` and `setup-wizardwords-evidence.txt` document routing and fallback. The observed request path supports a list-fetch model, but does not establish the actual endpoint, response, current online availability, or absence of other network checks.
