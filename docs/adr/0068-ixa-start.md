# ADR-0068: 使う人の起動は `pnpm ixa start`（組み立て済みの画面）にする／`.env.example` を最小にする

Status: Accepted
Date: 2026-11-10
Decider: Claude（Architect）
Amends: ADR-0063 §3（setup が写す `.env.example` の中身）

## 背景

- 使う人も `pnpm dev` で起動していた。`next dev` は開いたページをその場で組み立てるので初めの表示が遅く、
  再コンパイルのたびにメモリが増えて戻らず、増えすぎると自分で起動し直す（画面が突然切れる）。api・worker も `tsx watch` で
  直しを見張っている。どれも開発のための形で、使う人には要らない。
- `next build` はこのリポジトリでも CI でも一度も回していなかった。壊れていても誰も気づかない。
- setup が `.env` に写す `.env.example` は 206 行・55 項目あり、初めての人には何を触ればよいか読めなかった。
  書かない項目は zod の既定（`packages/config/src/schema.ts`）で動くのに、全部が並んでいた。

## 決めたこと

### 1. `pnpm ixa start`

```
更新が途中で止まっている       → 起こさない（update.pending。先に pnpm -s ixa update --resume）
.env が無い                   → 起こさない（pnpm ixa setup を勧める）
ほかの start が組み立てている   → 起こさない（印 apps/web/.ixa-start-build.json の持ち主が生きている）
この clone の ixa が全部動いている → 起こさない（場所だけ言う。--build なら組み立て直していないと言って 1）
一部だけ動いている            → 起こさない（start.partial。動いているもの・いないものを名前で言う）
ポートを別のものが使っている     → 起こさない（doctor の runtime.port-* をそのまま見せる）
設定か DB が足りない          → 起こさない（doctor の env.valid・db.postgres・db.redis・db.migrations をそのまま見せる）
--json                      → 起こさない（後ろで起こして doctor で待つ、と答える）
画面の組み立てが古い           → 印を取って pnpm --filter @ixa/web run build:start（成功したら記録を書く。印は必ず外す）
                             → pnpm exec turbo run serve（端末につなぐ。Ctrl+C で全部止まる。終了コードを返す）
```

- 各アプリに `serve` を足す。web は `NEXT_DIST_DIR=.next-start next start -p 3000`、api・worker は `start` と同じ
  （`node --import tsx --env-file=../../.env`。見張らない）、音の解析は `dev` と同じ（もともと見張らない）。
  `turbo.json` に `serve`（`cache: false`・`persistent: true`）。**名前を `start` にしない**: `@ixa/cli` と `@ixa/mcp` が
  既に `start` を持ち（`pnpm ixa` 自体が cli の `start`）、turbo で配ると CLI と MCP まで起きる。
- **組み立ての出力先を分ける**（`next.config.mjs` の `distDir: NEXT_DIST_DIR ?? '.next'`）。本番は `apps/web/.next-start`。
  `next dev` と同じ `.next` を奪い合うと、動いている dev の全ページが 500 になる。値は `apps/web` 直下のフォルダ名だけ受ける。
  `next build` は tsconfig の `include` に `<distDir>/types` を足して書き換えるので、`.next-start/types/**/*.ts` を先に書いておく
  （書き換えが起きなければ作業ツリーは汚れない）。
- **組み立て中の lint と型検査は止める**（`eslint.ignoreDuringBuilds`・`typescript.ignoreBuildErrors`）。CI が別に回しており、
  組み立ては使う人の手元で走る。`transpilePackages` には web が読むワークスペースの包み（domain・music・render・timeline）を並べる。
- **組み立て直すか**（`apps/cli/src/start/build-record.ts`。純粋）: 成功したら `apps/web/.next-start/ixa-build.json` に
  `git rev-parse HEAD` と `NEXT_PUBLIC_*` の指紋（sha256。値は書かない）を書く。
  次の起動で、記録が無い・読めない（zod。理由を言う）・版が違う・指紋が違う・`--build` のどれかなら組み立て直す。
  git の版が分からなければ毎回組み立てる。組み立てる前に前の記録を消す（途中で止まった出力先を「組み立て済み」と読まない）。
  失敗したら起こさず、その終了コードで返る。コミットしていない直しは拾わない（開発は `pnpm dev`。要るなら `--build`）。
