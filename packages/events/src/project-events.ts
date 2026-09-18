import type { ProjectEventPublisher, ProjectEventSubscriber } from '@ixa/domain'

/**
 * 出来事を流す口・受ける口・後片付けの 3 点セット。Redis 版もメモリ版も同じ形を返す。
 *
 * **publish はこの層では投げる。** 契約（domain）が言う「失敗しても本処理を止めない」は
 * 呼び出し側（worker / API）が握って守るもので、ここで握ると失敗が誰にも見えなくなる。
 */
export type ProjectEvents = {
  readonly publisher: ProjectEventPublisher
  readonly subscriber: ProjectEventSubscriber
  /** 自分で作った接続を閉じる。呼び出し側から渡された接続は閉じない。 */
  readonly close: () => Promise<void>
}
