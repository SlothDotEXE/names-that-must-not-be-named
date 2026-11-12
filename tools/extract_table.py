#!/usr/bin/env python3
"""Extract the build 26175237 WizardWords table from an owned installation."""
import argparse
import csv
import hashlib
import json
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from research.zen_reader import package_names

BUILD = '26175237'
TOC_SHA256 = '053e94b081115696d9b810a3a18527c0744aa0205d16520a123d40d05007a475'
CHUNK_SHA1 = '838b13595ee808e45b51654eb398079af7b4cae8'
CHUNK_SHA256 = '6e37c24a1699defa4986bd9e162015b5dead450a82e89a7532a5a8d5ee4ee8ee'
CHUNK_ID = bytes.fromhex('e90120cbf4bee5d400000002')
LOCALES = set('en-US de-DE es-ES es-MX fr-FR it-IT pl-PL pt-BR ar-AE ja-JP ko-KR ru-RU zh-CN zh-TW'.split())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def take(data, pos, size, what):
    require(pos >= 0 and size >= 0 and pos + size <= len(data), f'truncated {what} at {pos:#x}')
    return data[pos:pos + size]


def extract_chunk(paks, unoodle):
    toc = (paks / 'pakchunk0-WindowsNoEditor.utoc').read_bytes()
    require(hashlib.sha256(toc).hexdigest() == TOC_SHA256, 'TOC SHA-256 does not match build 26175237')
    require(take(toc, 16, 1, 'TOC version')[0] == 3, 'unsupported TOC version')
    fields = struct.unpack('<9I', take(toc, 20, 36, 'TOC header'))
    header, entries, blocks, block_size, methods, method_width, logical_block, directory_size, partitions = fields
    require(header == 144 and block_size == 12 and not (toc[80] & 6), 'unsupported TOC header, block size or flags')
    require(logical_block > 0 and partitions == 1, 'unsupported logical block size or partition count')
    ids = take(toc, header, entries * 12, 'chunk IDs')
    offsets_at = header + entries * 12
    offsets = take(toc, offsets_at, entries * 10, 'chunk offsets')
    blocks_at = offsets_at + entries * 10
    block_records = take(toc, blocks_at, blocks * 12, 'block records')
    methods_at = blocks_at + blocks * 12
    names_data = take(toc, methods_at, methods * method_width, 'compression methods')
    names = [names_data[i * method_width:(i + 1) * method_width].split(b'\0', 1)[0].decode('ascii') for i in range(methods)]
    matches = [i for i in range(entries) if ids[i * 12:(i + 1) * 12] == CHUNK_ID]
    require(len(matches) == 1, 'target chunk ID is not unique')
    entry = matches[0]
    record = offsets[entry * 10:entry * 10 + 10]
    offset, length = int.from_bytes(record[:5], 'big'), int.from_bytes(record[5:], 'big')
    require((offset, length) == (20166213632, 906743), 'unexpected target chunk location or length')
    first, last = offset // logical_block, (offset + length - 1) // logical_block
    require(last < blocks, 'chunk exceeds block table')
    assembled = bytearray()
    observed_blocks = []
    with (paks / 'pakchunk0-WindowsNoEditor.ucas').open('rb') as container, tempfile.TemporaryDirectory(prefix='wizardwords-') as temporary:
        temp = Path(temporary)
        for index in range(first, last + 1):
            rec = block_records[index * 12:(index + 1) * 12]
            file_offset = int.from_bytes(rec[:5], 'little')
            compressed_length = int.from_bytes(rec[5:8], 'little')
            decoded_length = int.from_bytes(rec[8:11], 'little')
            method = rec[11]
            require(compressed_length > 0 and decoded_length > 0, f'empty block {index}')
            container.seek(file_offset)
            compressed = container.read(compressed_length)
            require(len(compressed) == compressed_length, f'truncated container block {index}')
            digest = hashlib.sha256(compressed).hexdigest()
            if file_offset == 444936192:
                require(compressed_length == 187010 and digest == '8d707605ff33c8ad0b03f8ceb761c45bc1f0b87e3aaae92637092c01b3f17814', 'target compressed block integrity mismatch')
            if method == 0:
                decoded = compressed
            else:
                require(1 <= method <= len(names) and names[method - 1] == 'Oodle', f'unsupported compression method {method}')
                input_path, output_path = temp / 'input', temp / 'output'
                input_path.write_bytes(compressed)
                output_path.unlink(missing_ok=True)
                try:
                    result = subprocess.run([str(unoodle), str(input_path), '--length', str(decoded_length), '--output', str(output_path)], capture_output=True, timeout=30, check=False)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    raise ValueError(f'decompressor failed for block {index}: {exc}') from exc
                require(result.returncode == 0, f'decompressor failed for block {index}: {result.stderr.decode(errors="replace")}')
                require(output_path.is_file(), f'decompressor did not write block {index}')
                decoded = output_path.read_bytes()
            require(len(decoded) == decoded_length, f'wrong decoded length for block {index}')
            assembled.extend(decoded)
            observed_blocks.append({'index': index, 'fileOffset': file_offset, 'compressedBytes': compressed_length, 'decompressedBytes': decoded_length, 'method': method, 'compressedSha256': digest})
    require(any(block['fileOffset'] == 444936192 for block in observed_blocks), 'expected compressed target block missing')
    chunk = bytes(assembled[offset % logical_block:offset % logical_block + length])
    require(len(chunk) == length and hashlib.sha1(chunk).hexdigest() == CHUNK_SHA1 and hashlib.sha256(chunk).hexdigest() == CHUNK_SHA256, 'chunk length or digest mismatch')
    return chunk, {'tocSha256': TOC_SHA256, 'tocVersion': 3, 'headerBytes': header, 'entryCount': entries, 'blockCount': blocks, 'logicalBlockSize': logical_block, 'directoryBytes': directory_size, 'partitionCount': partitions, 'chunkEntry': entry, 'chunkId': CHUNK_ID.hex(), 'chunkLogicalOffset': offset, 'chunkBytes': len(chunk), 'chunkSha1': CHUNK_SHA1, 'chunkSha256': CHUNK_SHA256, 'blocks': observed_blocks}


