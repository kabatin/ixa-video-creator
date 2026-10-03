import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FolderOpener } from './render-folder.js'

const run = promisify(execFile)

/**
 * Finder で開く（ADR-0036）。**Mac の `open` だけを、シェルを通さずに呼ぶ**（名前に何が入っていても
 * コマンドとして解釈されない）。`-R` はファイルを選んだ状態でそのフォルダを開く。
 */
export const createFinderOpener = (platform: NodeJS.Platform = process.platform): FolderOpener => ({
  canOpen: platform === 'darwin',
  open: async (target) => {
    const args = 'file' in target ? ['-R', target.file] : [target.folder]
    try {
      await run('open', args)
    } catch (error) {
      throw new Error('Finder を開けませんでした', { cause: error })
    }
  },
})
