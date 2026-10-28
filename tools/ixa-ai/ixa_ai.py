# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""ixa の手元の生成 AI を選んで入れる（ADR-0064）。

    uv run tools/ixa-ai/ixa_ai.py plan [--json]
    uv run tools/ixa-ai/ixa_ai.py install [--models a,b] [--accept-licenses a,b] [--yes] [--json] [--lan] [--no-service]
    uv run tools/ixa-ai/ixa_ai.py status [--json]

別の Mac でも 1 行で動くよう、標準ライブラリだけ・1 ファイルにする。一覧（CATALOG）はこのファイルに埋め込み、
tools/ixa-ai/catalog.json と同じ中身に保つ（テストが一致を確かめる）。入れ方の知識は各サーバーの
`<cli> setup` にあり、ここは選ぶ・同意を取る・呼ぶ・答えをまとめるだけ。

**合言葉（token）はどこにも書かない。** --json の答え・ログ・--result-file には入れず、--lan のときに
`pnpm ixa ai connect <接続コード>` を端末に 1 回だけ出す。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

CATALOG_JSON = r"""
{
  "version": 1,
  "servers": {
    "vpipe-api": {
      "repo": "kabatin/vpipe-api", "ref": "main", "cli": "vpipe-api", "port": 8765, "envPrefix": "VPIPE_API_",
      "ixa": {"generatorEnv": "LOCAL_VIDEO_GENERATOR", "generator": "vpipe", "urlEnv": "VPIPE_API_URL", "tokenEnv": "VPIPE_API_TOKEN"}
    },
    "wan-api": {
      "repo": "kabatin/wan-api", "ref": "main", "cli": "wan-api", "port": 8766, "envPrefix": "WAN_API_",
      "ixa": {"generatorEnv": "LOCAL_VIDEO_GENERATOR", "generator": "wan", "urlEnv": "WAN_API_URL", "tokenEnv": "WAN_API_TOKEN"}
    },
    "klein-api": {
      "repo": "kabatin/klein-api", "ref": "main", "cli": "klein-api", "port": 8767, "envPrefix": "KLEIN_API_",
      "ixa": {"generatorEnv": "LOCAL_IMAGE_GENERATOR", "generator": "klein", "urlEnv": "KLEIN_API_URL", "tokenEnv": "KLEIN_API_TOKEN"}
    },
    "ace-step-api": {
      "repo": "kabatin/ace-step-api", "ref": "main", "cli": "ace-step-api", "port": 8768, "envPrefix": "ACE_STEP_API_",
      "ixa": {"generatorEnv": "LOCAL_MUSIC_GENERATOR", "generator": "ace_step", "urlEnv": "ACE_STEP_API_URL", "tokenEnv": "ACE_STEP_API_TOKEN"}
    },
    "sfx-api": {
      "repo": "kabatin/sfx-api", "ref": "main", "cli": "sfx-api", "port": 8769, "envPrefix": "SFX_API_",
      "ixa": {"generatorEnv": "LOCAL_SFX_GENERATOR", "generator": "sfx_api", "urlEnv": "SFX_API_URL", "tokenEnv": "SFX_API_TOKEN"}
    }
  },
  "items": [
    {
      "id": "h3", "label": "MiniMax H3 Turbo", "kinds": ["video"], "server": "vpipe-api", "ixaAi": ["vpipe"],
      "downloadGb": 118, "peakDiskGb": 185, "ramGb": 16, "ramRecommendedGb": 32, "minMacos": "26.0",
      "licence": {
        "name": "MiniMax H3 Community License",
        "summary": "米国・EU・英国・韓国では使えない。商用利用は別の条件",
        "url": "https://huggingface.co/MiniMaxAI/MiniMax-H3"
      }
    },
    {
      "id": "flashvsr", "label": "FlashVSR（高画質化）", "kinds": ["upscale"], "server": "vpipe-api", "ixaAi": [],
      "downloadGb": 7, "peakDiskGb": null, "ramGb": null, "ramRecommendedGb": null, "minMacos": "26.0",
      "licence": {
        "name": "Apache-2.0",
        "summary": "商用可",
        "url": "https://huggingface.co/JunhaoZhuang/FlashVSR-v1.1"
      }
    },
    {
      "id": "wan-5b", "label": "Wan 2.2 5B", "kinds": ["video"], "server": "wan-api", "ixaAi": ["wan"],
      "downloadGb": 18, "peakDiskGb": null, "ramGb": 32, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Apache-2.0",
        "summary": "商用可",
        "url": "https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B"
      }
    },
    {
      "id": "klein-9b", "label": "FLUX.2 [klein] 9B", "kinds": ["image"], "server": "klein-api", "ixaAi": ["klein"],
      "downloadGb": 17.8, "peakDiskGb": null, "ramGb": 11, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "FLUX Non-Commercial License",
        "summary": "重みは商用不可（作った画像は使える）",
        "url": "https://huggingface.co/black-forest-labs/FLUX.2-klein-9B"
      }
    },
    {
      "id": "klein-4b", "label": "FLUX.2 [klein] 4B（下書き）", "kinds": ["image"], "server": "klein-api", "ixaAi": ["klein_4b"],
      "downloadGb": 8.6, "peakDiskGb": null, "ramGb": 5, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Apache-2.0",
        "summary": "商用可",
        "url": "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B"
      }
    },
    {
      "id": "z-image-turbo", "label": "Z-Image Turbo", "kinds": ["image"], "server": "klein-api", "ixaAi": ["z_image"],
      "downloadGb": 10.9, "peakDiskGb": null, "ramGb": null, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Apache-2.0",
        "summary": "商用可",
        "url": "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo"
      }
    },
    {
      "id": "ace-step", "label": "ACE-Step 1.5", "kinds": ["music"], "server": "ace-step-api", "ixaAi": ["ace_step"],
      "downloadGb": 10, "peakDiskGb": null, "ramGb": 19, "ramRecommendedGb": 32, "minMacos": "14.0",
      "licence": {
        "name": "MIT",
        "summary": "商用可",
        "url": "https://github.com/ace-step/ACE-Step-1.5"
      }
    },
    {
      "id": "minimax-music3", "label": "MiniMax-Music3", "kinds": ["music"], "server": "ace-step-api", "ixaAi": ["minimax_music3"],
      "downloadGb": 13, "peakDiskGb": null, "ramGb": 24, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "MiniMax-Music3 Community License",
        "summary": "商用可。ただし「MiniMax-Music3」の名前を目立つように出す。年商 2000 万ドルを超えるなら許可が要る",
        "url": "https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE"
      }
    },
    {
      "id": "sa3-medium", "label": "Stable Audio 3 Medium", "kinds": ["music", "sfx"], "server": "sfx-api", "ixaAi": ["stable_audio_medium_music", "stable_audio_medium_sfx"],
      "downloadGb": 6.5, "peakDiskGb": null, "ramGb": 11, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Stability AI Community License",
        "summary": "年商 100 万ドル未満なら無料。商用利用は登録が要る",
        "url": "https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/main/LICENSE.md"
      }
    },
    {
      "id": "sa3-small", "label": "Stable Audio 3 Small", "kinds": ["sfx"], "server": "sfx-api", "ixaAi": ["stable_audio_sfx"],
      "downloadGb": 1.9, "peakDiskGb": null, "ramGb": 4, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Stability AI Community License",
        "summary": "年商 100 万ドル未満なら無料。商用利用は登録が要る",
        "url": "https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/main/LICENSE.md"
      }
    },
    {
      "id": "moss", "label": "MOSS SFX v2", "kinds": ["sfx"], "server": "sfx-api", "ixaAi": ["moss_sfx"],
      "downloadGb": 11.2, "peakDiskGb": null, "ramGb": 22, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "Apache-2.0",
        "summary": "商用可",
        "url": "https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0"
      }
    },
    {
      "id": "whisper-cpp", "label": "whisper.cpp（large-v3-turbo）", "kinds": ["transcribe"], "server": null, "ixaAi": ["whisper_cpp"],
      "downloadGb": 1.6, "peakDiskGb": null, "ramGb": null, "ramRecommendedGb": null, "minMacos": "14.0",
      "licence": {
        "name": "MIT",
        "summary": "商用可（Homebrew で whisper-cpp を入れる）",
        "url": "https://github.com/ggml-org/whisper.cpp"
      }
    }
  ]
}
"""
CATALOG: dict = json.loads(CATALOG_JSON)

