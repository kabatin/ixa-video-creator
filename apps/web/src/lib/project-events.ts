import {
  ProjectEvent,
  type ProjectId,
  type ShotId,
  type ShotStatus,
  type TakeId,
} from '@ixa/domain'
import { joinUrl } from '@/lib/http'

/**
 * SSE で届く Project の出来事を、画面が扱える形に落とす純粋関数（Phase 5.8b）。
 *
 * **React を持ち込まないこと。** 繋ぎ直しの間隔も、接続状態の文面も、
 * 一覧への当て方も、ここでタイマー無し・DOM 無しで確かめられる形に保つ。
 * フックは `use-project-events.ts`、表示は `components/live-status-badge.tsx`。
 *
 * 出来事の形の正は `packages/domain/src/events/project-event.ts`。ここでは検証しかしない。
 */

/** SSE の経路。API 側の `GET /projects/{projectId}/events` に対応する。 */
export const projectEventsUrl = (baseUrl: string, projectId: ProjectId): string =>
  joinUrl(baseUrl, `/projects/${projectId}/events`)

/**
 * `data:` の中身を出来事へ直す。**読めなければ null。**
 *
 * ここで例外を投げないのは、1 件読めなかっただけで接続ごと落とさないため。
 * ただし **黙って捨てない**。呼び出し側が数えて画面に出せるよう null を返す（lessons L-015）。
 */
export const parseProjectEvent = (data: string): ProjectEvent | null => {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = ProjectEvent.safeParse(json)
  return parsed.success ? parsed.data : null
}

// --- 繋ぎ直しの待ち時間 ---

/** 1 回目の待ち時間。 */
export const RECONNECT_BASE_MS = 1_000

/** 上限。これ以上は待たない。 */
export const RECONNECT_MAX_MS = 30_000

/** ゆらぎの幅（±20%）。全員が同じ秒に繋ぎ直して API を殴るのを避ける。 */
export const RECONNECT_JITTER = 0.2

/**
 * 指数バックオフ。`attempt` は**失敗した回数**で、1 回目の繋ぎ直しが 1。
 *
 * **乱数を引数で受け取る。** `Math.random` を直に呼ぶとゆらぎの境界を固定できない。
 */
export const reconnectDelayMs = (attempt: number, random: () => number = Math.random): number => {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1
  const base = Math.min(RECONNECT_BASE_MS * 2 ** (safeAttempt - 1), RECONNECT_MAX_MS)
  const jittered = base * (1 + (random() * 2 - 1) * RECONNECT_JITTER)
  return Math.min(Math.round(jittered), RECONNECT_MAX_MS)
}

// --- 接続の状態 ---

/**
 * 画面の自動更新がいまどうなっているか。
 *
 * **`live` と `reconnecting` を混ぜないこと。** `live` は「繋がっていて、まだ何も
 * 起きていない」＝表示は最新。`reconnecting` / `stopped` は「繋がっていない」＝
 * 表示が古い可能性がある。同じ「変化なし」に見えて意味が正反対になる（lessons L-015）。
 */
export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'stopped'

/** 文面の重さ。色分けに使う。`stale` は「表示が古いかもしれない」を意味する。 */
export type LiveTone = 'waiting' | 'live' | 'stale'

export type LiveStateInput = {
  /** 最後に受け取った出来事の時刻（ISO 8601）。まだ何も来ていなければ null。 */
  readonly lastEventAt: string | null
  /** 繋ぎ直しを試みた回数。 */
  readonly attempt: number
}

export type LiveStateDescription = {
  readonly headline: string
  readonly detail: string
  readonly tone: LiveTone
}

export const describeLiveState = (
  state: LiveState,
  { lastEventAt, attempt }: LiveStateInput,
): LiveStateDescription => {
  switch (state) {
    case 'connecting':
      return {
        headline: '自動更新を準備中',
        detail: 'まだ繋がっていません。表示は開いた時点のままです。',
        tone: 'waiting',
      }
    case 'live':
      return {
        headline: '自動更新中',
        detail:
          lastEventAt === null
            ? 'まだ変化はありません。表示は最新です。'
            : '変化を受け取っています。表示は最新です。',
        tone: 'live',
      }
    case 'reconnecting':
      return {
        headline: '自動更新が途切れています',
        detail: `繋ぎ直しています（${String(attempt)} 回目）。表示が古い可能性があります。`,
        tone: 'stale',
      }
    case 'stopped':
      return {
        headline: '自動更新を停止しました',
        detail: '表示が古い可能性があります。最新にするには画面を再読み込みしてください。',
        tone: 'stale',
      }
  }
}