- **指紋は Next が実際に焼き込む値で計る。** 強い順（先に決めたものが勝ち、空の値も「決めた」に数える）:
  起こしたプロセスの環境 → `apps/web/.env.production.local` → `.env.local` → `.env.production` → `.env` → 直下の `.env`。
  確かめたこと: `@next/env` 15.5.25 の `loadEnvConfig` は production でこの 4 つのファイルをこの順に読み、環境にある名前
  （`undefined` でないもの）は上書きしない。`next build` はこれを設定ファイルより先に呼ぶ（`build/index.js` の load-dotenv →
  load-next-config）。`next.config.mjs` の `process.loadEnvFile` は Node 22 で既にある名前を上書きしない（空の値も）。
  だから直下の `.env` がいちばん弱い。`$VAR` の展開（`@next/env` だけがする）は指紋に入れない。
- **組み立ての間は印を持つ**（`apps/web/.ixa-start-build.json`。pid と始めた時刻、zod。`.next-start` の外）。組み立ての間は
  どのポートも開かないので、印が無いと doctor は「動いていない」と言い、2 つ目の start が同じ出力先に組み立て、update が組み立ての下で
  git を動かす。印は「無いときだけ作る」口（`wx`）で取り、終われば失敗でも投げても `finally` で外す。持ち主の pid が死んでいる・
  読めない印は、理由を言って消す。doctor は `runtime.web-build`（知らせるだけ）、update は `devIsRunning` が印を「動いている」に数える。
- **Ctrl+C**: 端末は同じプロセスグループの全員に SIGINT を送る。CLI は `inherit: 'all'` の子が動いている間は SIGINT で落ちず
  （子が止まり終えるのを待ち、子の本当の終了コードを返す）、SIGTERM は子へ渡す。子が終われば手を離す（`real-system.ts`）。
  SIGTERM を渡すのは、外の pnpm が Ctrl+C を受けると CLI に SIGTERM を送るため（下の「分かっている不足」の実験）。
  CLI は `tsx` の CLI を挟まず `node --import tsx` で起こす（`tsx` の CLI は合図の中継の途中で CLI を消してしまった）。
- **`--json` では起こさない**（止めるまで返らず、最後の JSON を出せない）。動いているときだけ `running: true` と URL を答え、
  それ以外は `ok: false`・`running: false`・`error` を返す。エージェントは `--json` を付けずに後ろで起こし、
  `pnpm -s ixa doctor --json` の `runtime.*` で待つ（INSTALL.md「起動する」）。
- 使う人に見せる案内の `pnpm dev` は `pnpm ixa start` にする（HELP・setup の次の 1 手・doctor の直し方・update の「起動し直して」・
  INSTALL.md・スキル）。`pnpm dev` は開発の形として残す。README はこの ADR の外（組み立ての時間を見てから決める）。
- CI の同じジョブの最後で `pnpm --filter @ixa/web run build:start` を回す（依存の入れ直しは無い）。ジョブ名は変えない（必須の検査の名前を変えないため）。

### 2. `.env.example` は最初に要るものだけ、全部は `.env.full.example`

`.env.example`（setup が写す）に残すのは次の 14 項目。決め方:

| 決め方 | 項目 |
|---|---|
| zod が既定なしで求める | `DATABASE_URL`・`REDIS_URL` |
| setup が埋めるものと、その仲間 | `STORAGE_DRIVER`・`STORAGE_DIR`・`STORAGE_SIGNING_SECRET`・`API_PORT`・`NEXT_PUBLIC_API_URL`・`NEXT_PUBLIC_WORKSPACE_ID` |
| 2 つの処理が揃える | `AUDIO_SERVICE_URL`・`AUDIO_PORT`・`AUDIO_ROOT` |
| 初めての人が最初に替える | `VIDEO_PROVIDER`・`IMAGE_PROVIDER`・`STORYBOARD_DRAFTER`（どれも既定 `stub`） |

- **`AUDIO_ROOT` は消さない。** zod に無く、worker の既定は `/tmp/ixa-audio`、apps/audio の既定は自分の作業ディレクトリで、
  書かないと 2 つが別の場所を見て曲の解析が通らない。
