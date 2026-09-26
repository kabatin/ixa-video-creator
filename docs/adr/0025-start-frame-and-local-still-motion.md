# ADR-0025: 画像からの Take は「最初のフレーム」＋ローカルの画像→動画モデルで作る

Status: Accepted
Date: 2026-09-27
Decider: Claude（Architect）。制作者の選択（2026-09-27「取り込み機能を作る」）

## Context

Take は Provider の生成からしか作れなかった。他のツールで作った絵や撮った写真を Shot に持ち込み、
Take・採用・レビュー・タイムラインの流れに載せる手段が無い。README の作例も、スタブの色のバーしか出せない。

足場は既にあった。

- 手動の参照 `ShotReference(role: 'start_frame', sourceKind: 'manual')` は、生成の仕様を組む側
  （`packages/generation/src/context.ts`）が拾う。作る口（API・画面）だけが無かった
- Provider は参照を `resolveReference(mediaAssetId) → 署名付き URL` で受け取り、出力を
  `{ type: 'local', path }` で返せる。worker はそれを取り込んで Take にする

## Decision

**画像から Take を作ることを「生成」の 1 つとして扱う。** 別の取り込み経路を作らない。

1. **Shot の最初のフレーム** — `GET / PUT / DELETE /shots/{id}/start-frame`。手動の `start_frame`
   参照を 1 件だけ持つ（付け直しは置き換え）。画像で、Project と同じワークスペースの素材だけ受け付ける。
   画面はインスペクターの「参照」に欄を置き、Shot を見ているときの画像ドロップでも付けられる
2. **ローカルの画像→動画モデル `local/still-motion`**（Provider `local`）— 最初のフレームを ffmpeg の
   `zoompan` でゆっくり寄る・引く・横に流す。Shot のカメラ指定（寄り・引き・パン・ティルト・強さ）に従い、
   指定が無ければ seed で選ぶ。**同じ画像から作り直しても毎回違う動画**にし、checksum の重複判定で
   古い Take に化けないようにする。費用 0・鍵不要なので API と worker に常に登録する
3. **能力 `requiresStartFrame`** — 最初のフレームが無ければ検証で落とす。画面は押す前に理由を出す
4. **`routable: false`（AUTO の候補にしない）** — 最初のフレームを付けただけで AUTO が無料の寄りへ
   切り替わると、生成を頼んだつもりが画像を動かすだけになる。明示して選ばせる。生成欄のモデル選択は
   `GET /models` から作る（AUTO だけの固定をやめる）

Take の記録・ポスター・状態・自動レビュー・費用の表示は、今の生成の仕組みのまま動く。

## Consequences

- 絵そのものは入力のまま変わらない（生成モデルではない）。ラベルで「画像から動画（ローカル・無料）」と言う
- 実 Provider の画像→動画（start_frame を受けるモデル）でも、同じ「最初のフレーム」を使える
- 費用メーターではスタブ扱いにしない。0 ドルは実際にかかった額そのもの
- 動画の持ち込み（既存の映像をそのまま Take にする）はまだ無い。要るなら同じ形（参照 → ローカルの Provider）で足す
