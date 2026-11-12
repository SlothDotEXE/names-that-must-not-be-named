import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools.build_data import build_dataset, HASH_COLUMNS, LOCALES, RECOVERY_COLUMNS, write_csv


class ImportRecoveriesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.words = ['known', ' café,: ', 'line\nbreak']
        self.hashes = [hashlib.md5(('phoenix' + word).encode()).hexdigest() for word in self.words]
        write_csv(self.source / 'restricted-word-hashes.csv', HASH_COLUMNS,
                  ((i, digest, 'en-US', 'True', 10 + i) for i, digest in enumerate(self.hashes)))
        self.recoveries = self.source / 'recovered-words.csv'
        write_csv(self.recoveries, RECOVERY_COLUMNS, [(0, self.words[0], self.hashes[0], 'en-US', 'True', 10)])
        (self.source / 'locales.json').write_text(json.dumps({
            'segments': [{'segment': code, 'language': code} for code in LOCALES],
            'latin_script_locales': list(LOCALES[:8]),
        }), encoding='utf-8')
        self.input = self.root / 'matches.txt'

    def run_import(self, raw):
        self.input.write_bytes(raw)
        return subprocess.run([sys.executable, 'tools/import_recoveries.py', '--source', str(self.source), str(self.input)],
                              capture_output=True, text=True, check=False)

    def test_preserves_candidate_bytes_and_reimport_is_idempotent(self):
        raw = (f'{self.hashes[1]}:phoenix:{self.words[1]}\r\n'
               f'{self.hashes[2]}:phoenix:$HEX[{self.words[2].encode().hex()}]\n').encode()
        result = self.run_import(raw)
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.recoveries.open(newline='', encoding='utf-8') as stream:
            self.assertEqual([row['word'] for row in csv.DictReader(stream)], self.words)
        dataset = build_dataset(self.source, self.root / 'output')
        self.assertEqual(dataset['counts']['all'], {'total': 3, 'recovered': 3, 'unrecovered': 0})
        before = self.recoveries.read_bytes()
        self.assertEqual(self.run_import(raw).returncode, 0)
        self.assertEqual(self.recoveries.read_bytes(), before)

    def test_invalid_later_record_cannot_partially_import(self):
        original = self.recoveries.read_bytes()
        valid = f'{self.hashes[1]}:phoenix:{self.words[1]}\n'
        invalid = [
            '0' * 32 + ':phoenix:unknown',
            f'{self.hashes[2]}:wrong:salt',
            f'{self.hashes[2]}:phoenix:wrong candidate',
            f'{self.hashes[2]}:phoenix:$HEX[ff]',
            f'{self.hashes[2]}:phoenix:$HEX[0]',
            'partial',
        ]
        for line in invalid:
            with self.subTest(line=line):
                self.assertNotEqual(self.run_import((valid + line + '\n').encode()).returncode, 0)
                self.assertEqual(self.recoveries.read_bytes(), original)

    def test_existing_invalid_metadata_is_not_silently_repaired(self):
        write_csv(self.recoveries, RECOVERY_COLUMNS, [(0, self.words[0], self.hashes[0], 'de-DE', 'True', 10)])
        original = self.recoveries.read_bytes()
        self.assertNotEqual(self.run_import(b'').returncode, 0)
        self.assertEqual(self.recoveries.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
