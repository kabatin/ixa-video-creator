/**
 * 見本の作品の目録とファイルを書き出す（作る人の道具。ADR-0067）。DB は読むだけ。
 * 中身は `src/demo-project/export-cli.ts`（ここは呼んで終えるだけ）。
 *
 *   pnpm --filter @ixa/api demo:export -- --project <作品の ID> --out <フォルダ> \
 *     --demo-key ixa-demo-v1 --base-url https://github.com/<持ち主>/<リポジトリ>/releases/download/<タグ>/ --title <作品の名前>
 *
 * 書き出したフォルダは `DEMO_DIR` に指定して、公開する前に入れて確かめられる。
 */
import { runExportDemo } from '../src/demo-project/export-cli.js'

runExportDemo(process.argv.slice(2), process.env)
  .then(({ manifestPath, review }) => {
    process.stdout.write(`見本の目録を書き出しました: ${manifestPath}\n${review.join('\n')}\n`)
    process.exit(0)
  })
  .catch((error: unknown) => {
    process.stderr.write(`見本を書き出せませんでした: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
