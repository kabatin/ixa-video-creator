# ADR-0063: 導入・点検・更新のコマンド（`pnpm ixa setup / doctor / update / mcp`）と、エージェントに頼むだけの導入

Status: Accepted
Date: 2026-10-26
Decider: Claude（Architect）

## 背景

- 導入は README の手順を手で 7 つ打っていた（`.env` のコピー・署名の鍵を `openssl` で作る・`infra:up`・`db:migrate`・`db:seed`・`pnpm dev`）。
  更新の手順はどこにも無く、0.8.0 では「DB の更新 4 本」と「`uv sync`」をリリースノートで伝えるしかなかった。
- 制作者（2026-10-26）「setup コマンドや doctor など、導入を簡単にする仕組みや、アップデートを容易にする update コマンド等を整備したい」
  「エージェントにお願いするだけで導入が簡単に出来るようにもしておきたい」。
- 決めてもらったこと: update は**最新のリリース**を追う。足りない道具は**入れ方を出して止める**（勝手に入れない）。

## 決めたこと

### 1. `apps/cli`（`@ixa/cli`）とルートの `pnpm ixa`

- `"ixa": "pnpm --filter @ixa/cli --silent start --"`。tsx で動かす。機械が読むときは `pnpm -s ixa … --json`
  （`-s` が無いと pnpm の見出しが stdout に混ざる）。
- **外の世界は `System`（`apps/cli/src/system.ts`）に閉じる**（コマンドの実行・HTTP・ファイル・DB・ポートの持ち主）。
  判定（`checks/*` の `judge*`・`setup/decide.ts`・`update/decide.ts`）はすべて純粋な関数で、偽の事実でテストする。
- stdout に書くのは `printer.ts` だけ（`process.stdout.write`）。進み具合は stderr。`console` は使わない（eslint の例外も足していない）。
- 結果の形は 1 つ: `{ id, group, level: ok|warn|fail|skip, message, fix?: { hint, command?, needsHuman }, docs? }`。
  `fix.command` はそのまま打てる 1 行、`fix.needsHuman` は人の操作か同意が要るか、`docs` は INSTALL.md の見出し。
- **鍵・署名付き URL の値はどの文にも入れない。** 課金の鍵は「入っている／いない」だけ。DB の URL は理由の文に入れない。

### 2. doctor（読むだけ）

道具（Node 22・pnpm 9.15.4・git・Docker が動いているか・compose・FFmpeg/ffprobe・uv・音声の依存）／設定（`.env`・
`configProblems` で**全部**の問題・`.env.example` にあって `.env` に無い名前・`apps/web/.env.local` の上書き）／
DB（コンテナ・誰のコンテナか・つながるか・まだの DB の更新・ワークスペース）／動いているもの（3000・API・音のポートの持ち主、
この clone の dev なら `/health`）／手元の AI サーバー（`.env` で有効にしたものだけ `GET /v1/health`）／任意
（Claude Code・Codex・faster-whisper small・素材の置き場・課金の鍵の有無）。✗ があれば終了コード 1。

- 書いて確かめない（置き場に書けるかは `access(W_OK)`）。生きている環境で回しても何も変わらない。
- ポートの持ち主は `lsof` の pid と作業ディレクトリから、`package.json` の name が `ixa-video-creator` の直下を探して見分ける。

### 3. setup（何度でも安全）

道具 → `.env`（無ければ `.env.example` から）→ 署名の鍵（空なら作る。**値の入った行は書き換えない**）→ 設定の検査 →
Docker（postgres・redis を起動して healthy まで待つ）→ DB の更新（drizzle の migrator。drizzle-kit と同じ表）→
初期データ（ワークスペース。ID を `.env` の空欄に書く）→ `uv sync --locked`（`--check` で揃っていれば飛ばす）→ doctor。
止まる手順が出たらそこで止め、それより先は回さない。`--yes` は途中の質問（Docker Desktop を起動するか）に「はい」で答える。

