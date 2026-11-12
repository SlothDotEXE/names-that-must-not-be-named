#!/usr/bin/env python3
"""Merge Hashcat output into the canonical recovery CSV, after validation."""
import argparse
import os
from pathlib import Path
import re
import shutil
import tempfile

from build_data import (build_dataset, csv_rows, fail, HASH_COLUMNS, HEX_HASH,
                        INPUTS, RECOVERY_COLUMNS, write_csv)


def hashcat_candidates(raw, path):
    for line, entry in enumerate(raw.split(b'\n'), 1):
        if entry.endswith(b'\r'):
            entry = entry[:-1]
        if not entry:
            continue
        parts = entry.split(b':', 2)
        if len(parts) != 3:
            fail(path, line, 'malformed Hashcat line')
        digest_bytes, salt, value = parts
        try:
            digest = digest_bytes.decode('ascii')
            if not HEX_HASH.fullmatch(digest) or salt != b'phoenix':
                fail(path, line, 'invalid digest or salt')
            if value.startswith(b'$HEX['):
                if not value.endswith(b']') or not re.fullmatch(b'(?:[0-9a-fA-F]{2})*', value[5:-1]):
                    fail(path, line, 'invalid HEX wrapper')
                value = bytes.fromhex(value[5:-1].decode('ascii'))
            word = value.decode('utf-8')
        except (UnicodeError, ValueError) as exc:
            fail(path, line, f'invalid candidate encoding: {exc}')
        yield line, digest, word


def import_recoveries(source, inputs):
    with tempfile.TemporaryDirectory(prefix='name-recovery-') as temporary:
        stage = Path(temporary) / 'source'
        stage.mkdir()
        for name in INPUTS:
            shutil.copyfile(source / name, stage / name)
        hashes = {row['hash']: row for _, row in csv_rows(
            (stage / INPUTS[0]).read_bytes(), INPUTS[0], HASH_COLUMNS)}
        records = [row for _, row in csv_rows(
            (stage / INPUTS[1]).read_bytes(), INPUTS[1], RECOVERY_COLUMNS)]
        seen = {(row['hash'], row['word']) for row in records}
        added = 0
        for path in inputs:
            for line, digest, word in hashcat_candidates(path.read_bytes(), path):
                if digest not in hashes:
                    fail(path, line, 'unknown hash')
                if (digest, word) not in seen:
                    records.append(dict(hashes[digest], word=word))
                    seen.add((digest, word))
                    added += 1
        write_csv(stage / INPUTS[1], RECOVERY_COLUMNS,
                  ([row[key] for key in RECOVERY_COLUMNS] for row in records))
        output = Path(temporary) / 'validated'
        build_dataset(stage, output)
        if added:
            target = source / INPUTS[1]
            descriptor, temporary_name = tempfile.mkstemp(prefix='.recovery-', dir=source)
            try:
                with os.fdopen(descriptor, 'wb') as stream:
                    stream.write((output / INPUTS[1]).read_bytes())
                os.chmod(temporary_name, target.stat().st_mode & 0o777)
                os.replace(temporary_name, target)
            finally:
                Path(temporary_name).unlink(missing_ok=True)
        return added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', type=Path, nargs='+', help='Hashcat --outfile-format 1,2 files')
    parser.add_argument('--source', type=Path, default=Path('research/source'), help='canonical source directory')
    args = parser.parse_args()
    try:
        added = import_recoveries(args.source, args.inputs)
    except (OSError, ValueError) as exc:
        parser.exit(1, f'Import failed; recovery source unchanged: {exc}\n')
    print(f'Imported {added} new verified hash/candidate pairs. Run npm run data:build to refresh the site and heatmap.')


if __name__ == '__main__':
    main()
