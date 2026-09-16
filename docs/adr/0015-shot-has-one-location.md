# ADR-0015: Shot はロケーションを 1 つだけ持つ（中間表を作らない）

Status: Accepted
Date: 2026-09-16
Decider: Architect

## Context

`resolveReferences` は `location` ロールの参照を組み立てられるが、**一度も使われていない**。
`GenerationContextSource.locationsForShot` が常に空を返すためで、その理由は
Shot とロケーションを結ぶ手段がドメインに存在しないことにある。

- `Location` 型はある（DOMAIN.md §6）
- `locations` 表とリポジトリもある
- しかし `Shot` に場所を指す項目が無く、中間表も無い

Phase 2 の Goal は「Character / Look / Brand / Location を登録し、参照の自動解決が
実際に動く」なので、ここを埋めないと Phase 2 は閉じない。

## Decision

**`Shot.locationId: LocationId | null` を 1 つ持たせる。中間表は作らない。**

```ts
type Shot = {
  // ...
  locationId: LocationId | null
}
```

`locationsForShot` は 0 件か 1 件の配列を返す。Port の形（`readonly Location[]`）は変えない。

## Rationale

Shot は**ひと続きのカット**である（ADR-0002）。カメラが回り続けている間に場所が
変わるなら、それは 2 つの Shot であって 1 つではない。つまり
「1 つの Shot に複数のロケーション」は、ドメインとして成立しない状態である。

多対多の中間表はこの成立しない状態を**表現できてしまう**。
`ShotCharacter` に中間表を使っているのは、1 カットに複数人が映るのが当たり前だからで、
同じ形をロケーションに当てはめる理由にはならない。

列 1 つで済むものを表にすると、次の代償を払う。

- 参照解決のたびに JOIN が 1 段増える
- 「0 件」と「2 件以上」という、あり得ない状態の扱いをコード中に持ち続ける
- 一意制約で 1 件に縛るなら、それは列と同じものを遠回りに書いているだけ

`onDelete` は `restrict` にする。参照されているロケーションを消せてしまうと、
Shot が実在しないロケーションを指し、生成が `GenerationContextError` で止まる。

## Consequences

- `shots` に `location_id` 列を足すマイグレーションが要る。既存行は `NULL` で始まる
- ロケーションを複数割り当てたくなったら、この ADR を置き換えて中間表へ移行する。
  その時点で Shot の定義自体を見直すことになる
- ロケーション参照がモデルへ渡るのは `location` ロールを宣言したモデルだけ。
  スタブは `stub/seedance-like` が宣言している