EXIT_OK, EXIT_FAIL, EXIT_ARGS, EXIT_HUMAN = 0, 1, 2, 3
DISK_MARGIN = 1.1
GB = 1_000_000_000
WHISPER_MODEL_NAME = "ggml-large-v3-turbo.bin"
WHISPER_MODEL_URL = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{WHISPER_MODEL_NAME}"
WHISPER_CLI = "whisper-cli"
CONNECT_CODE_VERSION = 1
ID_LIST = re.compile(r"^[a-z0-9-]+(,[a-z0-9-]+)*$")


class UsageError(Exception):
    """引数が不正（終了コード 2）。"""


# ---------------------------------------------------------------- 外の口（テストは偽物を渡す）


@dataclass(frozen=True)
class Io:
    """コマンドの実行・端末・ファイル。判定の関数はこれを知らない。"""

    run: Callable[[list[str], dict[str, str] | None], tuple[int, str]]
    which: Callable[[str], str | None]
    ask: Callable[[str], str]
    is_tty: bool
    err: Callable[[str], None]
    out: Callable[[str], None]
    tty: Callable[[str], None]
    download: Callable[[str, Path], None]
    free_bytes: Callable[[Path], int]
    home: Path
    hostname: Callable[[], str]
    token: Callable[[], str] = lambda: secrets.token_urlsafe(32)


