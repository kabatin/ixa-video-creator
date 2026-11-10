import type { NarrationTake, ProviderParams, Take } from '@ixa/domain'
import type { DemoSource } from './source-wire.js'

/**
 * 公開する目録から、作る人の**機械と持ち主の情報**を外す（ADR-0067「公開する目録に入れないもの」）。純粋。
 *
 * **中身は残す**（歌詞・方針・指示文・使った AI・種・作り直しの理由・人の判定・キャラクターや声の設定）。
 * 見本は人に見せるために作るので、中身を外すと見本にならない。外すのは次のものだけ:
 *
 * - 作品の名前 → 目録の題。予算 → 無し（null）
 * - Take の送った記録（`providerParams`）→ その形で空にできる値（下の `emptyProviderParams`）。費用 → 0（null を許さない形）
 * - 声の Take の費用 → 0。出自 → ジョブを指さない「写したもの」（入れる側はどのみち写したものとして書く）
 *
 * 作業場所の ID（作品・キャラクター・ロケーション・ブランド資産）は形が必須で外せない。入れる側は使わない（頼んだ作業場所に作る）。
 */

/**
 * 送った記録を、その種類のまま空にする（種類は画面が「持ち込んだ Take」などの見分けに使う）。
 * - http: 送った本文（`request`）を `{}` に。手元のサーバの場所・署名付きの URL が入りうる
 * - cli: コマンド・作業フォルダ・版・出力の要約を `''` に（作業フォルダは作る人のホームの下）。終了コードは残す
 * - import: 持ち込んだファイル名を null に（どのモデルかは中身なので残す）
 * - dub: そのまま（元の Take・読み直したモデル・行の区間だけで、機械の情報が無い）
 */
export const emptyProviderParams = (params: ProviderParams): ProviderParams => {
  switch (params.kind) {
    case 'http':
      return { kind: 'http', request: {} }
    case 'cli':
      return { ...params, command: '', cwd: '', cliVersion: '', stdoutDigest: '' }
    case 'import':
      return { ...params, fileName: null }
    case 'dub':
      return params
  }
}

const neutraliseTake = (take: Take): Take => ({ ...take, providerParams: emptyProviderParams(take.providerParams), costUsd: 0 })

const neutraliseNarrationTake = (take: NarrationTake): NarrationTake => ({
  ...take,
  costUsd: 0,
  source: { type: 'copied', fromTakeId: take.id },
})

export const neutraliseForPublic = (source: DemoSource, options: { readonly title: string }): DemoSource => ({
  ...source,
  project: { ...source.project, name: options.title, budgetUsd: null },
  shots: source.shots.map((entry) => ({ ...entry, takes: entry.takes.map(neutraliseTake) })),
  narrationTakes: source.narrationTakes.map(neutraliseNarrationTake),
})
