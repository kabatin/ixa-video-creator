# iXA Video Creator

**曲から始める。歌詞の時刻を合わせ、曲を切り、絵コンテ・絵・映像の下書きを AI に任せ、プレビューで見たままをミュージックビデオとして書き出す。**

[![CI](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml/badge.svg)](https://github.com/kabatin/ixa-video-creator/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/kabatin/ixa-video-creator)](https://github.com/kabatin/ixa-video-creator/releases) [![License: MIT](https://img.shields.io/github/license/kabatin/ixa-video-creator)](./LICENSE) [![GitHub stars](https://img.shields.io/github/stars/kabatin/ixa-video-creator?style=social)](https://github.com/kabatin/ixa-video-creator/stargazers)

[English README](./README.md) · MIT · TypeScript モノレポ

![デモ。空の Project に曲を落とすと解析され、セクションの境目が一度で区切りになり、Shot になり、最初のフレームから Take ができ、曲に合わせて通しで再生される](./docs/images/demo.webp)

<sub>曲を落とす → セクションの境目で切る → Shot → Shot ごとに Take → 通しで再生。LUNA BREW の作例を実際に操作して録画した（Take の生成待ちだけ切っている）。</sub>

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
- 歌詞のある曲なら、流しながら各行の歌い出しで打つだけで時刻付きのテロップになる。絵を 1 枚も作らないうちに、黒い画面で確かめられる

つまり作業は**「曲に対して編集を決め、空いた枠を埋める」**であって、
「クリップを作ってから曲に合わせようとする」ではない。
最初の制作物は 1 分 56 秒・27 カットのミュージックビデオ。

![聴きながら切る。セクションの境目に一度で区切りを置き、できるカットを確かめる](./docs/images/cutter.jpg)

## 空の Project から書き出しまで

メニューの下の帯が、作業の最初から最後までを案内し、次にやる段をいつも目立たせる。
済んだ段には ✓ が付き、途中の段は進み具合（件数）が出る。

![制作の流れの帯。楽曲・作品の方針・歌詞の時刻・テロップ・区切って Shot・絵コンテは済み、絵は 44 件中 40 件で次の段として目立っている、Take は 44 件中 7 件、書き出すは済み](./docs/images/flow-bar.png)

1. **楽曲** — 音源を落とす。拍・小節頭・セクションを解析する。
2. **作品の方針** — コンセプト・あらすじ、歌詞、ルック（画風・光・質感）。避けたいものと手本画像も。
   全部の生成に自動で足されるので、書くのは 1 回でよい。「歌詞なし」にすると歌詞の段は飛ばす。
3. **歌詞の時刻** — 曲を流し、各行の歌い出しで Enter を押す。
4. **テロップ** — 時刻の付いた行がテロップになる。プレビューは曲とテロップを黒い画面で流すので、
   絵を作らずに（お金を掛けずに）タイミングを確かめられる。
5. **区切って Shot** — 聴きながら区切りを置く（Enter は画面のどこでも効き、拍に吸着する）。
   セクションの境目や歌い出しに一度で置くこともできる。区切りは下書きで、「N カットを Shot にする」で保存する。
6. **絵コンテ** — 全 Shot の説明と雰囲気を AI が下書きし、1 件ずつ「なぜこの絵か」を添える。
   その Shot の間に歌われる歌詞・登場人物・ロケーション・ルックを読んで書く。採用するまで Shot は変わらない。
   自分で書いてもよい。
7. **絵** — 各 Shot の最初のフレームを、絵コンテと登場人物の参照画像から AI が描く。1 枚ずつ順に作り、
   いつでも止められる。
8. **Take** — 最初のフレームから、Shot ごとの映像を作る。作っている間は、順番待ち・生成先で順番待ち・作成中を
   分けて出し、経過と目安も出す。いつでも止められる。
9. **書き出す** — H.264。全体か、選んだ Shot だけ。`~/Movies/ixa-video-creator/<作品名>/` に置かれ、
   ボタン 1 つで Finder で開ける。

段を飛ばしてもよいが、飛ばす前に確かめる（例: 絵コンテの無い Shot の絵を作る前）。

## 30 秒 CM を最初から最後まで

作例は **LUNA BREW**（架空の夜のコーヒースタンド）。120 BPM の曲に合わせた 30 秒 CM で、
9 カット、2 人の登場人物。

![LUNA BREW の 9 カット。雨の路地、水たまりの三日月ネオン、エスプレッソを淹れるバリスタ、ラテアート、雨の中のライダー、カウンターでの受け渡し、湯気、夜明けの屋上の二人](./docs/images/luna-brew-stills.jpg)

この絵はアプリの外で画像モデルに作らせ、各 Shot の**最初のフレーム**として持ち込んだもの（今もこの使い方はできる）。
v0.2 からは、最初のフレームをアプリの中でも描ける。組み込みの `local/still-motion` モデルが、最初のフレームを
Shot のカメラ指定どおりにゆっくり寄る・引く・流す動画にして Take にする。費用 0・API キー不要。
あとで別の動画モデルに替えても、同じ最初のフレームをそのまま使える。

| | |
|---|---|
| ![通しで再生。上がプレビュー、下がタイムライン](./docs/images/preview.jpg) | ![Take 比較。同じ Shot の 2 本を同じ拍の上で並べる](./docs/images/take-compare.jpg) |
| **プレビューが書き出しそのもの** — プレイヤーと書き出しは同じコンポジション。 | **拍の上で Take を比べる** — Shot の区間を繰り返しながら 2 本を並べる。 |
| ![インスペクター。Shot の時間・カメラ・登場人物・ロケーション・最初のフレーム](./docs/images/inspector.jpg) | ![素材。キャラクターの識別画像と Look](./docs/images/library.jpg) |
| **1 カットのことは 1 か所で** — カメラ、登場人物と Look、ロケーション、最初のフレーム。 | **キャラクター・Look・ロケーション・ブランド** — Project ごとに持ち、ほかの Project から取り込める。 |


## 特徴

**曲の構造がデータとして扱える。** 拍と小節頭は実数として持っているので、吸着・絞り込み・
並べ替えの対象になる。各 Shot が拍に対してどこにあるかは出すが、**それを間違いとして扱わない** —
歌い出しに合わせて切るのは選択であって誤りではなく、参考 Project では 27 カット中 16 件が
意図的に拍から外れている。

**プレビューが書き出しそのもの。** プレイヤーと書き出しは*同じ* `TimelineDocument` を
*同じ* Remotion コンポジションに通す。「プレビュー用の別経路」が無いので、
見た目と出力がズレるという種類のバグが構造的に起きない。

**用途ごとに AI を選べる。手元に入っているものを使う。** テキスト（絵コンテの案・入力の手伝い）は
Claude Code・Codex・Grok、画像は Codex、動画は無料のローカルモデルか fal。CLI は自分のアカウントで
サインインしたまま動くので、そのための API キーをアプリに置かない。

**AI の下書きは作業を上書きしない。** 絵コンテの案は「いまの説明」と並べ、1 件ずつ理由を添える。
Shot が変わるのは案を採用したときだけ。まとめて変えた操作は記録して戻せる。Take は追記のみで、
生成し直しても前の結果を上書きしない。

**1 本の映像を通して同じ人物を出すための作り。** キャラクター・Look・ロケーション・ブランド資産は
各 Shot の参照画像として解決される。27 回打ち直して少しずつ違えていくプロンプト文ではない。
キャラクターシート（四面図）は画像 1 枚から作れ、絵コンテの案には、文字で書いた外見だけを使わせる
（それ以外の見た目は参照画像が決める）。

**Provider は差し替え可能で、差し替えの検証は無料。** `VideoProvider` は 3 メソッド
（`submit` / `poll` / `cancel`）。ローカルの FFmpeg スタブがそれを完全に実装しているので、
**有料 API を繋ぐ前に**キュー・ポーリング・失敗処理・予算上限まで通しで動かせる。

**お金を第一級の危険として扱う。** Project ごとの予算をサーバ側で、ジョブ投入前に検査する。
スタブに架空の単価を付けられるので、**1 円も使わずに予算ガードが実際に止まることを確かめられる**。
生成が失敗したら Shot を生成中から解放し、通信が一度揺れただけで課金済みの生成を捨てない。

## 構成

```
apps/
  web       Next.js のワークベンチ。ドッキング可能なパネル（ストーリーボード・聴きながら切る・タイムライン・比較・絵コンテの案）
  api       Hono + zod-openapi
  worker    BullMQ。動画と画像の生成・メディア解析・書き出し
  audio     Python。librosa による解析（拍・小節頭・セクション・波形）
packages/
  domain    純粋。IO 禁止。モデルの唯一の正
  providers アダプタ（映像 / 画像 / LLM）。外部 SDK と CLI はここで閉じる
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
（Python の依存は初回起動時に `uv` が入れる）。AI でテキストや絵を作るなら、
[Claude Code](https://docs.anthropic.com/en/docs/claude-code)・[Codex](https://github.com/openai/codex)・Grok CLI の
どれかを同じ Mac でサインインしておく（任意）。

```bash
git clone https://github.com/kabatin/ixa-video-creator.git
cd ixa-video-creator
pnpm install

cp .env.example .env          # 既定は安全。課金は発生しない
# 素材を画面へ見せる URL の署名の鍵（手元のファイルに置くときは必須。ADR-0041）
printf 'STORAGE_SIGNING_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
pnpm infra:up                 # postgres / redis
pnpm db:migrate
pnpm db:seed                  # ワークスペースを作り、その ID を .env に書く

pnpm dev                      # web :3000, api :3001, worker, audio :8100
```

<http://localhost:3000> を開き、Project を作り、音声ファイルを画面に落とす。あとは流れの帯が案内する。
**既定ではローカルのスタブだけで動く。鍵も費用も要らない。**

### 使う AI を選ぶ

![「使う AI」の画面。この Mac で見つかった AI から、テキスト・画像・動画ごとに 1 つ選ぶ](./docs/images/ai-chooser.jpg)

初めてワークベンチを開くと「使う AI」が出る。この Mac に入っている AI の CLI と手元の生成サーバを探し、
用途ごとに 1 つ選ぶ。

| 用途 | 選べるもの |
|---|---|
| テキスト — 絵コンテの案・✦ AI（入力の手伝い）・自動レビュー | Claude Code・Codex・Grok・お試し |
| 画像 — Shot の最初のフレーム・キャラクターシート | Codex・お試し |
| 動画 — Take（AUTO はこの AI のモデルから選ぶ） | 静止画を動かす（無料）・手元の MiniMax H3（vpipe・無料）・手元の Wan 2.2 5B（wan・無料）・fal（従量課金）・お試し |

あとからメニュー「iXA Video Creator > 使う AI…」で変えられる。選ぶまでは `.env` の設定のまま動く。
お金が掛かる fal と手元の生成サーバは、下の `.env` で有効にしてから選べる（画面だけでは有料の口を開けない）。
Codex の画像は契約の利用枠を使い、1 枚 1 分ほどかかるので、1 枚ずつ順に作る。

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

### この Mac で作る（任意）

手元の生成サーバを動かしていれば、無料のローカル Provider として使える。2 つあり、**両方同時に有効にできる**。

| サーバ | モデル | 既定の場所 |
|---|---|---|
| [vpipe-api](https://github.com/kabatin/vpipe-api) | MiniMax H3 Turbo | `http://127.0.0.1:8765` |
| [wan-api](https://github.com/kabatin/wan-api) | Wan 2.2 TI2V-5B | `http://127.0.0.1:8766` |

```bash
# .env（カンマ区切り。既定は none）
LOCAL_VIDEO_GENERATOR=vpipe,wan
VPIPE_API_URL=http://127.0.0.1:8765
VPIPE_API_TOKEN=              # URL がこのマシンの外を指すときだけ要る
WAN_API_URL=http://127.0.0.1:8766
WAN_API_TOKEN=                # 同じ
```

使い方は 3 つだけ。**サーバを起動 → `LOCAL_VIDEO_GENERATOR` に書く → 「使う AI」の動画で選ぶ。**
入れ方と動かし方は各サーバの README にある。

書いたサーバのモデルが、下書きと標準の 2 つずつ出る。AUTO がその中から選ぶのは、
「使う AI」の動画でそのサーバを選んでいるときだけ。

**どちらも同じ GPU とメモリを使うので、同時には作らない。** 2 本頼むと順に仕上がり、
待っている 1 本は「作成中」ではなく「順番待ち」と出す。

**Wan は 5 秒までしか作れない**（wan-api の契約）。5〜7.5 秒の Shot は 5 秒で作ってゆっくり再生で埋め、
7.5 秒を超える Shot は「分けてください」と出る。長いカットは MiniMax H3（10.125 秒まで）を使う。

実測（M5 10 コア GPU・32GB・AC 電源・出力 832x480。5 秒 1 本）:

| | H3（draft） | Wan（draft） | Wan（standard） |
|---|---|---|---|
| 所要時間 | **7.4 分** | 11.3 分 | 19.4 分 |
| 1 コマ目と開始画像の近さ（SSIM） | 0.695 | **0.851** | 0.852 |

**H3 のほうが速く、Wan のほうが最初のフレームを保つ。** どちらを使うかは作る人が選ぶ
（見た目の良し悪しは点を付けていない）。詳細は
[ADR-0031](./docs/adr/0031-local-h3-video-via-vpipe-api.md) と
[ADR-0040](./docs/adr/0040-local-wan-2-2-video-via-wan-api.md)、
wan-api の [benchmark.md](https://github.com/kabatin/wan-api/blob/main/docs/benchmark.md)。

なお wan-api の口を `drawthings` にすると最初のフレームが使えない（`mlx` の口を使う。既定は `mlx`）。

## 費用について

fal 以外は無料で動く（スタブ・`local/still-motion`・手元の MiniMax H3 と Wan 2.2）。Claude Code・Codex・Grok は、
サインインしている契約の範囲で使う。

参考 Project（27 Shot・編集尺 110.9 秒）を fal.ai の Seedance 2.5 で作ると、
課金されるのは **140 秒**になる。モデルの最短が 4 秒で、27 件のうち 12 件がそれより短いため。
$0.3024/秒 なら **1 Take ずつで $42、3 Take で $127**。

短いカットが多い作りと 4 秒の下限は相性が悪い。まず 1 Take から始めるとよい。

## 現状

空の Project から書き出しまで通しで動く（解析 → 作品の方針 → 歌詞の時刻 → テロップ → 切る →
AI の絵コンテの案 → AI の最初のフレーム → Take → レビュー → タイムライン → H.264 書き出し）。
ローカルの動画（静止画を動かす・vpipe 経由の MiniMax H3・wan-api 経由の Wan 2.2 5B）は実機で測ってある。
ただし **Wan はまだ ixa から 1 本も作っていない**（計測は wan-api 側で取った。アダプタは契約テストまで。ADR-0040）。fal.ai / Seedance 2.5 の
アダプタは実装済みでモック応答に対する契約テストも通っているが、**秒単価と出力 fps はドキュメント由来で未実測**であり、
ソースにもその旨を明記してある。

個人プロジェクトを公開しているもの。インターフェースはまだ動く。

## セキュリティ

**この API に認証は無い。** 既定で `127.0.0.1` にのみ待ち受ける。自分の管理下にない
ネットワークへ公開しないこと。[SECURITY.md](./SECURITY.md) を参照。

## 第三者ライセンス

このリポジトリは MIT だが、依存のいくつかは**動かす人**に義務が及ぶ。

- **[Remotion](https://www.remotion.dev/docs/license)** は、操作する人数が 3 人までなら
  無償。**4 人以上は有償ライセンスが要る**。共同で開発・運用する当事者の人数は合算される。
  このリポジトリが MIT であることはその義務を免除しない。
- Provider の API（fal.ai ほか）は、各社の条件で利用者に直接課金される。
- Claude Code・Codex・Grok は、利用者自身のアカウントと各社の条件で動く。
- **MiniMax H3**（手元の生成を有効にした場合だけ）の重みは MiniMax H3 Community License で、
  利用できる地域・用途に制限がある。ixa は重みを同梱しない。有効にする前に条件を確かめること。
- **Wan 2.2**（同じく、有効にした場合だけ）の重みは Apache-2.0 で公開されている（商用可）。
  ixa は重みを同梱しない。配布の条件（著作権表示とライセンス文の保持）は動かす人に及ぶので、
  モデルカードを確かめること。

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
