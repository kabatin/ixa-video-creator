# ADR-0041: 素材を Docker の外の手元のファイルとして持つ（MinIO をやめる）

Status: Accepted
Date: 2026-10-07
Decider: Claude（Architect）。制作者の問い（2026-10-07「アセット系がすべて Minio で管理されていて、Docker が落ちればすべて失う…
そもそも Docker 内ではなくローカルに保存すればいいのでは？…作った素材は個別に何かに使いたいこともあると思うので、
普通にフォルダ開いて見れるといいなと思う」）

## できあがり

- 素材・書き出し・波形が `~/ixa-video-creator/storage/` の**ただのファイル**になる。Finder で開ける。Time Machine に乗る
- Docker は Postgres と Redis だけになる。`docker compose down -v` をしても素材は消えない
- 作品ごとに `~/Movies/ixa-video-creator/<作品名>/素材/` へ、読める名前で**ハードリンク**が張られる。
  QuickTime でそのまま開ける・他のアプリへ持っていける。容量は増えない
- 画面と worker の見かけは変わらない。署名付き URL は MinIO ではなく API が出す（規約 7 のまま、DB には保存しない）

## Context

4 つの事実（すべて 2026-10-07 に実機で確認）。

1. 保管庫は MinIO で、中身は Docker の named volume `infra_minio_data`。**3631 オブジェクト・3.2GiB**
2. **「Docker が落ちたら消える」は正確ではない。** `docker compose down` でも named volume は残る。
   消えるのは `down -v`・Docker Desktop の Reset / 入れ直し・ディスクイメージの破損。
   ただしその置き場所（`~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`、60GB）は
   **Time Machine の除外対象**（`tmutil isexcluded` で確認）。つまり 3.2GiB の控えがどこにも無かった。
   これが本当の危険で、ボリュームの消え方ではない
3. **ホストのフォルダに出しても Finder では開けない。** MinIO はオブジェクトを 1 つのフォルダとして持つ:
   `output.mp4/xl.meta` と `output.mp4/<uuid>/part.1`（実測）。
   bind mount は 2 を直すが、制作者の「普通にフォルダ開いて見れる」は直らない
4. **MinIO 自体が降りる理由になっている。** コミュニティ版のビルド済みイメージの配布が止まり、
   Docker Hub からは削除、quay.io は匿名の pull に 401 を返す。いまは Chainguard の `latest-dev` 頼みで
   **版を固定できない**（`infra/docker-compose.yml` のコメント）。
   1 人が 1 台の Mac で使う道具に、S3 互換のサーバを抱え続ける理由はもう無い

## Decision

### 1. `ObjectStorage` に fs 実装を足し、既定にする

- `packages/storage/src/fs-storage.ts`。**port（7 メソッド）は変えない**
- 根は `STORAGE_DIR`（絶対パスのみ・zod）。既定 `~/ixa-video-creator/storage`
- `STORAGE_DRIVER=fs|s3`、既定 `fs`。**S3 実装は消さない**（クラウドに置く日のため・契約テストの比較対象として）
- 置き場所は storageKey そのまま: `storage/media/<workspaceId>/<mediaAssetId>/original.mp4`
- 書き込みは違う名前に書いてから rename（途中のファイルを残さない。ADR-0036 と同じ）

### 2. 署名付き URL は API が出す

- `GET /files/{key}?exp=<unix 秒>&sig=<HMAC-SHA256>`
- 鍵は `STORAGE_SIGNING_SECRET`（env・32 文字以上）。比較は timing-safe
- **Range 対応は必須**。`Accept-Ranges: bytes` / 206 / `Content-Range`、満たせない範囲は 416。
  動画のシークとプレビューがこれに乗る
- 署名の時刻は既存の `signingWindow` をそのまま使う。窓の頭に揃えないとプレビューが毎回読み直す（2026-10-02 の件）
- 取り込みは `PUT /files/{key}?exp&sig&ct`（`signedPutUrl` の置き換え）
- 配信は port を介さず `fs.createReadStream`。fs ドライバだけが `localPath(key)` を公開する。
  これで ADR-0036 の「1 本ずついったんメモリに読む」も同時に無くなる
- `STORAGE_DRIVER=s3` のときは**このルートを登録しない**（署名は S3 側が出す）

### 3. 読める名前の素材フォルダ（ADR-0036 の形を素材に広げる）