def _real_run(cmd: list[str], extra_env: dict[str, str] | None) -> tuple[int, str]:
    """stdout だけを受け取り、stderr（進み具合）はそのまま流す。extra_env は今の環境に足す。"""
    env = {**os.environ, **extra_env} if extra_env else None
    try:
        done = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=None, text=True, check=False)
    except FileNotFoundError:
        return 127, ""
    return done.returncode, done.stdout


def _real_ask(question: str) -> str:
    sys.stderr.write(question)
    sys.stderr.flush()
    return sys.stdin.readline().strip()


def _real_tty(text: str) -> None:
    """端末にだけ出す（パイプやログに残さない）。端末が無ければ stderr。"""
    try:
        with open("/dev/tty", "w", encoding="utf-8") as tty:
            tty.write(text + "\n")
    except OSError:
        sys.stderr.write(text + "\n")


def _real_download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, open(part, "wb") as f:  # noqa: S310 固定の https
        shutil.copyfileobj(response, f, length=8 * 1024 * 1024)
    part.rename(dest)


def _real_hostname() -> str:
    code, out = _real_run(["scutil", "--get", "LocalHostName"], None)
    name = out.strip()
    return f"{name}.local" if code == 0 and name else platform.node()


def _nearest_existing(path: Path) -> Path:
    return path if path.exists() or path.parent == path else _nearest_existing(path.parent)


def real_io() -> Io:
    return Io(
        run=_real_run,
        which=shutil.which,
        ask=_real_ask,
        is_tty=sys.stdin.isatty(),
        err=lambda text: print(text, file=sys.stderr, flush=True),
        out=lambda text: print(text, flush=True),
        tty=_real_tty,
        download=_real_download,
        free_bytes=lambda p: shutil.disk_usage(_nearest_existing(p)).free,
        home=Path.home(),
        hostname=_real_hostname,
    )


# ---------------------------------------------------------------- 機械と一覧（純粋）


@dataclass(frozen=True)
class Machine:
    arm64: bool
    macos: str | None
    ram_gb: float | None
    free_bytes: int
    uv: bool
    brew: bool


def read_machine(io: Io) -> Machine:
    code, ver = io.run(["sw_vers", "-productVersion"], None)
    code_mem, mem = io.run(["sysctl", "-n", "hw.memsize"], None)
    code_arm, arm = io.run(["sysctl", "-in", "hw.optional.arm64"], None)
    ram = int(mem.strip()) / (1024**3) if code_mem == 0 and mem.strip().isdigit() else None
    return Machine(
        # Rosetta の Python でも Apple Silicon と分かるよう、機械に聞く（platform.machine() は x86_64 を返す）。
        arm64=platform.system() == "Darwin" and (platform.machine() == "arm64" or (code_arm == 0 and arm.strip() == "1")),
        macos=ver.strip() if code == 0 and ver.strip() else None,
        ram_gb=round(ram, 1) if ram is not None else None,
        free_bytes=io.free_bytes(io.home),
        uv=io.which("uv") is not None,
        brew=io.which("brew") is not None,
    )


def version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", text)[:3])