- 今までの全部（説明つき）は `.env.full.example` に移す。変えたい行だけ `.env` へ写す。
- update（`update.new-keys`）と doctor（`env.new-keys`）は今までどおり `.env.example` と比べる。任意の項目は zod の既定で動くので、
  「足りない」とは言わなくなる。全部を持つ古い `.env` の人にも何も言わない。setup の書き込み（署名の鍵・ワークスペースの ID・
  テキストの AI・Gemini・`ai install | connect`）は、行が無ければ末尾に足すので、最小の `.env` からでも動く。
- テストで固定する（`packages/config/src/__tests__/env-example.test.ts`・`apps/cli/src/__tests__/setup-env-example.test.ts`）:
  最小・全部の両方が本物の読み込み口（`loadConfig`）を通る、最小の名前は全部の方にもある、最小は 20 項目以内、
  `AUDIO_*` が最小に残っている、必須を消すと止まる（上の検査が素通りしていない）。

## 確かめたこと

- `NEXT_DIST_DIR=.next-start next build`（Next.js 15.5、dev サーバが別に動いている 16 GB の Mac）: 冷えた状態で 37 秒・最大 RSS 約 1.6 GB、
  キャッシュありで 21 秒・約 0.96 GB。2 回目の組み立てで tsconfig・`next-env.d.ts`（無視するファイル）以外に差分が出ない。
- `NEXT_DIST_DIR=.next-start next start -p 3900` で `/` が `/login` へ 307、`/login` が 200。
- `pnpm -s ixa start --json` を、別の clone の dev が 3000・3001・8100 を使っている状態で回し、3 つの `runtime.port-*` を返して何も起こさない。

## 分かっている不足

- `pnpm ixa start` を端から端まで（組み立て → `turbo run serve` → 画面が開く）は回していない。作業した Mac では制作者の dev が
  3000・3001・8100 を使っていて止められなかった。
- 組み立ての記録はコミットの版しか見ない。コミットしていない直しで起動するなら `--build`。
- **ポートを持たない worker の取り残しは見えない。** 前の start か dev の worker だけが残っていると、ポートは全部空いているので
  start はそのまま起こし、2 つの worker が同じキューを取り合う（古い版の worker がジョブを取ることもある）。
- **turbo は、どれか 1 つが 0 以外で終わると残りも止める**（半分だけ動いているアプリは分かりにくいので、わざとそのままにする）。
  確かめたこと（turbo 2.10.13、制作者のポートに触らない使い捨ての 2 つの包み）: 持続する task の片方が `exit 3` で終わると、
  もう片方は 8 秒の `sleep` の途中で止められ、turbo は 3 で終わった。**片方が `exit 0` で終わったときは、もう片方は最後まで動いた**
  （turbo は 0 で終わった）。つまり「1 つ止まれば全部止まる」は失敗で終わったときだけで、サーバが 0 で終わると残りは動き続ける。
  ixa の 4 つのサーバが 0 で終わる場面（正常な終了）は Ctrl+C か合図のときだけと見ているが、確かめていない。
- **Ctrl+C は本物の端末では押していない。** 代わりに、新しいプロセスグループの全員に SIGINT を送る実験をした（制作者のポートに触らない。
  CLI に見立てた script が `System.run` の `inherit: 'all'` で、INT と TERM を受けて 2 秒かけて片付けてから 5 で終わる `sh` を起こす。
  外側は `pnpm ixa` と同じく pnpm run が 2 段）:
  - CLI の起動が `tsx src/main.ts`（前の形）: いちばん外の pnpm は 72ms で戻り、CLI は合図を受けた記録も残さずに消え、
    `sh` は親を失ったまま 2 秒後に片付けを終えた（プロンプトが先に戻り、後から出力が混ざる）。
  - `node --import tsx src/main.ts`（今の形）: pnpm は Ctrl+C を受けるとすぐ子へ SIGTERM を送る。CLI はそれを子へ渡し、子の片付けを待ち、
    子の 5 を返し、外の pnpm はその後に戻った。
  そこで `@ixa/cli` の `start` を `node --import tsx src/main.ts` にした（api・worker の `start` と同じ形）。turbo が SIGINT と SIGTERM の
  両方を受けて片付けることは、turbo の実物では確かめていない。