- **別の clone の DB を見つけたら止める**（`setup/infra-guard.ts`）。同じ Mac の 2 つ目の clone は、既定のままだと 1 つ目の
  `ixa-postgres` につながり、setup がその DB に更新と初期データを書いてしまう。見張りは次の 2 つを compose の場所の印
  （`com.docker.compose.project.working_dir`。シンボリックリンクはたどって比べる）で見る。
  - 名前（`<prefix>-postgres`・`<prefix>-redis`）のコンテナ
  - `.env` の `DATABASE_URL`・`REDIS_URL` のポートを公開しているコンテナ（`docker ps --filter publish=`）。名前だけ替えて URL が
    5432 のままだと、Docker の外とみなして 1 つ目の clone の DB に書けたため（レビューの指摘）
  別の clone のものなら、分ける（`.env` の `IXA_COMPOSE_PROJECT`・`IXA_COMPOSE_PREFIX`・`POSTGRES_PORT`・`REDIS_PORT`）か共有する
  （`IXA_COMPOSE_SHARED=true`）かを人に聞く。**見張りは起動・DB の更新・初期データのどれも最初に通す**（update の 2 段目の DB の更新も）。
- 書いたのに形が違う `IXA_COMPOSE_*`・ポート、`POSTGRES_PORT` と `DATABASE_URL` のポートの食い違い（`REDIS_*` も）は設定の問題にする
  （`composeProblems`）。**黙って既定に戻さない**（既定は 1 つ目の clone の名前）。doctor は ✗、setup・infra は止まる。
- `infra/docker-compose.yml` の名前とポートは `.env` で替えられる（既定は今までと同じ。`docker compose config` の展開結果が変更前と一致）。
  プロジェクト名は CLI が `-p` で渡す（この Mac の compose v2.2 は compose ファイルの `name:` を読めない）。
- **`pnpm infra:up` / `infra:down` は `pnpm ixa infra up | down` を通す。** 直に `docker compose` を打つと `-p` が渡らず、
  2 つ目の clone の `infra:down` が 1 つ目の clone のスタックを止め、`infra:up` が同じボリュームで作り直した。
  down は別の clone のものなら共有の設定でも止めない。`-v` は決して付けない。既定のプロジェクトは今までと同じ `infra`（ボリュームもそのまま）。

### 4. update（2 段）

1 段目（今の版の CLI）: 止める条件（追跡しているファイルの未コミットの変更・`main` 以外・動いているジョブ・この clone の dev）→
`git fetch --tags` → いちばん新しい `vX.Y.Z`（`--main` なら `origin/main`）→ 取り込むか（版と祖先の両方で決める）→ `git merge --ff-only` →
途中の印を置く → `pnpm install --frozen-lockfile` → **新しい版の CLI を `pnpm -s ixa update --after-fetch --from <前の版>` で起こし直す**。
2 段目（新しい版の CLI）: `uv sync` → Docker → DB の更新 → 新しく増えた `.env` の項目（名前だけ。値は書かない）→ 印を消す →
変更点の URL → doctor → dev が動いていれば「起動し直して」。

- 動いているジョブ: 12 の表を `countActiveJobs`（`packages/db`）で数える。表ごとに「動いている状態」を名前で持つ
  （generation・music・sfx・upscale・dub・voice・storyboard_draft_runs・review_runs は queued・running、render_jobs は queued・rendering・encoding、
  image_generation_jobs は queued・running・checking、thumbnails は queued・rendering、会話は `isAgentSessionBusy`）。
  終わりの状態は表で違う（succeeded と done がある）ので、終わりの側では決めない。
  - **24 時間より前から動いたままの行は数えない**（取り残し。生きている DB にも 2026-10-07 から running の絵コンテの案が 1 行ある）。
    数えると更新がいつまでも止まるので、`update.stale-jobs` で ID と日付を並べて知らせるだけにする。
  - `--force` はジョブの確認だけを外す。
  - 0 件とみなすのは DB が動いていないとき（code が ECONNREFUSED・CONNECT_TIMEOUT・ETIMEDOUT・ECONNRESET）だけ。それ以外の失敗
    （合言葉違いなど）は止める。JSON に `activeJobs`（数えなければ null）と `activeJobsReason` を残す。
- **この clone の dev が動いていれば取り込む前に止める**（tsx watch と next dev が途中の版を読み込み直し、DB の更新の前に新しいコードが
  古い DB に当たる）。動かしたまま進めるのは `--while-running`（`--force` とは別の同意）。
- `pnpm install` は 1 段目の後半でやる（計画では 2 段目だったが、依存が入らないと新しい版の CLI を起こせない）。
- **途中で止まったら続きから。** 取り込んだ直後に `.ixa-update-pending.json`（.gitignore 済み）を置き、2 段目の手順が止まらずに済んだら消す。
  途中で落ちるとコードの版は新しいので、版の比べ合わせでは「最新です」に見えてしまう。印があれば update は `pnpm -s ixa update --resume`
  を勧め（`update.pending`）、doctor も ✗（`tools.update-pending`）にする。`--resume` は pnpm install から 2 段目までをやり直す。
