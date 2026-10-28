# ADR-0064: 手元の生成 AI を選んで入れる（`pnpm ixa ai install | connect | status` と `tools/ixa-ai/ixa_ai.py`）

Status: Accepted
Date: 2026-10-28
Decider: Claude（Architect）
Supersedes: ADR-0063 の「分かっている不足」の「手元の AI サーバー自体の導入・更新は扱わない」

## 背景

- 制作者（2026-10-28）「対応している各種生成モデルを複数選択式でインストールするものを選びながらセットアップするようなものがあるといい」。
- `pnpm ixa setup` で画面は開けるが、手元の生成 AI（vpipe-api・wan-api・klein-api・ace-step-api・sfx-api）は入らない。
  入れても `.env` の既定はどれも `none` なので、選べるようにはならない。
- 決めてもらったこと: 入れ方は**各サーバーのリポジトリに `setup` を足す**。**同じ Mac と別の Mac（AI 用）の両方**に対応する。

## 決めたこと

### 1. 入れ方の知識は各サーバー、選ぶのは ixa

- 5 つのサーバーに同じ形の `<cli> setup [--models …] [--check] [--yes] [--json] [--lan] [--service] [--coordinate-with NAME=URL]`
  を足す（各リポジトリ）。`--json` は最後の 1 行だけ stdout に JSON を出す。
- ixa 側の `tools/ixa-ai/ixa_ai.py` は**選ぶ・同意を取る・呼ぶ・答えをまとめる**だけ。エンジンや重みの取り方は持たない。

### 2. `ixa_ai.py` は 1 ファイルの Python（標準ライブラリだけ・PEP 723）

- 別の Mac では ixa の clone も Node も無い。`uv run https://raw.githubusercontent.com/kabatin/ixa-video-creator/<版>/tools/ixa-ai/ixa_ai.py install --lan`
  の 1 行で動くよう、1 ファイルにする。
- 一覧（モデルの ID・サーバー・ixa の AI の ID・容量・メモリ・最低の macOS・ライセンスの要点と URL）は
  `tools/ixa-ai/catalog.json`。**同じものをスクリプトに埋め込み**、テストで一致を確かめる（URL から動かすと隣のファイルを読めない）。
- 流れ: 機械を確かめる（Apple Silicon は `sysctl hw.optional.arm64` で見る。Rosetta の Python でも正しく分かる・`sw_vers`・メモリ・空き・uv）→
  一覧（この Mac で動かないものは理由つきで選べない）→ 番号で選ぶ（`1,3,7`・`2-4`・`all`）→ ライセンスの同意を 1 つずつ →
  合計の容量と空き（1.1 倍の余裕）→ 要るサーバーだけ `uv tool install git+https://github.com/kabatin/<repo>@<ref>` →
  `<cli> setup --models … --json --yes [--lan] [--service] --coordinate-with …` → 最後の行の JSON を読む → 答え。
- `--yes` のときは、選んだ ID が**全部** `--accept-licenses` に無ければ何も入れない（終了コード 3・`needsHuman`）。
  ライセンスの同意を黙って飛ばさない。
- 同じ GPU を順番に使うよう、入れるサーバー同士と、すでに入っているサーバーを `--coordinate-with` で教える。
- whisper.cpp（文字起こし）はサーバーではないので、`brew install whisper-cpp` と `ggml-large-v3-turbo.bin`（約 1.6 GB）を
  `~/.local/share/whisper.cpp/` に取る。Homebrew は `--yes` か端末での「はい」が要る。`--lan` では入れない（ixa の Mac で動かすもの）。
  モデルは Hugging Face の版（commit）を固定した URL から `.part` に落とし、**固定した sha256 が合ったときだけ**置く。
  失敗・不一致では `.part` を残さない。
- 終了コード: 0 済み・1 失敗・2 引数・3 人の同意が要る（サーバーと同じ）。

### 3. 合言葉（token）

- `--lan` のときだけ、サーバーごとに `secrets.token_urlsafe(32)` を作り、**環境変数** `<PREFIX>_TOKEN`（例 `SFX_API_TOKEN`）で
  `setup` に渡す。引数には載せない（`ps` に出る）。
- サーバーは `<PREFIX>_TOKEN` があればそれを設定に書く（**既にある設定の合言葉より環境変数が勝つ**。5 台の
  `setup/config_write.py` で確かめた）。それでも接続コードに入れるのは、`setup` の答えが **`tokenSet: true`** のサーバーだけ
  （作った合言葉と違うものが残っていれば 401 になるため）。`false` のサーバーは失敗として返す（`components` に 1 行足す）。
- 最後に接続コードを**端末（/dev/tty）に 1 回だけ**出し、「ixa の Mac で `pnpm ixa ai connect` を打ち、聞かれたら貼る」と案内する
  （引数で渡すと `ps` や履歴に残る）。**/dev/tty を開けなければどこにも出さず**、端末で回し直すよう頼む（終了コード 3）。
  接続コードは `base64url(JSON{v:1, servers:[{id,url,token}]})`。URL はホスト名（`<LocalHostName>.local`）で書く（IP はよく変わる）。
- `--json` のときは、引数の誤り（終了コード 2）や思わぬ失敗（1）でも、最後に JSON を 1 つだけ出す。
- 番号の代わりの「動くもの全部」（`all`・`a`・`全部`）は、どの語でも動かないものを外す。
- `--json` の答え・`--result-file`・ログには合言葉も接続コードも入れない。テストが確かめる。

### 4. ixa の CLI（`apps/cli`）