- `~/Movies/ixa-video-creator/<作品名>/素材/`
  - Take の動画 … `CUT-01 Take 2 採用.mp4`（採用されている Take が Finder で分かる）
  - Shot の最初のフレーム（ADR-0025）… `CUT-01 最初のフレーム.png`
  - **日時は入れない。** `Shot のコード × Take 番号`は作品の中で 1 つに決まるので、
    足しても見分けには効かず名前が長くなるだけ（書き出しは同じ秒に何本も作れるので入れている）
- **ハードリンク**を張る。容量は増えない・正は無傷・利用者が消しても壊れない
- 入れるのは**開くとき**だけ（`POST /projects/{id}/asset-folder/open`）。もうあるものは上書きしない。
  **もう入っているものは元の素材を見に行かない**（見に行くと、消した素材を毎回「見つかりません」と言い続ける）
- 名前の規則は domain に置き、ADR-0036 と**同じ安全処理（`safeNameForFinder`）を共有する**
  （規則を 2 つ持つと必ずズレる）
- ハードリンクは同じボリュームでないと張れない。張れないときはコピーに落とさず、理由を返す
  （`~/Movies` と `STORAGE_DIR` を同じディスクに置く前提）
- 導線は**メニューバーの「素材」→「素材フォルダを開く」**。置き場が `fs` のときだけ口がある

### 4. 移行

- 2026-10-07 に取った退避（`~/ixa-backups/minio-2026-10-07/`。`mc mirror`・3631 ファイル・件数一致を確認）が
  **そのまま移行後の中身になる**。これを `STORAGE_DIR` へ移す
- 突き合わせ: DB の `storageKey` 全件がファイルとして在るかを 1 回だけ走る確認で見る。**足りない分は名前を出す**
- 済んだら compose から `minio` / `minio-init` / `minio-volume-owner` を外す。
  **volume は消さない**（しばらく置き、要らないと分かってから消す）

## 境界（安全）

- **URL から来た key は信用しない。** `keys.ts` の規則で区切りを検証し、解決した絶対パスが
  `STORAGE_DIR` の中かを**開く直前に**確かめる（`..`・絶対パス・シンボリックリンク）
- 署名が無い・期限切れ・改竄はすべて 403。**何が違うかは言わない**
- 署名付き URL はログに出さない（規約 7・LESSONS）
- `STORAGE_SIGNING_SECRET` は env のみ。未設定なら起動しない（`packages/config` の zod）
- 待ち受けは `127.0.0.1` のまま。LAN に出すときは API だけを出す
  （MinIO の 9000 を開ける必要がなくなり、`S3_BIND_HOST` は不要になる）

## 前提の変化（忘れると刺される）

- **fs ドライバは API と worker が同じ機械にある前提。** 別の機械に分ける日が来たら、その時点で
  `STORAGE_DRIVER=s3` に戻す。port を変えていないので戻せる
- 外部 Provider に URL を渡す経路（fal の `image_urls`）は**今も手元の保管庫では成立していない**。
  外の AI は手元の保管庫から読めないため、`apps/worker/src/review/vision.ts` は URL を渡さずバイト列を渡している。
  fs にしても良くも悪くもならない（成立させるには別に公開の口が要る。それは今回の外）

## Alternatives considered

- **A. bind mount に替えるだけ（compose 1 行）** — 2 は直るが 3 が直らない（MinIO の持ち方のまま）。
  版を固定できない問題も残る。macOS の bind mount は書き込みが遅い
- **B. MinIO のまま、控えを定期的に取る** — 素材は見えないまま。Docker の中にある限り「普通に開く」は無理
- **C. 素材を DB に入れる** — 3.2GiB を Postgres に入れる理由が無い

## 今回の外

- クラウドへの自動バックアップ（Time Machine に乗るので、まずはそれで足りる）
- 素材フォルダの自動更新（開くときに揃える。ADR-0036 と同じ）
- 流し読みを port に入れること（配信は fs ドライバ専用の口で済む。S3 に戻す日に考える）
- 既存の MinIO volume の削除（置いておく）
- fal に参照画像を見せるための公開の口
- 素材フォルダに入れるのは Shot に結び付くもの（Take と最初のフレーム）だけ。
  ナレーションの声・楽曲・取り込んだ素材は入れていない（Shot の順に並ぶ名前が付かないため。
  要るようになったら、種類ごとのフォルダに分けて足す）
- Safari での再生の確認（Chromium では確かめた。`bytes=0-1` の形は curl で確かめてある）