def runnable(item: dict, machine: Machine, lan: bool = False) -> tuple[bool, str | None]:
    """この Mac で動くか。動かなければ理由（日本語 1 文）。"""
    if not machine.arm64 and item["server"] is not None:
        return False, "Apple Silicon の Mac でしか動きません"
    if machine.macos is None or version_tuple(machine.macos) < version_tuple(item["minMacos"]):
        return False, f"macOS {item['minMacos']} 以上が要ります（この Mac は {machine.macos or '不明'}）"
    if item["ramGb"] is not None and machine.ram_gb is not None and machine.ram_gb < item["ramGb"]:
        return False, f"メモリが足りません（約 {item['ramGb']} GB 要る・この Mac は {machine.ram_gb} GB）"
    if item["server"] is None and lan:
        return False, "文字起こしは ixa の Mac で動かします（--lan では入れません）"
    if item["server"] is None and not machine.brew:
        return False, "Homebrew がありません（https://brew.sh で入れてから）"
    return True, None


def item_by_id(item_id: str) -> dict:
    found = next((i for i in CATALOG["items"] if i["id"] == item_id), None)
    if found is None:
        raise UsageError(f"知らないモデルです: {item_id}（{', '.join(i['id'] for i in CATALOG['items'])}）")
    return found


def parse_id_list(text: str | None) -> list[str]:
    if text is None or text.strip() == "":
        return []
    if not ID_LIST.fullmatch(text.strip()):
        raise UsageError(f"モデルの一覧はカンマ区切りの ID で書きます（例 h3,sa3-small）: {text}")
    return list(dict.fromkeys(text.strip().split(",")))


def parse_selection(text: str, items: list[dict]) -> list[str]:
    """番号の選び方（"1,3,7" / "2-4" / "all" / ID）を ID の一覧にする。"""
    text = text.strip().lower()
    if text in ("all", "a", "全部"):
        return [i["id"] for i in items]
    picked: list[str] = []
    for part in [p.strip() for p in text.split(",") if p.strip()]:
        bounds = part.split("-")
        if all(b.isdigit() for b in bounds) and len(bounds) in (1, 2):
            low, high = int(bounds[0]), int(bounds[-1])
            if low < 1 or high > len(items) or low > high:
                raise UsageError(f"番号は 1〜{len(items)} で選びます: {part}")
            picked.extend(items[n - 1]["id"] for n in range(low, high + 1))
        else:
            picked.append(item_by_id(part)["id"])
    if not picked:
        raise UsageError("1 つも選ばれていません")
    return list(dict.fromkeys(picked))


def disk_need_gb(items: list[dict]) -> tuple[float, list[str]]:
    """選んだものに要るディスク（GB）と、容量が分からない ID。"""
    known = [max(i["downloadGb"] or 0, i["peakDiskGb"] or 0) for i in items]
    unknown = [i["id"] for i in items if i["downloadGb"] is None]
    return round(sum(known), 1), unknown


def disk_problem(items: list[dict], free_bytes: int) -> str | None:
    need, _ = disk_need_gb(items)
    if need * DISK_MARGIN * GB <= free_bytes:
        return None
    return f"ディスクが足りません（約 {round(need * DISK_MARGIN)} GB 要る・空きは {free_bytes // GB} GB）"


def licence_refusals(selected: list[str], accepted: list[str]) -> list[str]:
    """--yes のとき、ライセンスに同意していない ID（1 つでもあれば入れない）。"""
    return [i for i in selected if i not in accepted]


def ixa_url(server: str, host: str) -> str:
    return f"http://{host}:{CATALOG['servers'][server]['port']}"


def env_changes(servers: list[str], host: str, whisper_model: str | None) -> dict[str, str]:
    """ixa の .env に足すもの（**token は入れない**）。一覧は足す分だけで、合わせ方は ixa の CLI が決める。"""
    changes: dict[str, str] = {}
    for server in servers:
        ixa = CATALOG["servers"][server]["ixa"]
        current = [v for v in changes.get(ixa["generatorEnv"], "").split(",") if v]
        changes = {
            **changes,
            ixa["generatorEnv"]: ",".join(dict.fromkeys([*current, ixa["generator"]])),
            ixa["urlEnv"]: ixa_url(server, host),
        }
    return {**changes, "WHISPER_CPP_MODEL": whisper_model} if whisper_model else changes


def encode_connect_code(entries: list[dict[str, str]]) -> str:
    payload = json.dumps({"v": CONNECT_CODE_VERSION, "servers": entries}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_connect_code(code: str) -> dict:
    padded = code + "=" * (-len(code) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode()).decode())


def coordinate_args(server: str, peers: list[str]) -> list[str]:
    """同じ GPU を順番に使うよう、ほかのサーバーを教える（--coordinate-with NAME=HEALTH_URL）。"""
    return [
        arg
        for peer in peers
        if peer != server
        for arg in ("--coordinate-with", f"{peer}=http://127.0.0.1:{CATALOG['servers'][peer]['port']}/v1/health")
    ]


