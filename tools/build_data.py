#!/usr/bin/env python3
"""Build deterministic public exports from the committed research snapshot."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

LOCALES = ('en-US', 'de-DE', 'es-ES', 'es-MX', 'fr-FR', 'it-IT', 'pl-PL', 'pt-BR', 'ar-AE', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW')
HASH_COLUMNS = ('row_index', 'hash', 'locale', 'always_check', 'asset_offset')
RECOVERY_COLUMNS = ('row_index', 'word', 'hash', 'locale', 'always_check', 'asset_offset')
INPUTS = ('restricted-word-hashes.csv', 'recovered-words.csv', 'locales.json')
HEX_HASH = re.compile(r'[0-9a-f]{32}\Z')


def fail(path, line, reason):
    raise ValueError(f'{path}:{line}: {reason}')


def csv_rows(raw, path, columns):
    try:
        stream = io.StringIO(raw.decode('utf-8-sig'), newline='')
        reader = csv.DictReader(stream, strict=True)
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not set(columns).issubset(reader.fieldnames):
            fail(path, 1, 'missing or duplicate required columns')
        for row in reader:
            if None in row or any(row.get(k) is None for k in columns):
                fail(path, reader.line_num, 'incorrect number of columns')
            yield reader.line_num, row
    except (UnicodeError, csv.Error) as exc:
        raise ValueError(f'{path}: invalid CSV: {exc}') from exc


def metadata(row, path, line):
    def number(key):
        value = row[key]
        if not re.fullmatch(r'[0-9]+', value):
            fail(path, line, f'invalid {key}')
        return int(value)
    index, offset = number('row_index'), number('asset_offset')
    digest, locale, flag = row['hash'], row['locale'], row['always_check']
    if not HEX_HASH.fullmatch(digest):
        fail(path, line, 'invalid hash')
    if locale not in LOCALES:
        fail(path, line, 'unknown locale')
    if flag not in ('True', 'False'):
        fail(path, line, 'invalid always_check')
    return index, digest, locale, flag == 'True', offset


def counts(rows):
    recovered = sum(bool(row['words']) for row in rows)
    return {'total': len(rows), 'recovered': recovered, 'unrecovered': len(rows) - recovered}


def write_csv(path, columns, rows):
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow(columns)
        writer.writerows(rows)


def build_dataset(source_dir: Path, output_dir: Path) -> dict:
    source_dir, output_dir = Path(source_dir), Path(output_dir)
    raw = {}
    for name in INPUTS:
        try:
            raw[name] = (source_dir / name).read_bytes()
        except FileNotFoundError as exc:
            raise FileNotFoundError(f'missing required input: research/source/{name}') from exc
    digests = {name: hashlib.sha256(raw[name]).hexdigest() for name in INPUTS}
    snapshot = hashlib.sha256('\n'.join(f'{name}:{digests[name]}' for name in sorted(digests)).encode('utf-8')).hexdigest()
    rows, by_hash, by_index, offsets = [], {}, set(), {}
    for line, record in csv_rows(raw[INPUTS[0]], INPUTS[0], HASH_COLUMNS):
        index, digest, locale, flag, offset = metadata(record, INPUTS[0], line)
        if digest in by_hash or index in by_index:
            fail(INPUTS[0], line, 'duplicate hash or row index')
        row = {'rowIndex': index, 'hash': digest, 'locale': locale, 'alwaysCheck': flag, 'words': []}
        rows.append(row)
        by_hash[digest] = row
        by_index.add(index)
        offsets[digest] = offset
    candidates = {digest: set() for digest in by_hash}

    def add(digest, word, path, line):
        if digest not in by_hash:
            fail(path, line, 'unknown hash')
        if hashlib.md5(b'phoenix' + word.encode('utf-8')).hexdigest() != digest:
            fail(path, line, 'candidate digest mismatch')
        candidates[digest].add(word)

    for line, record in csv_rows(raw[INPUTS[1]], INPUTS[1], RECOVERY_COLUMNS):
        index, digest, locale, flag, offset = metadata(record, INPUTS[1], line)
        row = by_hash.get(digest)
        if row is None:
            fail(INPUTS[1], line, 'unknown hash')
        if (index, locale, flag, offset) != (row['rowIndex'], row['locale'], row['alwaysCheck'], offsets[digest]):
            fail(INPUTS[1], line, 'metadata conflict')
        add(digest, record['word'], INPUTS[1], line)
    for row in rows:
        row['words'] = sorted(candidates[row['hash']])
    try:
        summary = json.loads(raw[INPUTS[2]].decode('utf-8-sig'))
        labels = {}
        for segment in summary['segments']:
            code = segment['segment']
            if code in LOCALES:
                if code in labels or not isinstance(segment['language'], str) or not segment['language']:
                    raise ValueError('duplicate or invalid locale label')
                labels[code] = segment['language']
        latin = summary['latin_script_locales']
        if set(labels) != set(LOCALES) or not isinstance(latin, list) or len(latin) != len(set(latin)) or any(code not in LOCALES for code in latin):
            raise ValueError('invalid locale metadata')
    except (UnicodeError, ValueError, KeyError, TypeError) as exc:
        raise ValueError(f'{INPUTS[2]}: invalid metadata: {exc}') from exc
    locale_counts = [dict(code=code, label=label, **counts([r for r in rows if r['locale'] == code])) for code, label in labels.items()]
    latin_rows = [r for r in rows if r['locale'] in latin]
    dataset = {'schemaVersion': 1, 'buildId': '26175237', 'snapshotId': snapshot, 'sourceDigests': digests, 'rows': rows, 'counts': {'all': counts(rows), 'latinScript': counts(latin_rows)}, 'locales': locale_counts, 'latinScriptLocales': latin}

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.data-stage-', dir=output_dir.parent))
    backup = None
    try:
        def hash_record(r):
            return (r['rowIndex'], r['hash'], r['locale'], str(r['alwaysCheck']), offsets[r['hash']])
        def recovery_record(r, word):
            return (r['rowIndex'], word, r['hash'], r['locale'], str(r['alwaysCheck']), offsets[r['hash']])
        def export(scope, selected):
            scope.mkdir(parents=True, exist_ok=True)
            recovered = [(r, word) for r in selected for word in r['words']]
            unresolved = [r for r in selected if not r['words']]
            write_csv(scope / 'recovered-words.csv', RECOVERY_COLUMNS, (recovery_record(r, word) for r, word in recovered))
            write_csv(scope / 'unresolved-rows.csv', HASH_COLUMNS, (hash_record(r) for r in unresolved))
            (scope / 'recovered-words.txt').write_text(''.join(word + '\n' for _, word in recovered), encoding='utf-8')
            (scope / 'unresolved.hashcat').write_text(''.join(r['hash'] + ':phoenix\n' for r in unresolved), encoding='utf-8')
        (stage / 'dataset.json').write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (stage / 'restricted-word-hashes.csv').write_bytes(raw[INPUTS[0]])
        write_csv(stage / 'recovered-words.csv', RECOVERY_COLUMNS, (recovery_record(r, w) for r in rows for w in r['words']))
        write_csv(stage / 'unrecovered-hashes.csv', HASH_COLUMNS, (hash_record(r) for r in rows if not r['words']))
        scopes = [('all', rows), ('latin-script-all', latin_rows)] + [(code, [r for r in rows if r['locale'] == code]) for code in labels]
        for name, selected in scopes:
            export(stage / 'language-segments' / name, selected)
        summary_out = {'buildId': dataset['buildId'], 'snapshotId': snapshot, 'latinScriptLocales': latin, 'scopes': [dict(scope=name, **counts(selected)) for name, selected in scopes], 'locales': locale_counts}
        (stage / 'language-segments' / 'summary.json').write_text(json.dumps(summary_out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        write_csv(stage / 'language-segments' / 'summary.csv', ('scope', 'total', 'recovered', 'unrecovered'), ((s['scope'], s['total'], s['recovered'], s['unrecovered']) for s in summary_out['scopes']))
        if output_dir.exists():
            backup = Path(tempfile.mkdtemp(prefix='.data-backup-', dir=output_dir.parent))
            backup.rmdir()
            os.replace(output_dir, backup)
        try:
            os.replace(stage, output_dir)
        except BaseException:
            if backup is not None:
                os.replace(backup, output_dir)
                backup = None
            raise
        if backup is not None:
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return dataset


if __name__ == '__main__':
    build_dataset(Path('research/source'), Path('public/data'))
