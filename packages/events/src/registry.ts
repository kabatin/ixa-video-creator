import type { ProjectEvent } from '@ixa/domain'

/**
 * チャンネルごとの購読者を覚えておく入れ物。**参照カウントの正はここだけ。**
 *
 * 1 つの Project を複数の SSE 接続が同時に購読する。
 * 「最後の 1 人が解除するまで UNSUBSCRIBE しない」を守れないと、
 * タブを 1 つ閉じた瞬間に残りのタブの更新が止まる。しかも例外は出ないので気づけない。
 *
 * 配列は毎回作り直す（破壊的変更をしない）。可変なのは Map ひとつだけ。
 */

/** 購読ごとに 1 つ作る。同じ関数を 2 回渡されても別々に数えるため、包んで識別する。 */
export type ListenerRecord = {
  readonly notify: (event: ProjectEvent) => void
}

export type ChannelRegistry = {
  /** 追加した結果、そのチャンネルの購読者が 1 人目になったか */
  readonly add: (channel: string, record: ListenerRecord) => boolean
  /** 取り除いた結果、そのチャンネルの購読者が 0 人になったか */
  readonly remove: (channel: string, record: ListenerRecord) => boolean
  readonly listeners: (channel: string) => readonly ListenerRecord[]
  readonly count: (channel: string) => number
  readonly clear: () => void
}

export const createChannelRegistry = (): ChannelRegistry => {
  const channels = new Map<string, readonly ListenerRecord[]>()

  const listeners = (channel: string): readonly ListenerRecord[] => channels.get(channel) ?? []

  return {
    listeners,
    count: (channel) => listeners(channel).length,

    add: (channel, record) => {
      const current = listeners(channel)
      channels.set(channel, [...current, record])
      return current.length === 0
    },

    remove: (channel, record) => {
      const current = listeners(channel)
      const index = current.indexOf(record)
      if (index < 0) return false

      const next = [...current.slice(0, index), ...current.slice(index + 1)]
      if (next.length === 0) {
        channels.delete(channel)
        return true
      }
      channels.set(channel, next)
      return false
    },

    clear: () => {
      channels.clear()
    },
  }
}