def coord_token_env(server: str, peer: str) -> str:
    return CATALOG["servers"][server]["envPrefix"] + "COORD_TOKEN_" + re.sub(r"[^A-Z0-9]", "_", peer.upper())


def setup_command(server: str, ids: list[str], *, lan: bool, service: bool, peers: list[str]) -> list[str]:
    cli = CATALOG["servers"][server]["cli"]
    flags = ["--lan"] * lan + ["--service"] * service
    return [cli, "setup", "--models", ",".join(ids), "--json", "--yes", *flags, *coordinate_args(server, peers)]


def install_command(server: str) -> list[str]:
    s = CATALOG["servers"][server]
    return ["uv", "tool", "install", f"git+https://github.com/{s['repo']}@{s['ref']}"]


def last_json_line(stdout: str) -> dict | None:
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) and isinstance(parsed.get("components"), list) else None


def exit_code_of(statuses: list[str]) -> int:
    if "failed" in statuses:
        return EXIT_FAIL
    return EXIT_HUMAN if "needs_human" in statuses else EXIT_OK


# ---------------------------------------------------------------- 状態と一覧


KIND_LABEL = {"video": "動画", "image": "画像", "music": "曲", "sfx": "効果音", "upscale": "高画質化", "transcribe": "文字起こし"}
OK_STATUSES = ("installed", "already")
MARK = {"installed": "✓", "already": "✓", "needs_human": "!", "skipped": "-"}
YES = ("y", "yes")


def whisper_model_path(io: Io) -> Path:
    return io.home / ".local" / "share" / "whisper.cpp" / WHISPER_MODEL_NAME


def probe_states(io: Io) -> dict[str, str]:
    """入っているか（サーバーの `setup --check --json` に聞く。CLI が無ければ missing）。"""
    states: dict[str, str] = {}
    for server, spec in CATALOG["servers"].items():
        ids = [i["id"] for i in CATALOG["items"] if i["server"] == server]
        if io.which(spec["cli"]) is None:
            states = {**states, **{i: "missing" for i in ids}}
            continue
        _, stdout = io.run([spec["cli"], "setup", "--check", "--json", "--models", ",".join(ids)], None)
        reported = {c.get("id"): c.get("status") for c in (last_json_line(stdout) or {}).get("components", [])}
        states = {**states, **{i: str(reported.get(i) or "unknown") for i in ids}}
    whisper = io.which(WHISPER_CLI) is not None and whisper_model_path(io).exists()
    return {**states, "whisper-cpp": "installed" if whisper else "missing"}


def plan_items(io: Io, machine: Machine, lan: bool) -> list[dict]:
    states = probe_states(io)
    rows = []
    for number, item in enumerate(CATALOG["items"], start=1):
        ok, reason = runnable(item, machine, lan)
        rows.append({**item, "number": number, "runnable": ok, "reason": reason, "state": states.get(item["id"], "unknown")})
    return rows


def machine_json(machine: Machine) -> dict:
    return {
        "arm64": machine.arm64,
        "macos": machine.macos,
        "ramGb": machine.ram_gb,
        "freeGb": machine.free_bytes // GB,
        "tools": {"uv": machine.uv, "brew": machine.brew},
    }


def machine_line(machine: Machine) -> str:
    chip = "Apple Silicon" if machine.arm64 else "Apple Silicon ではない"
    ram = f"メモリ {machine.ram_gb} GB" if machine.ram_gb is not None else "メモリ不明"
    return f"この Mac: {chip}・macOS {machine.macos or '不明'}・{ram}・空き {machine.free_bytes // GB} GB\n"


def size_text(item: dict) -> str:
    if item["downloadGb"] is None:
        return "容量不明"
    peak = f"（準備中は最大 {item['peakDiskGb']} GB）" if item["peakDiskGb"] else ""
    return f"約 {item['downloadGb']} GB{peak}"


def ram_text(item: dict) -> str:
    if item["ramGb"] is None:
        return "メモリ未計測"
    rec = f"（{item['ramRecommendedGb']} GB 推奨）" if item["ramRecommendedGb"] else ""
    return f"メモリ約 {item['ramGb']} GB{rec}"


