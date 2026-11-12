export type Locale =
  | 'en-US'
  | 'de-DE'
  | 'es-ES'
  | 'es-MX'
  | 'fr-FR'
  | 'it-IT'
  | 'pl-PL'
  | 'pt-BR'
  | 'ar-AE'
  | 'ja-JP'
  | 'ko-KR'
  | 'ru-RU'
  | 'zh-CN'
  | 'zh-TW';

export type Counts = {
  total: number;
  recovered: number;
  unrecovered: number;
};

export type HashRow = {
  rowIndex: number;
  hash: string;
  locale: Locale;
  alwaysCheck: boolean;
  words: string[];
};

export type Dataset = {
  schemaVersion: 1;
  buildId: '26175237';
  snapshotId: string;
  sourceDigests: Record<string, string>;
  rows: HashRow[];
  counts: { all: Counts; latinScript: Counts };
  locales: (Counts & { code: Locale; label: string })[];
  latinScriptLocales: Locale[];
};

/** UTF-16 offsets, with an exclusive end. */
export type Span = {
  start: number;
  end: number;
};

export type NameMatch = {
  hash: string;
  candidate: string;
  locale: Locale;
  alwaysCheck: boolean;
  rule: 'exact' | 'whole' | 'short-token' | 'substring';
  spans: Span[];
  recoveredWords: string[];
};

export type NameResult = {
  verdict: 'restricted' | 'no-match';
  unicodeApproximate: boolean;
  matches: NameMatch[];
};