def parse_table(chunk):
    start, name_map_size = struct.unpack('<II', take(chunk, 24, 8, 'name map header'))
    take(chunk, start, name_map_size, 'name map')
    # package_names is the original research helper; prevalidate its bounds.
    cursor = start
    while cursor < start + name_map_size:
        require(cursor + 2 <= start + name_map_size, 'name header crosses declared name map')
        hdr = int.from_bytes(take(chunk, cursor, 2, 'name header'), 'big')
        cursor += 2
        cursor += (hdr & 0x7fff) * (2 if hdr & 0x8000 else 1)
        require(cursor <= start + name_map_size, 'name crosses declared name map')
    require(cursor == start + name_map_size, 'name map length mismatch')
    names = package_names(chunk)
    pos = 0x4e3cd
    count = struct.unpack('<I', take(chunk, pos, 4, 'row count'))[0]
    pos += 4
    require(count == 7614, 'unexpected row count')
    rows, seen = [], set()

    def fname():
        nonlocal pos
        index, number = struct.unpack('<II', take(chunk, pos, 8, 'FName'))
        pos += 8
        require(index < len(names) and number == 0, 'invalid FName index or number')
        return names[index]

    for row_index in range(count):
        row_offset = pos
        key = fname()
        require(re.fullmatch(r'[0-9a-f]{32}', key) is not None and key not in seen, f'invalid or duplicate row hash at {row_offset:#x}')
        seen.add(key)
        properties = {}
        while True:
            name = fname()
            if name == 'None':
                break
            kind = fname()
            size, array_index = struct.unpack('<II', take(chunk, pos, 8, 'property header'))
            pos += 8
            require(array_index == 0 and name not in properties, 'invalid array index or duplicate property')
            if name == 'bAlwaysCheck' and kind == 'BoolProperty':
                require(size == 0, 'unexpected bool payload size')
                value = take(chunk, pos, 1, 'boolean')[0]
                pos += 1
                require(value in (0, 1), 'invalid bool value')
                require(take(chunk, pos, 1, 'property GUID flag') == b'\0', 'unexpected property GUID')
                pos += 1
                properties[name] = bool(value)
            elif name == 'Locale' and kind == 'StrProperty':
                require(take(chunk, pos, 1, 'property GUID flag') == b'\0', 'unexpected property GUID')
                pos += 1
                payload = take(chunk, pos, size, 'string payload')
                pos += size
                require(len(payload) >= 4, 'truncated FString')
                n = struct.unpack('<i', payload[:4])[0]
                width = 2 if n < 0 else 1
                require(n != 0 and len(payload) == 4 + abs(n) * width, 'invalid FString length')
                raw = payload[4:]
                require(raw[-width:] == b'\0' * width, 'unterminated FString')
                properties[name] = raw[:-width].decode('utf-16-le' if width == 2 else 'utf-8')
            else:
                raise ValueError(f'unexpected property {name!r} type {kind!r}')
        require(set(properties) == {'Locale', 'bAlwaysCheck'} and properties['Locale'] in LOCALES, 'missing property or unknown locale')
        rows.append((row_index, key, properties['Locale'], properties['bAlwaysCheck'], row_offset))
    require(pos == len(chunk), f'unconsumed chunk bytes: {len(chunk) - pos}')
    hash_names = {name for name in names if re.fullmatch(r'[0-9a-f]{32}', name)}
    require(seen == hash_names, 'row hashes do not match name-map hashes')
    return rows, {'rowCount': count, 'nameCount': len(names), 'hashNameCount': len(hash_names), 'nameMapOffset': start, 'nameMapBytes': name_map_size, 'tableOffset': 0x4e3cd, 'consumedBytes': pos, 'remainingBytes': len(chunk) - pos}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paks', required=True, type=Path)
    parser.add_argument('--unoodle', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        require(not args.output.exists() or (args.output.is_dir() and not any(args.output.iterdir())), 'output must be new or an empty directory')
        chunk, integrity = extract_chunk(args.paks, args.unoodle)
        rows, parsing = parse_table(chunk)
        args.output.mkdir(parents=True, exist_ok=True)
        with (args.output / 'restricted-word-hashes.csv').open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['row_index', 'hash', 'locale', 'always_check', 'asset_offset'])
            writer.writerows(rows)
        (args.output / 'extraction-report.json').write_text(json.dumps({'buildId': BUILD, 'integrity': integrity, 'parsing': parsing}, indent=2) + '\n', encoding='utf-8')
        print(f'Extracted {len(rows)} rows to {args.output}')
    except (OSError, ValueError, UnicodeError, struct.error, AssertionError) as exc:
        print(f'extraction failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