- `pnpm ixa ai install`: `uv run tools/ixa-ai/ixa_ai.py install --result-file ~/.cache/ixa/ai-install-result.json …` を
  `inherit: 'to-stderr'` で呼ぶ（端末での質問はそのまま通る）。答えのファイルを zod で読んで消し、`env` を `.env` に書いて doctor を回す。
  `--plan` は一覧だけ（何も変えない）。`--lan` は止めて「別の Mac で回す」1 行を案内する。
- `pnpm ixa ai connect [接続コード]`: 読んで `LOCAL_*_GENERATOR`・`*_API_URL`・`*_API_TOKEN` を書き、doctor を回す。
  - **接続コードは引数で渡さず、聞かれてから貼るのを勧める。** 引数は `ps` の一覧とシェルの履歴（`~/.zsh_history`）に残り、
    接続コードには合言葉が入っている。省くと、端末では画面に出さずに聞き（`promptSecret`）、端末でなければ stdin を読む
    （`… | pnpm ixa ai connect`）。引数の形も残す（使い捨ての端末・CI 向け）が、手順書では聞く形だけを書く。
  - 引数の誤りの文には打った語を写さない（`pnpm ixa connect <接続コード>` のように `ai` を抜かして貼ることがある。数だけ言う）。
- `.env` の書き方（`apps/cli/src/ai/env-merge.ts`、純粋）:
  - `LOCAL_*_GENERATOR` は今の一覧に足す。`none` を外し、重ねず、今の順を残す。
  - 値の入った `*_API_URL`・`WHISPER_CPP_MODEL` を**別の値に替えるのは `--overwrite-env` か端末での「はい」のときだけ**。既定の URL は空とみなす。
    `--yes` では替えない（`--yes` は ixa_ai.py に渡すライセンス・ダウンロードの質問の省略だけ。2026-10-28 のレビュー:
    `--yes` で別の Mac を指す `SFX_API_URL` が 127.0.0.1 に替わり、別の Mac の合言葉だけが残っていた）。
    替えてよいと言われなければ**何も書かない**（`ai.env.kept`、`needs_human`）。
  - 合言葉は対の URL を書けたときだけ書く。
  - 書いた後の `configProblems` が書く前より増えるなら書かない。合言葉の形（32 文字以上など）の規則は写さず、`packages/config` を唯一の正にする。
  - `ixa_ai.py` の `env` は名前と値の形を絞る（合言葉の名前は通さない）。
- `pnpm ixa ai status`: doctor の「手元の AI サーバー」だけ。
- doctor の「届かない」の直し方を `pnpm ixa ai install`（同じ Mac）と、別の Mac の 1 行への案内に替えた。

## 選ばなかったもの

- **ixa が入れ方を全部持つ**: サーバーの版が上がるたびに ixa も直すことになる。入れ方は動かす側が一番よく知っている。
- **一覧を URL から取る**: `uv run <URL>` ではスクリプトの場所が分からず、隣のファイルを読めない。埋め込んでテストで揃える。
- **合言葉を `--json` に入れて ixa の CLI に渡す**: 同じ Mac では要らない（ループバック）。別の Mac から渡す道は接続コードの 1 本に絞る。

## 確かめたこと

- `ixa_ai.py`: 偽の外の口で 22 件（選び方の解釈・知らない ID・macOS / Intel / メモリ / Homebrew での「動かない」・ライセンスの断り・
  空き不足で入れ始めない・同じ Mac の答えの形・2 つの動画サーバーで一覧を 1 つにまとめる・`--lan` の合言葉が環境変数だけで渡り、
  接続コードが端末に 1 回だけ出て、答えにもファイルにも入らない・接続コードの往復・答えを読めないサーバーは失敗・klein の
  `needs_human` は `.env` に書きつつ 3）。判定を 5 か所壊して、どれもテストが落ちることを確かめた。
- `apps/cli`: 一覧の合わせ方・値の入った URL の扱い・合言葉の対・接続コードの断り（文にコードも合言葉も入らない）・
  `--plan` で `.env` を書かない・答えのファイルを消す・短い合言葉は `configProblems` で止める。判定を 5 か所壊して落ちることを確かめた。
- この Mac（Intel・macOS 15.7・空き約 20 GB）で `uv run tools/ixa-ai/ixa_ai.py plan --json`・`pnpm ixa ai install --plan --json`
  （`.env` のハッシュが変わらない）・`pnpm ixa ai status`・使い捨ての `.env` への `ai connect` を実際に回した。サーバーとモデルは入れていない。

## 分かっている不足

- 各サーバーの `<ref>` は `setup` の入った版のタグに固定した（vpipe-api v0.1.5、ほかの 4 つは v0.1.1）。サーバーの版を上げたら catalog.json と埋め込みの一覧を直す。
- klein 9B の容量、FlashVSR・Z-Image Turbo・whisper.cpp のメモリは未計測（一覧に「不明」と出し、空きの計算には入れない）。
- Z-Image Turbo の ixa の AI の ID は `z_image` と置いた（packages/domain 側の名前が決まったら合わせる）。
- 前に入れたサーバーには、新しく入れたサーバーの `coordinate_with` が足されない（入れ直すか、そのサーバーの `setup` をもう一度）。
- `IMAGE_PROVIDER` には手元の画像の値が無く、曲・効果音には既定の口の設定が無いので、`ai install` は `LOCAL_*_GENERATOR` だけで選べるようにする。
- `tools/ixa-ai` のテストは CI で回していない（`python3 -m unittest discover -s tools/ixa-ai`）。
