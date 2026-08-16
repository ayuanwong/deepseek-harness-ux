/** Canonical paths, parsing, and rendering for bilingual pairing records. */

import { basename } from 'node:path'

/** The three repository-relative paths that form one bilingual pair. */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Simplified Chinese document path. */
  zh: string
  /** Generated consistency-record path. */
  meta: string
}

/** The two content hashes recorded for a bilingual pair. */
export interface TranslationPairingRecord {
  /** Git blob hash of the English document. */
  sourceHash: string
  /** Git blob hash of the Simplified Chinese document. */
  zhHash: string
}

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/** Chinese GitHub landing page rendered automatically by the repository home. */
export const ROOT_CHINESE_README = 'README.md'

/** English counterpart of the Chinese-first GitHub landing page. */
export const ROOT_ENGLISH_README = 'README.en.md'

/**
 * Derive the counterpart and consistency-record paths from either document in a pair.
 *
 * @param source - Repository-relative English path, or the Chinese-first root `README.md` alias.
 * @returns The complete three-path pair.
 */
export function translationPairPaths(source: string): TranslationPairPaths {
  if (source === ROOT_CHINESE_README || source === ROOT_ENGLISH_README) {
    return {
      source: ROOT_ENGLISH_README,
      zh: ROOT_CHINESE_README,
      meta: 'README.i18n.yaml',
    }
  }
  if (!source.endsWith('.md') || source.endsWith('.zh.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Derive one pair from its consistency-record path.
 *
 * @param meta - Repository-relative `foo.i18n.yaml` path.
 * @returns The complete three-path pair.
 */
export function translationPairPathsFromMeta(meta: string): TranslationPairPaths {
  if (meta === 'README.i18n.yaml') return translationPairPaths(ROOT_ENGLISH_README)
  if (!meta.endsWith('.i18n.yaml')) {
    throw new Error(`expected a bilingual consistency-record path, received ${JSON.stringify(meta)}`)
  }
  return translationPairPaths(meta.replace(/\.i18n\.yaml$/, '.md'))
}

/**
 * Parse a consistency record for its expected sibling names.
 *
 * @param content - Complete sidecar text.
 * @param paths - Expected sibling paths.
 * @returns The two hashes, or `undefined` for malformed, duplicate, or unexpected keys.
 */
export function parseTranslationPairingRecord(
  content: string,
  paths: TranslationPairPaths,
): TranslationPairingRecord | undefined {
  const hashes = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  const sourceHash = hashes.get(basename(paths.source))
  const zhHash = hashes.get(basename(paths.zh))
  if (hashes.size !== 2 || sourceHash === undefined || zhHash === undefined) return undefined
  return { sourceHash, zhHash }
}

/**
 * Render the canonical consistency record for a pair.
 *
 * @param paths - Pair paths written into the record and its recovery command.
 * @param record - Confirmed content hashes.
 * @returns Canonical YAML text with exactly one trailing newline.
 */
export function renderTranslationPairingRecord(
  paths: TranslationPairPaths,
  record: TranslationPairingRecord,
): string {
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    '',
  ].join('\n')
}