- 取り込むか: 版が新しくても中身が今と同じ（祖先が同じ）なら「最新です」。版が同じでもタグが先にあれば取り込む。
- 手順が投げたら `failed` の手順にして止め、続きの 1 行（`setup` / `update --resume`）を付ける。最上位で投げたら `--json` では
  `{command, ok:false, error}` を 1 つだけ出す。文の中の URL の合言葉は伏せる。
- 終わったら明示的に終える（postgres.js はつながらなかった接続の再試行の時計を残すので、DB が止まっていると doctor が返らなかった）。

### 5. mcp

`pnpm ixa mcp --claude | --codex` が、そのまま貼れる登録の 1 行（`claude mcp add ixa --scope user -e IXA_API_URL=… -e IXA_WORKSPACE_ID=… -- <tsx> <main.ts>`、
Codex は `[mcp_servers.ixa]` の節で鍵は `env_vars` の名前だけ）を出す。`--write` のときだけ登録する（あれば書き換えない）。
**アクセス用の鍵は入れない・作らない。** 発行は画面（`/access-keys`）で制作者が押す。

### 6. エージェントに頼むだけの導入

- README の冒頭に「Claude Code か Codex にこう頼む」の 1 文。
- `INSTALL.md`: clone → `pnpm install` → `pnpm -s ixa setup --yes --json` → 結果の読み方 → id ごとの直し方 → MCP の登録 →
  `doctor --json` が ✗ 0 で終わり。**人に聞く所**（Homebrew・Docker Desktop・課金の鍵・アクセス用の鍵の発行・DB の共有・
  ポートを使う別のプロセス・人の変更がある clone の更新・MCP の書き込み）を表にする。
- Claude Code のスキル `.claude/skills/ixa-setup/`、Codex 向けには AGENTS.md の同じ節。

## 確かめたこと

- 単体: 判定の各分岐（足りない・古い・空・新しい項目・未適用の更新・別の clone のコンテナ・動いているジョブ・版の比較・
  fast-forward・setup の「済み」）。判定を 10 か所壊して、どれもテストが落ちることを確かめた。
- 結合: 使い捨ての Postgres で `pendingMigrations`（記録を消すと「まだ」になる・表が無ければ全部）と `countActiveJobs`。
- 使い捨ての clone（別の Docker のプロジェクト・55432/56379）で setup を 2 回（2 回目は全部「済み」）→ doctor。
  ローカルの偽のタグ（v0.9.0。DB の更新 1 本と `.env` の新しい項目 1 つ）で update の 2 段を通した（2 段目が新しい版のコードで走ることを印で確かめた）。
- `.env.example` をそのまま写した `.env` が API の検査で落ちていた（空の `STORAGE_PUBLIC_BASE_URL`）。直した。
- レビューの直しのあと、使い捨ての clone でもう一度通した（2026-10-27）:
  - setup 2 回（2 回目は全部「済み」）→ doctor ✗ 0。`pnpm infra:down` → `infra:up` でデータ（ワークスペース）が残る。
  - 名前だけ替えて同じポートを指す 2 つ目の clone は、setup が `infra` で止まり、`pnpm infra:down` も 1 つ目のスタックを止めなかった。
  - 偽のタグ v0.9.0 を、わざと壊した DB の更新で用意して update: 書き出し中のジョブで止まる → `--force` で進む →
    2 段目の DB の更新で止まり、印が残る → `update` は「最新です」と言わず `update.pending`、doctor は `tools.update-pending` ✗ →
    原因を直して `--resume` → 済んで印が消える。20 日前から running の絵コンテの案は数えず、取り残しとして知らせた。

## 分かっている不足

- Windows・Linux は確かめていない。道具の入れ方の案内は macOS（Homebrew）向け。
- update は main を追っている clone が前提。自分のコミットを積んでいる人は止まる（理由と手を出す）。
- 手元の AI サーバー（vpipe など）自体の導入・更新は扱わない（別のリポジトリ）。doctor は届くかを見るだけ。
- update は dev を起動し直さない（動いている作業を止めないため。案内だけ）。
- web の 3000 は固定なので、同じ Mac で 2 つの clone の dev は同時に動かせない（doctor が ! で知らせる）。