def format_row(row: dict) -> str:
    kinds = "・".join(KIND_LABEL[k] for k in row["kinds"])
    state = "（入っています）" if row["state"] in OK_STATUSES else ""
    lic = row["licence"]
    head = f"{row['number']:>2}. {row['label']}［{kinds}］{state}"
    detail = f"    {size_text(row)}・{ram_text(row)}・macOS {row['minMacos']} 以上・{lic['name']}：{lic['summary']}"
    blocked = [] if row["runnable"] else [f"    ✗ この Mac では動きません：{row['reason']}"]
    return "\n".join([head, detail, *blocked])


def plan_payload(machine: Machine, rows: list[dict]) -> dict:
    return {
        "ok": True,
        "action": "plan",
        "machine": machine_json(machine),
        "items": rows,
        "needsHuman": "ライセンスの同意と大きなダウンロードは、制作者に聞いてから --accept-licenses と --yes を付ける",
    }


# ---------------------------------------------------------------- 入れる


@dataclass(frozen=True)
class Say:
    """人向けの 1 行。--json のときは stderr（stdout は最後の JSON だけ）。"""

    json_mode: bool
    io: Io

    def __call__(self, text: str) -> None:
        (self.io.err if self.json_mode else self.io.out)(text)


def stop(say: Say, code: int, message: str, fix: dict | None = None) -> tuple[int, dict]:
    say(("✗ " if code == EXIT_FAIL else "! ") + message)
    if fix:
        say(f"    直し方: {fix['hint']}" + (f"（{fix['command']}）" if fix.get("command") else ""))
    return code, {"ok": False, "action": "install", "message": message, **({"fix": fix} if fix else {})}


def asked_yes(io: Io, question: str) -> bool:
    return io.is_tty and io.ask(question).strip().lower() in YES


def choose(args: argparse.Namespace, io: Io, rows: list[dict], say: Say) -> list[str]:
    if args.models:
        return parse_id_list(args.models)
    if not io.is_tty:
        raise UsageError("端末ではないので選べません。--models h3,sa3-small のように ID で書きます（一覧は plan --json）")
    for row in rows:
        say(format_row(row))
    answer = io.ask("\n入れるものの番号（例 1,3,7・all で動くもの全部）: ")
    picked = parse_selection(answer, rows)
    if answer.strip().lower() != "all":
        return picked
    return [r["id"] for r in rows if r["id"] in picked and r["runnable"]]


def consent(args: argparse.Namespace, io: Io, selected: list[dict], say: Say) -> list[dict] | tuple[int, dict]:
    """ライセンスの同意。--yes なら --accept-licenses に全部が要る。端末なら 1 つずつ y を取る。"""
    ids = [i["id"] for i in selected]
    if args.yes:
        refused = licence_refusals(ids, parse_id_list(args.accept_licenses))
        if not refused:
            return selected
        notes = "／".join(f"{i}: {item_by_id(i)['licence']['name']}（{item_by_id(i)['licence']['summary']}）" for i in refused)
        fix = {
            "hint": "制作者にライセンスを見せて同意を取り、--accept-licenses に ID を足す",
            "command": f"--models {','.join(ids)} --accept-licenses {','.join(ids)} --yes",
            "needsHuman": True,
        }
        return stop(say, EXIT_HUMAN, f"ライセンスに同意していないものがあります。{notes}", fix)
    if not io.is_tty:
        fix = {"hint": "制作者の同意を取ってから --accept-licenses と --yes を付ける", "needsHuman": True}
        return stop(say, EXIT_HUMAN, "端末ではないので同意を取れません", fix)
    agreed = []
    for item in selected:
        lic = item["licence"]
        say(f"\n{item['label']} — {lic['name']}\n  {lic['summary']}\n  {lic['url']}")
        if asked_yes(io, "  このライセンスに同意しますか [y/N]: "):
            agreed.append(item)
        else:
            say("  → 入れません")
    if not agreed:
        return stop(say, EXIT_HUMAN, "同意したものが無いので、何も入れませんでした")
    return agreed


def ensure_server_cli(io: Io, server: str, say: Say) -> dict | None:
    """サーバーの CLI が無ければ uv tool install で入れる。失敗なら答えの行を返す。"""
    if io.which(CATALOG["servers"][server]["cli"]) is not None:
        return None
    command = install_command(server)
    say(f"… {server} を入れます（{' '.join(command)}）")
    code, _ = io.run(command, None)
    if code == 0:
        return None
    fix = {"hint": "上のエラーを直してもう一度", "command": " ".join(command), "needsHuman": False}
    return {"status": "failed", "message": f"{server} を入れられませんでした（uv tool install が {code}）", "fix": fix}


