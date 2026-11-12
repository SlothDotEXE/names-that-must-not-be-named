import csv
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from tools.build_data import build_dataset, LOCALES


def digest(word):
    return hashlib.md5(b'phoenix' + word.encode('utf-8')).hexdigest()


def csv_bytes(header, rows):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream, lineterminator='\r\n')
    writer.writerow(header)
    writer.writerows(rows)
    return stream.getvalue().encode('utf-8')


class BuildDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.output = self.root / 'output'
        self.source.mkdir()
        self.hash_header = ['row_index', 'hash', 'locale', 'always_check', 'asset_offset']
        self.recovery_header = ['row_index', 'word', 'hash', 'locale', 'always_check', 'asset_offset']
        self.words = [' café,: ', 'quoted "word"', 'unknown']
        self.hash_rows = [[i, digest(word), 'en-US' if i != 2 else 'ja-JP', 'True' if i != 2 else 'False', 10 + i] for i, word in enumerate(self.words)]
        self.recovery_rows = [
            [i, self.words[i], digest(self.words[i]), 'en-US', 'True', 10 + i]
            for i in range(2)
        ]
        self.write_csvs()
        summary = {'segments': [{'segment': code, 'language': code} for code in LOCALES], 'latin_script_locales': list(LOCALES[:8])}
        (self.source / 'locales.json').write_text(json.dumps(summary), encoding='utf-8')

    def write_csvs(self):
        (self.source / 'restricted-word-hashes.csv').write_bytes(csv_bytes(self.hash_header, self.hash_rows))
        (self.source / 'recovered-words.csv').write_bytes(csv_bytes(self.recovery_header, self.recovery_rows))

    def test_merges_exact_bytes_and_exports(self):
        result = build_dataset(self.source, self.output)
        self.assertEqual(result['counts']['all'], {'total': 3, 'recovered': 2, 'unrecovered': 1})
        self.assertEqual(result['rows'][0]['words'], [self.words[0]])
        self.assertEqual(result['rows'][1]['words'], [self.words[1]])
        self.assertEqual(result['rows'][2]['words'], [])
        self.assertEqual(result['sourceDigests']['restricted-word-hashes.csv'], hashlib.sha256((self.source / 'restricted-word-hashes.csv').read_bytes()).hexdigest())
        self.assertEqual((self.output / 'restricted-word-hashes.csv').read_bytes(), (self.source / 'restricted-word-hashes.csv').read_bytes())
        self.assertEqual((self.output / 'language-segments/ja-JP/unresolved.hashcat').read_text(), digest('unknown') + ':phoenix\n')
        with (self.output / 'recovered-words.csv').open(newline='', encoding='utf-8') as f:
            self.assertEqual([r['word'] for r in csv.DictReader(f)], self.words[:2])
        self.assertEqual(result['counts']['latinScript']['total'], 2)
        self.assertEqual(len(result['locales']), 14)

    def test_unchanged_inputs_produce_identical_outputs(self):
        build_dataset(self.source, self.output)
        before = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        build_dataset(self.source, self.output)
        after = {p.relative_to(self.output): p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_invalid_input_never_replaces_existing_output(self):
        build_dataset(self.source, self.output)
        original = (self.output / 'dataset.json').read_bytes()
        (self.source / 'recovered-words.csv').write_text('invalid,csv\n', encoding='utf-8')
        with self.assertRaises(ValueError):
            build_dataset(self.source, self.output)
        self.assertEqual((self.output / 'dataset.json').read_bytes(), original)


    def test_rejects_metadata_conflicts_and_invalid_source(self):
        for column, value in [(0, 99), (3, 'de-DE'), (4, 'False'), (5, 999), (1, self.words[0].strip())]:
            with self.subTest(column=column):
                original = self.recovery_rows[0][column]
                self.recovery_rows[0][column] = value
                self.write_csvs()
                with self.assertRaises(ValueError):
                    build_dataset(self.source, self.output)
                self.recovery_rows[0][column] = original
        self.hash_rows.append(self.hash_rows[0][:])
        self.write_csvs()
        with self.assertRaises(ValueError):
            build_dataset(self.source, self.output)

    def test_update_recovery_does_not_change_hash_membership(self):
        before = build_dataset(self.source, self.output)
        self.recovery_rows.append([2, self.words[2], digest(self.words[2]), 'ja-JP', 'False', 12])
        self.write_csvs()
        after = build_dataset(self.source, self.output)
        self.assertEqual(after['counts']['all']['recovered'], before['counts']['all']['recovered'] + 1)
        self.assertEqual([r['hash'] for r in before['rows']], [r['hash'] for r in after['rows']])

    def test_missing_input_and_strict_boolean(self):
        self.hash_rows[0][3] = 'true'
        self.write_csvs()
        with self.assertRaises(ValueError):
            build_dataset(self.source, self.output)
        (self.source / 'recovered-words.csv').unlink()
        with self.assertRaises(FileNotFoundError) as error:
            build_dataset(self.source, self.output)
        self.assertIn('research/source/recovered-words.csv', str(error.exception))


if __name__ == '__main__':
    unittest.main()
