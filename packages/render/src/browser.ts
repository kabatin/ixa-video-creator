import { ensureBrowser } from '@remotion/renderer'

/**
 * 書き出しに使う Remotion の headless Chrome（ADR-0065）。`renderMedia` は無ければ初回に取ってくる（約 100MB）。
 * `pnpm ixa doctor` は「あるか」だけを見て、`pnpm ixa setup` は先に取ってくる。
 *
 * **置き場は呼んだときの作業ディレクトリで決まる**（いちばん近い package.json の `node_modules/.remotion`）。
 * 書き出すのは worker なので、呼ぶ側が worker のディレクトリで呼ぶ。渡す設定は書き出し（`renderer.ts`）と同じ既定。
 */

export type RemotionBrowserState = 'ready' | 'missing'

/** 「取ってくる」手前で止めるための印。 */
class WouldDownload extends Error {
  constructor() {
    super('headless Chrome がありません')
    this.name = 'WouldDownload'
  }
}

/**
 * あるか（**取ってこない**）。公開の口は `ensureBrowser` だけなので、取ってくる直前に呼ばれる
 * `onBrowserDownload` で止める（無い・版が違うときだけ呼ばれる）。
 */
export const remotionBrowserState = async (): Promise<RemotionBrowserState> => {
  try {
    await ensureBrowser({
      logLevel: 'error',
      onBrowserDownload: () => {
        throw new WouldDownload()
      },
    })
    return 'ready'
  } catch (error) {
    if (error instanceof WouldDownload) return 'missing'
    throw new Error('Remotion の headless Chrome を確かめられませんでした', { cause: error })
  }
}

/** 無ければ取ってくる。進み具合は `onPercent` に 0〜100 で渡す。 */
export const fetchRemotionBrowser = async (onPercent: (percent: number) => void): Promise<void> => {
  try {
    await ensureBrowser({
      logLevel: 'error',
      onBrowserDownload: () => ({
        version: null,
        onProgress: ({ percent }) => onPercent(Math.round(percent * 100)),
      }),
    })
  } catch (error) {
    throw new Error('Remotion の headless Chrome を取ってこられませんでした', { cause: error })
  }
}
