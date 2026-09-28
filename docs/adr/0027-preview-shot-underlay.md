# ADR-0027: プレビューの Shot の下に直近のコマを敷き、境目の黒を出さない

Status: Accepted
Date: 2026-09-28
Decider: Claude（Architect）。制作者の報告（iPad Pro の Safari で、カットの境目に黒いコマが見える）

## Context

プレビューを通しで再生すると、Shot の境目に黒いコマが挟まった。原因は 3 つ重なっていた。

1. Player は `<Sequence>` が始まった瞬間に素材を読み込み始める → 境目ごとに 0.1〜0.2 秒の黒
2. 待っている Shot を Remotion は `opacity: 0` で隠す。ブラウザはそのコマを画面に出さないので、
   見え始めの 1 コマが黒（Chrome で画面のコマを全部取って実測。45 秒で 9 か所中 6 回）
3. Safari（WebKit）は、切り替わる瞬間や頭出しの間、動画要素に何も描かない（透ける）。
   下に何も無いので背景の黒が見える（WebKit の録画で最長 9 コマ）

## Decision

`<video>` 方式（`<OffthreadVideo>`）のまま、プレビューでだけ次の 3 つを行う。書き出しの絵は変えない。

1. **Shot とクリップを 1 秒前から組み立てる**（`premountFor`）
2. **前の Shot と隙間なく続く Shot は、待っている間も見える状態で裏に置く**（`styleWhilePremounted: opacity 1`）。
   後の Shot ほど重なり順が低いので、いまの Shot に隠れる。隙間の後の Shot は隠したまま（黒のはずの間に頭を見せない）
3. **各 Shot の動画の下に、直近に描いたコマを写した canvas を敷く**（`PreviewShotVideo`）。
   Remotion の `onVideoFrame` と、動画要素の `loadeddata` / `seeked` / `canplay` で写す
   （WebKit は止まっている動画のコマでは `onVideoFrame` を出さないことがある）
4. **切り替わった後も、前の Shot を 1 秒だけ一番下に残す**（`postmountFor`、`zIndex: -1`、根に `isolation`）。
   次の Shot の動画が読み込みに間に合わないとき、前の Shot の下敷きに残る最後のコマが見える

書き出し（renderMedia）では Remotion が premount / postmount を使わず、下敷きも敷かない
（`ShotVideo` が `isRendering` で分ける）。画素のテストはそのまま通る。

## 却下した案: プレビューを WebCodecs（`@remotion/media`）で描く

canvas に 1 コマずつ描くので Safari の頭出しの空白は起きないが、採らなかった。

- iPad Pro の Safari で制作者が試すと、黒はかえって増えた
- Playwright の WebKit では再生が実時間の半分ほどに落ちた
- シークの直後にコマの読み込み待ちが入り、Player が一時停止と再開を短い間に繰り返して
  AudioContext の時刻が止まり、再生が進まなくなった（Chrome で再現）

## Consequences

- 描かれたコマを数える計測で、境目の黒は Chrome・WebKit とも 0（WebKit は 60 秒 × 3 回）
- 読み込みが間に合わない瞬間は、黒ではなく直前のコマ（または前の Shot の最後のコマ）が一瞬止まって見える
- 下敷きへの写しで、プレビュー中は 1 コマごとに canvas へ描く手間が増える（720p で 1〜2 本分）
