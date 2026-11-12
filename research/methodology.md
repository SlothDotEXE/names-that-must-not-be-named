# Research and reproduction methodology

## Scope and source

A [community discussion](https://www.reddit.com/r/HarryPotterGame/comments/1xu2n97/really_in_a_single_player_game/) about an innocent name motivated this investigation; it is not evidence of the implementation. Static analysis of an owned Windows Steam installation, build **26175237**, identified the bundled `DT_WizardWords` table and the relevant matching and list-selection paths. No game session was launched and no live server response or in-game acceptance was observed.

The complete bundled table contains 7,614 unique hash rows in 14 locales, with a locale and an `always-check` flag on each row. The traced local fallback selects the current locale plus always-check entries; the English (US) rows are always checked. The website instead searches every source hash across all languages, whether or not a readable candidate has been recovered. Its source language labels describe the table, not a determination of an unknown word's language. See [input provenance](provenance.json) for the portable data snapshot.

## Extracting the table

The read-only [extractor](../tools/extract_table.py) is specific to this owned build, not a general Unreal extractor. It requires Python 3, the matching installation's `Phoenix/Content/Paks` directory, and an `unoodle` executable. For example, install the pinned decompressor and provide paths to your own installation and a new or empty output directory:

```sh
cargo install oozextract --version 0.5.7 --features cli --locked
python3 tools/extract_table.py \
  --paks "$HOME/path/to/Hogwarts Legacy/Phoenix/Content/Paks" \
  --unoodle "$HOME/.cargo/bin/unoodle" \
  --output "$HOME/wizardwords-extraction"
```

The extractor uses the included [name-map helper](../tools/research/zen_reader.py), validates the expected container and chunk identities and format, decompresses the required blocks, and checks the full parsed hash set and exact end of the table. It produces `restricted-word-hashes.csv` and `extraction-report.json`, not game binaries. It does not independently reproduce the separate static analysis of matching or native hashing.

## Hashing and recovery

For ordinary ASCII input, the traced native operation produces lowercase hexadecimal MD5 of UTF-8 `phoenix` followed by the lowercased input. It also removes the UTF-16 sequence U+00E3 U+20AC U+20AC before UTF-8 conversion. Unicode casing and edge cases are not fully established. The table stores hash keys, not their original plaintext; hashes are not reversible encryption.

Hashcat can test candidate words against the salted hashes. A recovered candidate is retained only when its exact UTF-8 bytes, prefixed by `phoenix`, reproduce a source hash. Such a candidate is a verified preimage, not proof of the original capitalization or the only possible plaintext. See the [contribution guide](CONTRIBUTING.md) for generating unresolved inputs and importing new recoveries.

## Matching and limitations

The traced exact mode hashes the entire input without replacing separators. In substring mode, ASCII hyphens, apostrophes and backticks become spaces. When there are multiple nonempty space-delimited tokens, each token of at most three UTF-16 units is checked whole. Spaces are then removed: a compact string of at most three units is checked whole, while a longer string is checked for every substring of four or more units. Tabs and other punctuation are not removed. Thus a short word is not indiscriminately matched inside a longer unbroken name, but a longer word can be. The traced matcher stops at its first hit.

The traced character path checks the combined first and last name in exact mode and each separately in substring mode; a creature-related text-input path checks its text in substring mode. The website instead checks one complete entry in exact and substring modes, searches the union of all locales and reports distinct matching occurrences. It does not infer field boundaries. For example, it can match `meth` across the space in `Me Thom`, even though the traced character-field substring path checks each field separately.

These are static findings, not proof of a running game's behavior. A nonempty online-manager list can replace the widget list; otherwise the traced setup retains an existing nonempty list or falls back to the bundled table. The observed request path supports a list-fetch model, but its endpoint, response and current availability were not established, nor were other network checks ruled out. Other naming screens or validation rules may differ. The site's JavaScript casing and UTF-16 indexing are not established as equivalent to native Unicode behavior, so non-ASCII results are approximate. Neither a match nor a no-match guarantees the game's decision.
