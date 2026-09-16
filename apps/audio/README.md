# apps/audio — 音楽解析サービス

BPM / ビート / ダウンビート / セクション境界 / エネルギー / オンセット / ドロップ、
および UI 描画用の波形ピークを返す HTTP サービス。

**使用ライブラリは librosa（ISC）のみ。** madmom / essentia / allin1 は非商用ライセンスの
学習済みモデルに依存するため使用しない（`docs/adr/0009-music-analysis-librosa.md`）。

## 必要なもの

- Python 3.12（`.python-version` で固定）
- [uv](https://docs.astral.sh/uv/)
- ffmpeg（wav 以外を読む場合）

> macOS x86_64 では `llvmlite` 0.46 以降のホイールが配布されていない。
> `pyproject.toml` で `numba` / `llvmlite` をホイールのある系列に固定している。

## セットアップ

```bash
cd apps/audio
uv sync
```

## 起動

```bash
uv run python -m src.main
```

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `AUDIO_PORT` | `8100` | 待ち受けポート |
| `AUDIO_HOST` | `127.0.0.1` | 待ち受けホスト |
| `AUDIO_ROOT` | カレントディレクトリ | 解析を許可するディレクトリ。**この外のパスは拒否する** |

## API

```bash
curl localhost:8100/health
# {"status":"ok"}

curl -X POST localhost:8100/analyze \
  -H 'content-type: application/json' \
  -d '{"audio_path": "track.wav"}'
```

音声ファイルそのものは受け取らず**パスだけ**を受け取る（同一ホストで動く前提。
大きな音声を HTTP に乗せない）。`audio_path` は `AUDIO_ROOT` からの相対パス、
または `AUDIO_ROOT` 配下の絶対パス。

| 状況 | ステータス |
|---|---|
| 正常 | 200 |
| `AUDIO_ROOT` の外 / `..` を含む | 400 |
| ファイルが無い | 404 |
| 解析失敗（デコード不能など） | 500 |

応答は `AnalysisResult` に `peaks` を加えたもの。フィールドは snake_case で返し、
camelCase への変換は TS クライアント `@ixa/music` が行う。

## テスト

```bash
uv run pytest
```

テスト音源は numpy で合成する（クリックトラックと正弦波）。**バイナリはコミットしない。**

## 設計

| ファイル | 役割 |
|---|---|
| `src/analyzer.py` | 解析本体。HTTP から切り離した純粋な関数 |
| `src/downbeats.py` | ダウンビート推定。librosa に無いため自前実装 |
| `src/sections.py` | Laplacian segmentation による境界検出 |
| `src/energy.py` | エネルギー曲線 / オンセット / ドロップ |
| `src/waveform.py` | UI 描画用のピーク |
| `src/paths.py` | `AUDIO_ROOT` によるパストラバーサル防止 |
| `src/main.py` | FastAPI の配線 |

**セクションのラベル命名（intro / verse / chorus …）はこのサービスでは行わない。**
すべて仮ラベル `verse` を入れ、命名は TS 側が LLM で行う（`docs/ARCHITECTURE.md` §14）。

BPM は librosa の推定値をそのまま使わず、ビートグリッドの最小二乗近似で再推定する。
オンセット包絡のフレーム解像度（約 23 ms）に由来する量子化誤差を消すため。