def server_env(server: str, tokens: dict[str, str], peers: list[str]) -> dict[str, str] | None:
    """--lan のときだけ、合言葉を環境変数で渡す（引数・ログには出さない）。"""
    if not tokens:
        return None
    prefix = CATALOG["servers"][server]["envPrefix"]
    coord = {coord_token_env(server, p): tokens[p] for p in peers if p != server and p in tokens}
    return {prefix + "TOKEN": tokens[server], **coord}


def install_server(io: Io, server: str, ids: list[str], ctx: dict, say: Say) -> dict:
    url = ixa_url(server, ctx["host"])
    failed = ensure_server_cli(io, server, say)
    if failed:
        return {"server": server, "url": url, "tokenSet": False, "components": [{"id": i, **failed} for i in ids]}
    command = setup_command(server, ids, lan=ctx["lan"], service=ctx["service"], peers=ctx["peers"])
    say(f"… {server} の setup（{', '.join(ids)}）")
    code, stdout = io.run(command, server_env(server, ctx["tokens"], ctx["peers"]))
    answer = last_json_line(stdout)
    if answer is None:
        reinstall = " ".join(install_command(server)).replace("tool install", "tool install --reinstall")
        fix = {"hint": "サーバーが古いかもしれません。入れ直してもう一度", "command": reinstall, "needsHuman": False}
        message = f"{server} setup の答えを読めません（終了コード {code}）"
        comps = [{"id": i, "status": "failed", "message": message, "fix": fix} for i in ids]
        return {"server": server, "url": url, "tokenSet": False, "components": comps}
    comps = [{k: c[k] for k in ("id", "status", "message", "fix") if k in c} for c in answer["components"]]
    return {"server": server, "url": url, "tokenSet": bool(answer.get("tokenSet")), "components": comps}


def install_whisper(args: argparse.Namespace, io: Io, say: Say) -> dict:
    model = whisper_model_path(io)
    if io.which(WHISPER_CLI) is None:
        if not args.yes and not asked_yes(io, "brew install whisper-cpp を実行しますか [y/N]: "):
            fix = {"hint": "制作者の同意を取って Homebrew で入れる", "command": "brew install whisper-cpp", "needsHuman": True}
            return {"id": "whisper-cpp", "status": "needs_human", "message": "whisper.cpp は Homebrew で入れます", "fix": fix}
        code, _ = io.run(["brew", "install", "whisper-cpp"], None)
        if code != 0:
            return {"id": "whisper-cpp", "status": "failed", "message": f"brew install whisper-cpp が失敗しました（{code}）"}
    if model.exists():
        return {"id": "whisper-cpp", "status": "already", "message": f"{model.name} はもうあります", "model": str(model)}
    say(f"… whisper.cpp のモデルを取ります（{WHISPER_MODEL_NAME}）")
    try:
        io.download(WHISPER_MODEL_URL, model)
    except OSError as error:
        return {"id": "whisper-cpp", "status": "failed", "message": f"モデルを取れませんでした: {error}"}
    return {"id": "whisper-cpp", "status": "installed", "message": f"{model.name} を入れました", "model": str(model)}


def server_ok(entry: dict) -> bool:
    return all(c["status"] in (*OK_STATUSES, "needs_human") for c in entry["components"])


def install(args: argparse.Namespace, io: Io) -> tuple[int, dict]:
    say = Say(json_mode=args.json, io=io)
    machine = read_machine(io)
    if not machine.uv:
        fix = {"hint": "uv を入れる", "command": "curl -LsSf https://astral.sh/uv/install.sh | sh", "needsHuman": True}
        return stop(say, EXIT_FAIL, "uv がありません", fix)
    rows = plan_items(io, machine, args.lan)
    selected = [item_by_id(i) for i in choose(args, io, rows, say)]
    chosen = {i["id"] for i in selected}
    blocked = [r for r in rows if r["id"] in chosen and not r["runnable"]]
    if blocked:
        reasons = "／".join(f"{r['id']}（{r['reason']}）" for r in blocked)
        return stop(say, EXIT_FAIL, f"この Mac では動かないものを選んでいます：{reasons}")
    agreed = consent(args, io, selected, say)
    if isinstance(agreed, tuple):
        return agreed
    state = {r["id"]: r["state"] for r in rows}
    todo = [i for i in agreed if state[i["id"]] not in OK_STATUSES]
    problem = disk_problem(todo, machine.free_bytes)
    if problem:
        return stop(say, EXIT_FAIL, problem, {"hint": "空きを作るか、選ぶものを減らす", "needsHuman": True})
    need, unknown = disk_need_gb(todo)
    unknown_text = f"（容量不明: {', '.join(unknown)}）" if unknown else ""
    if not args.yes and not asked_yes(io, f"\n合計 約 {need} GB を落とします{unknown_text}。進めますか [y/N]: "):
        return stop(say, EXIT_HUMAN, "やめました（何も入れていません）")
    return run_install(args, io, say, agreed)


