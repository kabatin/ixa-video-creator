import type { ProviderId } from '@ixa/domain'

/**
 * 手元の生成サーバ 1 台分の身元（ADR-0040）。
 *
 * このディレクトリは **vpipe-api v1 の HTTP 契約**（投入 202 → 状態の問い合わせ → 出力の取得、
 * 満杯は 429、冪等キーで投げ直し安全）を話すクライアントで、サーバの中身がどのモデルかは知らない。
 * サーバごとに違うのは「名前」「失敗の code の頭」「ワークフロー名」「直し方の案内」だけなので、
 * それをこの型 1 つに集める。
 *
 * **ここに増やすのは、どのサーバでも意味が同じものだけ。** モデル固有の都合
 * （コマ数の制約・サンプリングのステップ数・量子化・LoRA・生成解像度）は 1 つも入れない。
 * それはサーバの責務で、ixa は段（draft / standard）しか送らない。
 */
export type LocalServerIdentity = {
  /** Provider の id（`vpipe` / `wan`）。モデル ID の頭にもなる。 */
  readonly providerId: ProviderId
  /** 画面に出る文の頭。**実装の名前（worker / API）を入れない。** */
  readonly label: string
  /**
   * 失敗の code の頭（`vpipe_unreachable` / `wan_busy` など）。英小文字と `_` だけ。
   * サーバごとに分けるのは、どちらが落ちているかを記録から見分けられるようにするため。
   */
  readonly codePrefix: string
  /** サーバ側のワークフロー名。投入の URL の組み立てと Take の記録が見る。 */
  readonly workflowId: string
  /** サーバのプログラム名（`vpipe-api` / `wan-api`）。設定の直し方の案内に出す。 */
  readonly serverName: string
  /** 起動していないときの直し方。**画面にそのまま出る。** */
  readonly startHint: string
  /** 場所の環境変数の名前（`VPIPE_API_URL`）。別のものが応答しているときの案内に使う。 */
  readonly urlEnvName: string
  /** 合言葉の環境変数の名前（`VPIPE_API_TOKEN`）。401 の理由に使う。 */
  readonly tokenEnvName: string
}

/** 失敗の code。サーバの `code` は機械向けの識別子なので、使う前に記号を落とす。 */
export const localServerCode = (identity: LocalServerIdentity, serverCode: string): string => {
  const cleaned = serverCode.replace(/[^A-Za-z0-9_]/g, '')
  return cleaned === '' ? `${identity.codePrefix}_error` : `${identity.codePrefix}_${cleaned}`
}

/**
 * 要求がサーバに**届いていない**と言い切れる失敗（接続拒否・名前が引けない・経路が無い）。
 * サーバが止まっているときの形で、投入なら何も積まれていない。
 */
export const localServerUnreachableCode = (identity: LocalServerIdentity): string =>
  `${identity.codePrefix}_unreachable`

/**
 * 要求を送ったかもしれないのに応答が無い失敗（時間切れ・途中で切れた・本文が読めない）。
 * **投入ならサーバが受け付けているかもしれない。** 呼び出し側は「失敗した」と決めつけない。
 */
export const localServerNoResponseCode = (identity: LocalServerIdentity): string =>
  `${identity.codePrefix}_no_response`

/** 応答の形が契約と違う。pending へ丸めず、終わらないジョブを回し続けないための code。 */
export const localServerInvalidResponseCode = (identity: LocalServerIdentity): string =>
  `${identity.codePrefix}_invalid_response`