/**
 * `0:00:12` 形式の経過時間。読めない時刻は null（「0 秒前」と偽らない）。
 *
 * **`Date.now()` を中で呼ばない。** 描画のたびに値が変わると、サーバで描いた木と
 * 食い違ってハイドレーションが壊れる（lessons L-019）。呼び出し側が時刻を渡す。
 */
export const formatElapsedSince = (at: string, nowMs: number): string | null => {
  const atMs = Date.parse(at)
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return null
  const total = Math.max(0, Math.floor((nowMs - atMs) / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  return `${String(hours)}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// --- 出来事を一覧へ当てる ---

/**
 * 一覧が出来事を受けるのに必要な最小の形。`Shot` はこれを満たす。
 * 全体を要求しないのは、行の形が変わっても当て方が壊れないようにするため。
 */
export type LiveShot = {
  readonly id: ShotId
  readonly status: ShotStatus
}

export type ApplyProjectEventResult<T extends LiveShot> = {
  /** 当てた結果。**何も変わらなければ元の配列をそのまま返す**（描き直しを起こさない）。 */
  readonly shots: readonly T[]
  /**
   * この出来事で新しく Take ができた Shot。無ければ null。
   *
   * `generation_job.status` の `succeeded` は Shot の状態を動かさない
   * （`shot.status` が別に届く）。ここで捨ててしまうと「Take が増えた」ことが
   * どこにも残らず、一覧は静かなままになる（lessons L-015）。
   * 呼び出し側が印を付けられるよう、副次情報として返す。
   */
  readonly newTake: { readonly shotId: ShotId; readonly takeId: TakeId } | null
  /**
   * この出来事で生成が失敗した Shot。無ければ null。
   *
   * **捨てない。** worker は理由まで作って流している（`generation/events.ts` の
   * `failureMessageOf`）。ここで落とすと、画面には何も出ないまま Shot が
   * 「生成中」で固まり、利用者は遅いのか死んだのか区別できない。
   */
  readonly failure: {
    readonly shotId: ShotId
    readonly jobId: string
    readonly message: string
  } | null
}

/** 理由が空で届いたときの文。**「失敗した」ことだけは必ず伝える。** */
const UNKNOWN_FAILURE = '理由が届きませんでした。変更履歴か生成の記録を確認してください。'

/**
 * 出来事を Shot の一覧へ当てる。**入力を変更しない。**
 *
 * 一覧に無い Shot の出来事は捨てる。絞り込みの外にあるだけで、異常ではない。
 */
export const applyProjectEvent = <T extends LiveShot>(
  shots: readonly T[],
  event: ProjectEvent,
): ApplyProjectEventResult<T> => {
  if (event.type === 'generation_job.status') {
    const known = shots.some((shot) => shot.id === event.shotId)
    const takeId = event.takeId
    return {
      shots,
      newTake:
        known && event.status === 'succeeded' && takeId !== null
          ? { shotId: event.shotId, takeId }
          : null,
      failure:
        known && event.status === 'failed'
          ? {
              shotId: event.shotId,
              jobId: event.jobId,
              message: event.error ?? UNKNOWN_FAILURE,
            }
          : null,
    }
  }

  // **Shot の状態として当てるのは shot.status だけ。** ほかの出来事（絵コンテの画像のジョブなど）を
  // 当てると、ジョブの状態（running など）が Shot の状態に書き込まれる（ADR-0029 で実際に起きかけた）。
  if (event.type !== 'shot.status') return { shots, newTake: null, failure: null }

  const target = shots.find((shot) => shot.id === event.shotId)
  if (target === undefined || target.status === event.status)
    return { shots, newTake: null, failure: null }

  return {
    shots: shots.map((shot) =>
      shot.id === event.shotId ? { ...shot, status: event.status } : shot,
    ),
    newTake: null,
    failure: null,
  }
}
