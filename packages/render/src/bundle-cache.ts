import { bundle } from '@remotion/bundler'
import { fileURLToPath } from 'node:url'

/**
 * バンドラのエントリポイント。`registerRoot` を呼ぶのはこのファイルだけ。
 * `import.meta.url` から解決するので、実行ディレクトリに依存しない。
 */
const ENTRY_POINT = fileURLToPath(new URL('./remotion-entry.ts', import.meta.url))

/**
 * バンドルは数十秒かかる。**ジョブごとに作り直すとレンダリング時間の大半を占める**ため、
 * プロセス内で 1 度だけ実行して使い回す。
 * コンポジションのコードはプロセス起動後に変わらないので、キャッシュしてよい。
 */
let cachedBundle: Promise<string> | null = null

/**
 * このリポジトリの ESM は `./foo.js` と書いて実体が `foo.ts` / `foo.tsx`（tsconfig の
 * `moduleResolution: Bundler` + `verbatimModuleSyntax`）。
 * Remotion の webpack は既定でこの読み替えをしないため、明示的に教える。
 * これが無いと `Root.js doesn't exist` でバンドルに失敗する。
 */
const EXTENSION_ALIAS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js'],
  '.jsx': ['.tsx', '.jsx'],
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Remotion のコンポジションをバンドルし、`serveUrl`（静的ファイルのパス）を返す。
 * 失敗したキャッシュは残さない。一時的な失敗でプロセス全体が二度とレンダリングできなくなるため。
 */
export const bundleTimelineComposition = (): Promise<string> => {
  if (cachedBundle !== null) return cachedBundle

  const pending = bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, extensionAlias: { ...EXTENSION_ALIAS } },
    }),
  }).catch((error: unknown) => {
    cachedBundle = null
    throw new Error(
      `Remotion のバンドルに失敗しました (entryPoint=${ENTRY_POINT}): ${describe(error)}`,
      { cause: error },
    )
  })

  cachedBundle = pending
  return pending
}

/** テスト用。キャッシュを捨てる。 */
export const clearBundleCache = (): void => {
  cachedBundle = null
}
