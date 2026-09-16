# ADR-0017: Shot 割りはセクションをビートグリッド上で分割する

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

Phase 3 の中心は「音楽セクションから Shot を一括で作る」ことである。
決めるべきは次の 3 点。

1. どこに置くか
2. 何を入力にして何を返すか
3. **グリッドが要求したカット数を支えられないときにどうするか**

3 が本題である。BPM 120 の 4 秒しかないセクションに 16 カットを要求されたら、
ビートは 8 個しか無い。等分すれば尺 0 の Shot ができる。

## Decision

**1. `packages/domain/src/storyboard/shot-allocation.ts` に置く。**

純粋関数で、`snapToBeat` / `expandBeatGrid` は既に domain にある。
Shot も domain のものなので、外部パッケージへ出す理由が無い。

**2. 契約**

```ts
type ShotSlot = { readonly startSec: Seconds; readonly durationSec: Seconds }

type AllocateShotsInput = {
  readonly sectionStartSec: Seconds
  readonly sectionEndSec: Seconds
  readonly beats: readonly Seconds[]
  readonly subdivision: BeatSubdivision
  readonly requestedCount: number
}

type AllocateShotsResult = {
  readonly slots: readonly ShotSlot[]
  readonly requestedCount: number
  /** グリッドが支えられず減らしたときだけ非 null。 */
  readonly reducedReason: string | null
}
```

不変条件（すべてテストする）。

- 隣り合うスロットに隙間も重なりも無い（`slots[i].end === slots[i+1].start`）
- 全体がスナップ後のセクションをちょうど覆う
- 尺 0 のスロットを作らない
- 同じ入力なら必ず同じ結果（決定的。乱数も時計も使わない）
- `beats` が空ならグリッドが無いので等分する

**3. 支えられないときは減らし、減らしたことを必ず返す。**

例外にはしない。16 カットを要求されて 8 しか作れないのは、
利用者の入力が壊れているのではなく音楽がそうなっているだけである。
ただし **黙って減らさない**。`reducedReason` に理由を入れ、API が warning として返す。

## Rationale

例外で止めると、利用者は「では何カットなら通るのか」を試行錯誤で探すことになる。
かといって黙って 8 カットを返すと、16 カット出てくると思っている利用者は
気づかないまま先へ進む。既に `shot_gap` の warning で同じ形（止めないが必ず伝える）を
採っており、それに揃える。

尺 0 を避けるために「最小 1 グリッド」で詰めるやり方もあるが、
**最後の Shot だけが極端に短くなる**ため採らない。要求数を減らして等分するほうが、
出来上がる映像のリズムが音楽に合う。

## Consequences

- `reducedReason` を握り潰す呼び出し側があると、この ADR の意味が消える。
  API の応答に必ず載せ、UI で見えるようにする
- セクションを跨ぐ Shot 割りは扱わない。1 回の呼び出しは 1 セクション
- Shot の `code` / `description` / `camera` はここでは決めない。
  時間だけを返し、残りは呼び出し側が埋める