def print_connect_line(io: Io, host: str, servers: list[str], tokens: dict[str, str]) -> None:
    code = encode_connect_code([{"id": s, "url": ixa_url(s, host), "token": tokens[s]} for s in servers])
    io.tty(
        f"\nixa の Mac で次の 1 行を貼ってください（合言葉を含むので、ここに 1 回だけ出します）:\n  pnpm ixa ai connect {code}\n"
    )


def run_install(args: argparse.Namespace, io: Io, say: Say, agreed: list[dict]) -> tuple[int, dict]:
    servers = [s for s in CATALOG["servers"] if any(i["server"] == s for i in agreed)]
    already = [s for s, spec in CATALOG["servers"].items() if io.which(spec["cli"]) is not None]
    ctx = {
        "lan": args.lan,
        "service": args.service,
        "host": io.hostname() if args.lan else "127.0.0.1",
        "peers": list(dict.fromkeys([*servers, *already])),
        "tokens": {s: io.token() for s in servers} if args.lan else {},
    }
    entries = [install_server(io, s, [i["id"] for i in agreed if i["server"] == s], ctx, say) for s in servers]
    whisper = [install_whisper(args, io, say)] if any(i["server"] is None for i in agreed) else []
    for comp in [c for e in entries for c in e["components"]] + whisper:
        say(f"{MARK.get(comp['status'], '✗')} {comp['id']}: {comp.get('message', comp['status'])}")
    ok_servers = [e["server"] for e in entries if server_ok(e)]
    model = next((w["model"] for w in whisper if "model" in w), None)
    if args.lan and ok_servers:
        print_connect_line(io, ctx["host"], ok_servers, ctx["tokens"])
    statuses = [c["status"] for e in entries for c in e["components"]] + [w["status"] for w in whisper]
    exit_code = exit_code_of([s if s in (*OK_STATUSES, "needs_human") else "failed" for s in statuses])
    payload = {
        "ok": exit_code == EXIT_OK,
        "action": "install",
        "lan": args.lan,
        "servers": entries,
        "local": whisper,
        "env": env_changes(ok_servers, ctx["host"], model),
    }
    return exit_code, payload


# ---------------------------------------------------------------- 入口


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ixa_ai.py", description="ixa の手元の生成 AI を選んで入れる（ADR-0064）")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "list", "status"):
        p = sub.add_parser(name)
        p.add_argument("--json", action="store_true")
        p.add_argument("--lan", action="store_true")
    p = sub.add_parser("install")
    p.add_argument("--models")
    p.add_argument("--accept-licenses")
    p.add_argument("--yes", "-y", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("--lan", action="store_true")
    p.add_argument("--service", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--result-file", help="答えの JSON をここにも書く（合言葉は入らない）")
    return parser


def emit(args: argparse.Namespace, io: Io, payload: dict) -> None:
    if args.json:
        io.out(json.dumps(payload, ensure_ascii=False))
    result_file = getattr(args, "result_file", None)
    if result_file:
        path = Path(result_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        path.chmod(0o600)


def main(argv: list[str] | None = None, io: Io | None = None) -> int:
    io = io or real_io()
    args = build_parser().parse_args(argv)
    try:
        if args.command == "install":
            code, payload = install(args, io)
        else:
            machine = read_machine(io)
            rows = plan_items(io, machine, args.lan)
            if not args.json:
                io.out("\n".join([machine_line(machine), *(format_row(r) for r in rows)]))
            action = "status" if args.command == "status" else "plan"
            code, payload = EXIT_OK, {**plan_payload(machine, rows), "action": action}
    except UsageError as error:
        io.err(f"ixa_ai: {error}")
        code, payload = EXIT_ARGS, {"ok": False, "action": args.command, "message": str(error)}
    emit(args, io, payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
