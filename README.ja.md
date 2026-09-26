# iXA Video Creator

**曲から始める。曲を切り、切った一つずつに映像を生成し、プレビューで見たままをミュージックビデオとして書き出す。**

[![CI](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml/badge.svg)](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/kabatin/ixa-video-creator)](https://github.com/kabatin/ixa-video-creator/releases) [![License: MIT](https://img.shields.io/github/license/kabatin/ixa-video-creator)](./LICENSE) [![GitHub stars](https://img.shields.io/github/stars/kabatin/ixa-video-creator?style=social)](https://github.com/kabatin/ixa-video-creator/stargazers)

[English README](./README.md) · MIT · TypeScript モノレポ

![LUNA BREW の作例を開いたワークベンチ。ストーリーボード・拍に合わせたタイムライン・Shot 一覧](./docs/images/workbench.jpg)

---

## 曲が先にある

多くの AI 映像ツールは、プロンプトを書くところから始まってクリップが出てきて、
音楽は後から下に敷くものになる。このツールは逆向きに作ってある。

**入力は完成した曲。** 音源を画面に落とすと librosa で解析され（拍・小節頭・ドロップ・
3 帯域 RMS）、その時点から**曲がそのままタイムラインになる**。

- 映像の尺は曲の尺。はみ出しようがない
- カットはすべて波形上の位置で、聴きながら置く
- Shot の尺は「どこで切ったか」の結果であって、フォームに打ち込む数字ではない
- その尺がそのまま映像モデルへ渡る。返ってくるのは曲が要求した長さの素材になる

つまり作業は**「曲に対して編集を決め、空いた枠を埋める」**であって、
「クリップを作ってから曲に合わせようとする」ではない。
最初の制作物は 1 分 56 秒・27 カットのミュージックビデオ。

![聴きながら切る。セクションの境目に一度で区切りを置き、できるカットを確かめる](./docs/images/cutter.jpg)

## 30 秒 CM を最初から最後まで

作例は **LUNA BREW**（架空の夜のコーヒースタンド）。120 BPM の曲に合わせた 30 秒 CM で、
9 カット、2 人の登場人物。以下はすべて、この Project を開いた実際の画面。

![LUNA BREW の 9 カット。雨の路地、水たまりの三日月ネオン、エスプレッソを淹れるバリスタ、ラテアート、雨の中のライダー、カウンターでの受け渡し、湯気、夜明けの屋上の二人](./docs/images/luna-brew-stills.jpg)

絵はアプリの外で画像モデルに作らせ、各 Shot の**最初のフレーム**として持ち込んだもの。
組み込みの `local/still-motion` モデルが、最初のフレームを Shot のカメラ指定どおりに
ゆっくり寄る・引く・流す動画にして Take にする。費用 0・API キー不要。
あとで実際の画像→動画 Provider に替えても、同じ最初のフレームをそのまま使える。

| | |
|---|---|
| ![通しで再生。上がプレビュー、下がタイムライン](./docs/images/preview.jpg) | ![Take 比較。同じ Shot の 2 本を同じ拍の上で並べる](./docs/images/take-compare.jpg) |
| **プレビューが書き出しそのもの** — プレイヤーと書き出しは同じコンポジション。 | **拍の上で Take を比べる** — Shot の区間を繰り返しながら 2 本を並べる。 |
| ![インスペクター。Shot の時間・カメラ・登場人物・ロケーション・最初のフレーム](./docs/images/inspector.jpg) | ![素材。キャラクターの識別画像と Look](./docs/images/library.jpg) |
| **1 カットのことは 1 か所で** — カメラ、登場人物と Look、ロケーション、最初のフレーム。 | **キャラクター・Look・ロケーション・ブランド** — すべての Shot で使い回す。 |


## 特徴

**曲の構造がデータとして扱える。** 拍と小節頭は実数として持っているので、吸着・絞り込み・
並べ替えの対象になる。各 Shot が拍に対してどこにあるかは出すが、**それを間違いとして扱わない** —
歌い出しに合わせて切るのは選択であって誤りではなく、参考 Project では 27 カット中 16 件が
意図的に拍から外れている。

**プレビューが書き出しそのもの。** プレイヤーと書き出しは*同じ* `TimelineDocument` を
*同じ* Remotion コンポジションに通す。「プレビュー用の別経路」が無いので、
見た目と出力がズレるという種類のバグが構造的に起きない。

**1 本の映像を通して同じ人物を出すための作り。** Look・ロケーション・ブランド資産は
使い回せる実体で、各 Shot の参照画像として解決される。27 回打ち直して少しずつ違えていく
プロンプト文ではない。

**Provider は差し替え可能で、差し替えの検証は無料。** `VideoProvider` は 3 メソッド
（`submit` / `poll` / `cancel`）。ローカルの FFmpeg スタブがそれを完全に実装しているので、
**有料 API を繋ぐ前に**キュー・ポーリング・失敗処理・予算上限まで通しで動かせる。

**お金を第一級の危険として扱う。** Project ごとの予算をサーバ側で、ジョブ投入前に検査する。
スタブに架空の単価を付けられるので、**1 円も使わずに予算ガードが実際に止まることを確かめられる**。
生成が失敗したら Shot を生成中から解放し、通信が一度揺れただけで課金済みの生成を捨てない。

**Take は追記のみ。** 生成し直しても前の結果を上書きしない。1 本を採用し、残りは比較用に残る。

**手持ちの絵を持ち込める。** Shot に最初のフレーム（他の画像ツールの絵や写真）を付けると、
無料のローカルモデルがそれを Take にする。生成した Take と同じく、採用・レビュー・
タイムラインの流れに載る。

## 構成

```
apps/
  web       Next.js のワークベンチ。ドッキング可能なパネル
  api       Hono + zod-openapi
  worker    BullMQ。生成・メディア解析・書き出し
  audio     Python。librosa による解析（拍・小節頭・セクション・波形）
packages/
  domain    純粋。IO 禁止。モデルの唯一の正
  providers アダプタ（映像 / 画像 / LLM）。外部 SDK はここで閉じる
  render    Remotion コンポジションと FFmpeg の計画
  db        Drizzle のスキーマとリポジトリ
```

依存の向きは常に `apps → packages → domain`。逆流しない。

**Shot First.** ストーリーボード・生成・Take・レビュー・タイムラインがすべて 1 つの
エンティティにぶら下がる。`Shot` がマスタータイムライン上の位置 — 曲を切って与えた位置 —
を所有するので、時間が食い違う第 2 の場所が存在しない。時間は秒（float）で持つ。
音の解析が話す単位がそれだから。フレームとミリ秒はドメインにも DB にも入れない。

## 動かす

Node 22 / pnpm 9 / Docker / FFmpeg、音声サービスに [uv](https://docs.astral.sh/uv/) と Python 3.11+ が要る
（Python の依存は初回起動時に `uv` が入れる）。

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install

cp .env.example .env          # 既定は安全。課金は発生しない
pnpm infra:up                 # postgres / redis / minio
pnpm db:migrate
pnpm db:seed                  # ワークスペースを作り、その ID を .env に書く

pnpm dev                      # web :3000, api :3001, worker, audio :8100
```

<http://localhost:3000> を開き、Project を作り、音声ファイルを画面に落として切り始める。
**既定ではローカルのスタブだけで動く。鍵も費用も要らない。**

### 実 Provider を繋ぐ

```bash
# .env
VIDEO_PROVIDER=fal            # 既定は stub
FAL_API_KEY=...
```

ここから生成に実費が掛かる。切り替えは鍵とは別に明示する形にしてある
（鍵を置いただけでは課金経路は開かない）。`fal` にしたのに鍵が無ければ、
黙ってスタブへ落とさず worker が起動時に止まる。

設定 →「接続先と実行の設定」で、どの鍵が設定済みか（**値は出さない**）と、
課金経路が開いているかが見える。

## 費用について

参考 Project（27 Shot・編集尺 110.9 秒）を fal.ai の Seedance 2.5 で作ると、
課金されるのは **140 秒**になる。モデルの最短が 4 秒で、27 件のうち 12 件がそれより短いため。
$0.3024/秒 なら **1 Take ずつで $42、3 Take で $127**。

短いカットが多い作りと 4 秒の下限は相性が悪い。まず 1 Take から始めるとよい。

## 現状

スタブ Provider で通しで動く（解析 → 切る → Shot 作成 → 生成 → レビュー → タイムライン →
H.264 書き出し）。実 Provider のアダプタ（fal.ai / Seedance 2.5）は実装済みでモック応答に
対する契約テストも通っているが、**秒単価と出力 fps はドキュメント由来で未実測**であり、
ソースにもその旨を明記してある。

個人プロジェクトを公開しているもの。インターフェースはまだ動く。

## セキュリティ

**この API に認証は無い。** 既定で `127.0.0.1` にのみ待ち受ける。自分の管理下にない
ネットワークへ公開しないこと。[SECURITY.md](./SECURITY.md) を参照。

## 第三者ライセンス

このリポジトリは MIT だが、依存のうち 2 つは**動かす人**に義務が及ぶ。

- **[Remotion](https://www.remotion.dev/docs/license)** は、操作する人数が 3 人までなら
  無償。**4 人以上は有償ライセンスが要る**。共同で開発・運用する当事者の人数は合算される。
  このリポジトリが MIT であることはその義務を免除しない。
- Provider の API（fal.ai ほか）は、各社の条件で利用者に直接課金される。

## 貢献

Issue・[Discussions](https://github.com/kabatin/ixa-video-creator/discussions)・Pull Request を歓迎する（[CONTRIBUTING.md](./CONTRIBUTING.md)）。まず [AGENTS.md](./AGENTS.md) を読んでほしい。
このコードベースが実際に守らせている規約（イミュータビリティ・境界すべてで zod・`any` 禁止・
シークレットは env のみ・Take は追記のみ）が書いてある。命名と画面の言葉は `CLAUDE.md`。
[docs/LESSONS.md](./docs/LESSONS.md) には、このプロジェクトで実際に踏んだ失敗と、そこで
決めた規則をまとめてある（ほとんどが「テストは緑なのに何も確かめていなかった」の変種）。

PR を出す前に CI と同じものを回す:

```bash
npx turbo run lint typecheck test --concurrency=2
```

役に立ちそう・面白そうと思ったら、⭐ を付けてもらえると他の人が見つけやすくなる。

## ライセンス

[MIT](./LICENSE) © Hiroshi Kabayama
