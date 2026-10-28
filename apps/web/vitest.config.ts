import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Node 25 以降は Node 自前の `localStorage` が既定で有効になり、jsdom の `localStorage` を隠す
 * （`--localstorage-file` が無いと undefined になり、`localStorage.clear()` で落ちる）。
 * テストの worker では切って jsdom のものを使わせる。
 * 24 以前はこの既定が無いので何も渡さない（22 の古い版はこの印自体を知らない）。
 */
const NODE_WEBSTORAGE_DEFAULT_MAJOR = 25
const nodeMajor = Number(process.versions.node.split('.')[0])
const workerExecArgv =
  nodeMajor >= NODE_WEBSTORAGE_DEFAULT_MAJOR ? ['--no-experimental-webstorage'] : []

export default defineConfig({
  /**
   * JSX を変換する。Next.js の変換はここには効かないため自前で指定する。
   * プラグインではなく esbuild を使うのは、@vitejs/plugin-react が要求する
   * Vite の版が、vitest 2.x が持つ版と噛み合わないため。
   */
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    /**
     * 既定は node。純粋関数のテストはブラウザ環境を要らない。
     *
     * **`.test.tsx` だけ jsdom にする。** 以前は環境が node 固定で `include` も
     * `.test.ts` のみだったため、**部品の描画テストが 1 つも書けなかった**。
     * 確認ダイアログのように「押しても即座には実行されない」ことを保証したい部品を、
     * 実装を読む以外の方法で確かめられなかった。
     */
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    poolOptions: { forks: { execArgv: workerExecArgv } },
  },
})
