import type { ReactNode } from 'react'

/**
 * Shot 詳細の並べ方だけを持つ殻（PHASE 6.1）。
 *
 * **判定するものを先に置く。** 以前は サマリ → ロケーション → 生成 → Take の縦一列で、
 * 「この Take でいいか」を決めたい人が、設定の欄を 3 つ通り過ぎてから絵に辿り着いていた。
 * 左（`main`）に判定するもの、右（`rail`）に操作する欄を置く。
 *
 * **この部品は状態を持たない。** 受け取った要素を並べるだけにしてあるので、
 * A/B 比較（P61-2）は `main` の先頭へ差し込むだけで入る。
 *
 * 幅は画面いっぱいを使う（PHASE 5.9 の判断。中央 1000px に寄せない）。
 * `lg` 未満では 1 列に畳み、**絵が先・欄が後**の順序になる（DOM の順序がそのまま効く）。
 */
export type ShotDetailLayoutProps = {
  /** 判定するもの。採用中の Take・A/B 比較・Take 一覧。 */
  readonly main: ReactNode
  /** 操作する欄。サマリ・ロケーション・生成・レビュー。 */
  readonly rail: ReactNode
}

const RAIL_LABEL = 'Shot の操作'

export const ShotDetailLayout = ({ main, rail }: ShotDetailLayoutProps) => (
  /**
   * `lg:items-start` が無いと右の欄が左の高さまで伸び、`sticky` が何も効かなくなる。
   * `min-w-0` が無いと Take 一覧（`overflow-x-auto`）が左の列を押し広げ、右の欄が潰れる。
   */
  <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
    <div className="min-w-0 flex-1 space-y-6">{main}</div>
    <aside
      aria-label={RAIL_LABEL}
      /**
       * 欄が画面より高くなると、貼り付いたまま下端に手が届かなくなる。
       * 高さの上限と自前のスクロールを持たせる（`top-16` は固定ヘッダ 3rem の下）。
       */
      className="w-full space-y-6 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:w-96 lg:shrink-0 lg:overflow-y-auto"
    >
      {rail}
    </aside>
  </div>
)
