/** 版（`0.8.0`）の読み書きと比べ方（純粋）。プレリリース（`-rc.1`）は扱わない（タグに使っていない）。 */

export type Version = { readonly major: number; readonly minor: number; readonly patch: number }

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/

export const parseVersion = (text: string): Version | null => {
  const match = VERSION_PATTERN.exec(text.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export const formatVersion = (v: Version): string => `${String(v.major)}.${String(v.minor)}.${String(v.patch)}`

/** a が新しければ正、同じなら 0、古ければ負。 */
export const compareVersions = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch

/** 版のタグ（`vX.Y.Z`）のうち、いちばん新しいもの。無ければ null。 */
export const latestVersionTag = (tags: readonly string[]): { readonly tag: string; readonly version: Version } | null =>
  tags
    .filter((tag) => tag.startsWith('v'))
    .map((tag) => ({ tag, version: parseVersion(tag) }))
    .filter((entry): entry is { tag: string; version: Version } => entry.version !== null)
    .reduce<{ tag: string; version: Version } | null>(
      (best, entry) => (best === null || compareVersions(entry.version, best.version) > 0 ? entry : best),
      null,
    )

/** 先頭の数字（`v22.11.0` → 22）。 */
export const majorOf = (text: string): number | null => parseVersion(/\d+\.\d+\.\d+/.exec(text)?.[0] ?? '')?.major ?? null

/** 文の中の最初の `X.Y.Z`。 */
export const versionIn = (text: string): string | null => /\d+\.\d+\.\d+/.exec(text)?.[0] ?? null
