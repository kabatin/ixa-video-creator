"""ixa_ai.py のテスト（ADR-0064）。ネットワークもコマンドも使わない（偽の Io）。

python3 -m unittest discover -s tools/ixa-ai     # または uv run --with pytest pytest tools/ixa-ai
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import unittest.mock
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("ixa_ai", HERE / "ixa_ai.py")
assert _spec is not None and _spec.loader is not None
ixa_ai = importlib.util.module_from_spec(_spec)
sys.modules["ixa_ai"] = ixa_ai  # dataclass が自分のモジュールを引く
_spec.loader.exec_module(ixa_ai)

TOKEN = "T" * 43
GB = 1_000_000_000


def server_answer(server: str, ids: list[str], status: str = "installed", token_set: bool = False) -> str:
    comps = [{"id": i, "status": status, "message": "ok"} for i in ids]
    return "progress noise\n" + json.dumps({"server": server, "ok": True, "tokenSet": token_set, "components": comps})


def lan_setup(cmd: list[str]) -> tuple[int, str]:
    """--lan の setup は合言葉を設定して tokenSet: true と答える（サーバーは環境変数の合言葉を使う）。"""
    return 0, server_answer(cmd[0], cmd[cmd.index("--models") + 1].split(","), token_set="--lan" in cmd)


class Fake:
    """偽の外の口。呼ばれたコマンドと環境変数・端末に出したものを記録する。"""

    def __init__(
        self,
        *,
        macos="26.0",
        ram=64,
        free_gb=500,
        tools=("uv", "brew"),
        tty=False,
        answers=(),
        setup=None,
        terminal=True,
        versions=None,
        check=None,
        uv_code=0,
    ):
        self.calls: list[tuple[list[str], dict | None]] = []
        self.tty_lines: list[str] = []
        self.out_lines: list[str] = []
        self.err_lines: list[str] = []
        self.downloads: list[tuple[str, Path]] = []
        self.answers = list(answers)
        self.macos, self.ram, self.free_gb, self.tools = macos, ram, free_gb, set(tools)
        self.setup = setup or lan_setup
        self.terminal = terminal
        # CLI の名前 → `--version` の版。無いものは何も答えない（版を読めない）。
        self.versions = dict(versions or {})
        self.check = check or (lambda cmd: (2, ""))
        self.uv_code = uv_code
        self.home = Path(tempfile.mkdtemp())
        self.io = ixa_ai.Io(
            run=self.run,
            which=lambda name: f"/bin/{name}" if name in self.tools else None,
            ask=lambda q: self.answers.pop(0),
            is_tty=tty,
            err=self.err_lines.append,
            out=self.out_lines.append,
            tty=self.to_tty,
            download=lambda url, dest, sha256: self.downloads.append((url, dest)),
            free_bytes=lambda p: self.free_gb * GB,
            home=self.home,
            hostname=lambda: "ai-mac.local",
            token=lambda: TOKEN,
            uname=lambda: ("Darwin", "arm64"),
        )

    def to_tty(self, text: str) -> bool:
        if self.terminal:
            self.tty_lines.append(text)
        return self.terminal

    def run(self, cmd: list[str], env: dict | None) -> tuple[int, str]:
        self.calls.append((cmd, env))
        if cmd[:2] == ["sw_vers", "-productVersion"]:
            return 0, self.macos + "\n"
        if cmd[:3] == ["sysctl", "-n", "hw.memsize"]:
            return 0, str(self.ram * 1024**3)
        if cmd[:3] == ["sysctl", "-in", "hw.optional.arm64"]:
            return 0, "1\n"
        if cmd[1:] == ["--version"]:
            return (0, f"{cmd[0]} {self.versions[cmd[0]]}\n") if cmd[0] in self.versions else (0, "")
        if len(cmd) > 1 and cmd[1] == "setup" and "--check" in cmd:
            return self.check(cmd)
        if len(cmd) > 1 and cmd[1] == "setup":
            return self.setup(cmd)
        if cmd[:3] == ["uv", "tool", "install"]:
            if self.uv_code != 0:
                return self.uv_code, ""
            name, _, ref = cmd[-1].split("/")[-1].partition("@")
            self.tools.add(name)
            self.versions[name] = ref.removeprefix("v")
            return 0, ""
        return 0, ""

    def setups(self) -> list[tuple[list[str], dict | None]]:
        return [(c, e) for c, e in self.calls if len(c) > 1 and c[1] == "setup" and "--check" not in c]


def run_main(fake: Fake, *argv: str) -> tuple[int, dict]:
    code = ixa_ai.main(list(argv), fake.io)
    return code, json.loads(fake.out_lines[-1])


ARM = dict(arm64=True, macos="26.0", ram_gb=64.0, free_bytes=500 * GB, uv=True, brew=True)


class CatalogTest(unittest.TestCase):
    def test_embedded_catalog_matches_catalog_json(self):
        self.assertEqual(json.loads((HERE / "catalog.json").read_text(encoding="utf-8")), ixa_ai.CATALOG)

    def test_items_point_at_known_servers_and_unique_ids(self):
        ids = [i["id"] for i in ixa_ai.CATALOG["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        for item in ixa_ai.CATALOG["items"]:
            self.assertIn(item["server"], [*ixa_ai.CATALOG["servers"], None])
            self.assertTrue(item["licence"]["url"].startswith("https://"))


class SelectionTest(unittest.TestCase):
    rows = ixa_ai.CATALOG["items"]

    def test_numbers_ranges_ids_and_all(self):
        self.assertEqual(ixa_ai.parse_selection("1,3", self.rows), ["h3", "wan-5b"])
        self.assertEqual(ixa_ai.parse_selection("9-10", self.rows), ["sa3-medium", "sa3-small"])
        self.assertEqual(ixa_ai.parse_selection("moss, 1,1", self.rows), ["moss", "h3"])
        self.assertEqual(len(ixa_ai.parse_selection("all", self.rows)), len(self.rows))

    def test_rejects_out_of_range_unknown_and_empty(self):
        for bad in ("0", "13", "3-1", "nope", " , "):
            with self.subTest(bad=bad), self.assertRaises(ixa_ai.UsageError):
                ixa_ai.parse_selection(bad, self.rows)

    def test_id_list_rejects_shell_text(self):
        self.assertEqual(ixa_ai.parse_id_list("h3,sa3-small"), ["h3", "sa3-small"])
        with self.assertRaises(ixa_ai.UsageError):
            ixa_ai.parse_id_list("h3;rm -rf")


class RunnableTest(unittest.TestCase):
    def machine(self, **kw):
        return ixa_ai.Machine(**{**ARM, **kw})

    def test_macos_gating(self):
        h3 = ixa_ai.item_by_id("h3")
        self.assertEqual(ixa_ai.runnable(h3, self.machine())[0], True)
        ok, reason = ixa_ai.runnable(h3, self.machine(macos="15.7.4"))
        self.assertFalse(ok)
        self.assertIn("26.0", reason)

    def test_intel_ram_lan_and_brew(self):
        self.assertFalse(ixa_ai.runnable(ixa_ai.item_by_id("sa3-small"), self.machine(arm64=False))[0])
        self.assertFalse(ixa_ai.runnable(ixa_ai.item_by_id("wan-5b"), self.machine(ram_gb=16.0))[0])
        whisper = ixa_ai.item_by_id("whisper-cpp")
        self.assertTrue(ixa_ai.runnable(whisper, self.machine(arm64=False))[0])
        self.assertFalse(ixa_ai.runnable(whisper, self.machine(), lan=True)[0])
        self.assertFalse(ixa_ai.runnable(whisper, self.machine(brew=False))[0])

    def test_disk(self):
        h3 = ixa_ai.item_by_id("h3")
        self.assertIsNone(ixa_ai.disk_problem([h3], 300 * GB))
        self.assertIn("ディスクが足りません", ixa_ai.disk_problem([h3], 150 * GB))
        unknown = {**ixa_ai.item_by_id("klein-9b"), "downloadGb": None, "peakDiskGb": None}
        self.assertEqual(ixa_ai.disk_need_gb([unknown]), (0, ["klein-9b"]))
        self.assertEqual(ixa_ai.disk_need_gb([ixa_ai.item_by_id("klein-9b")]), (17.8, []))


class ConnectCodeTest(unittest.TestCase):
    def test_roundtrip(self):
        entries = [{"id": "sfx-api", "url": "http://ai-mac.local:8769", "token": TOKEN}]
        code = ixa_ai.encode_connect_code(entries)
        self.assertNotIn("=", code)
        self.assertEqual(ixa_ai.decode_connect_code(code), {"v": 1, "servers": entries})


class InstallTest(unittest.TestCase):
    def test_plan_json_shape_changes_nothing(self):
        fake = Fake()
        code, payload = run_main(fake, "plan", "--json")
        self.assertEqual(code, 0)
        self.assertEqual(payload["action"], "plan")
        self.assertEqual({"arm64", "macos", "ramGb", "freeGb", "tools"}, set(payload["machine"]))
        first = payload["items"][0]
        for key in ("id", "kinds", "server", "ixaAi", "downloadGb", "ramGb", "minMacos", "licence", "runnable", "state"):
            self.assertIn(key, first)
        self.assertEqual(fake.setups(), [])

    def test_yes_without_accepting_every_licence_is_refused(self):
        fake = Fake()
        code, payload = run_main(
            fake, "install", "--models", "sa3-small,moss", "--accept-licenses", "sa3-small", "--yes", "--json"
        )
        self.assertEqual(code, 3)
        self.assertTrue(payload["fix"]["needsHuman"])
        self.assertIn("moss", payload["message"])
        self.assertEqual(fake.setups(), [])

    def test_not_runnable_is_refused(self):
        fake = Fake(macos="15.7.4")
        code, payload = run_main(fake, "install", "--models", "h3", "--accept-licenses", "h3", "--yes", "--json")
        self.assertEqual(code, 1)
        self.assertIn("macOS 26.0", payload["message"])
        self.assertEqual(fake.setups(), [])

    def test_not_enough_disk_stops_before_installing(self):
        fake = Fake(free_gb=100)
        code, payload = run_main(fake, "install", "--models", "h3", "--accept-licenses", "h3", "--yes", "--json")
        self.assertEqual(code, 1)
        self.assertIn("ディスク", payload["message"])
        self.assertFalse(any(c[:3] == ["uv", "tool", "install"] for c, _ in fake.calls))

    def test_unknown_id_and_non_tty_without_models(self):
        self.assertEqual(run_main(Fake(), "install", "--models", "nope", "--yes", "--json")[0], 2)
        self.assertEqual(run_main(Fake(), "install", "--json")[0], 2)

    def test_same_mac_installs_and_returns_env_without_tokens(self):
        fake = Fake(tools=("uv", "brew", "wan-api"))
        argv = ["install", "--models", "sa3-small,moss", "--accept-licenses", "sa3-small,moss", "--yes", "--json"]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 0)
        self.assertIn(["uv", "tool", "install", "git+https://github.com/kabatin/sfx-api@v0.1.1"], [c for c, _ in fake.calls])
        (cmd, env), *_ = fake.setups()
        self.assertEqual(cmd[:7], ["sfx-api", "setup", "--models", "sa3-small,moss", "--json", "--yes", "--service"])
        self.assertIn("wan-api=http://127.0.0.1:8766/v1/health", cmd)
        self.assertIsNone(env)
        self.assertEqual(payload["env"], {"LOCAL_SFX_GENERATOR": "sfx_api", "SFX_API_URL": "http://127.0.0.1:8769"})
        self.assertEqual(payload["servers"][0]["server"], "sfx-api")
        self.assertEqual([c["status"] for c in payload["servers"][0]["components"]], ["installed", "installed"])
        self.assertEqual(fake.tty_lines, [])

    def test_two_video_servers_share_one_generator_list(self):
        fake = Fake()
        argv = ["install", "--models", "h3,wan-5b", "--accept-licenses", "h3,wan-5b", "--yes", "--json", "--no-service"]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 0)
        self.assertEqual(payload["env"]["LOCAL_VIDEO_GENERATOR"], "vpipe,wan")
        self.assertTrue(all("--service" not in c for c, _ in fake.setups()))

    def test_lan_passes_token_by_env_and_prints_connect_code_once(self):
        fake = Fake()
        argv = [
            "install",
            "--models",
            "sa3-small,klein-4b",
            "--accept-licenses",
            "sa3-small,klein-4b",
            "--yes",
            "--json",
            "--lan",
        ]
        result = Path(tempfile.mkdtemp()) / "r.json"
        code, payload = run_main(fake, *argv, "--result-file", str(result))
        self.assertEqual(code, 0)
        envs = {c[0]: e for c, e in fake.setups()}
        self.assertEqual(envs["sfx-api"]["SFX_API_TOKEN"], TOKEN)
        self.assertEqual(envs["sfx-api"]["SFX_API_COORD_TOKEN_KLEIN_API"], TOKEN)
        self.assertTrue(all("--lan" in c and TOKEN not in c for c, _ in fake.setups()))
        self.assertEqual(len(fake.tty_lines), 1)
        self.assertIn("pnpm ixa ai connect", fake.tty_lines[0])
        code_text = [line.strip() for line in fake.tty_lines[0].splitlines() if line.strip()][-1]
        decoded = ixa_ai.decode_connect_code(code_text)
        self.assertEqual({s["id"] for s in decoded["servers"]}, {"sfx-api", "klein-api"})
        self.assertIn({"id": "sfx-api", "url": "http://ai-mac.local:8769", "token": TOKEN}, decoded["servers"])
        self.assertEqual(payload["env"]["SFX_API_URL"], "http://ai-mac.local:8769")
        for text in [*fake.out_lines, *fake.err_lines, result.read_text(encoding="utf-8")]:
            self.assertNotIn(TOKEN, text)
            self.assertNotIn(code_text, text)

    def test_lan_leaves_out_servers_that_did_not_set_the_token(self):
        # サーバーは既にある設定の合言葉を残すことがある。tokenSet: true と答えたものだけを接続コードに入れる。
        def setup(cmd):
            ids = cmd[cmd.index("--models") + 1].split(",")
            return 0, server_answer(cmd[0], ids, token_set=cmd[0] == "sfx-api")

        fake = Fake(setup=setup)
        argv = [
            "install",
            "--models",
            "sa3-small,klein-4b",
            "--accept-licenses",
            "sa3-small,klein-4b",
            "--yes",
            "--json",
            "--lan",
        ]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 1)
        code_text = [line.strip() for line in fake.tty_lines[0].splitlines() if line.strip()][-1]
        self.assertEqual([s["id"] for s in ixa_ai.decode_connect_code(code_text)["servers"]], ["sfx-api"])
        klein = next(e for e in payload["servers"] if e["server"] == "klein-api")
        self.assertIn("failed", [c["status"] for c in klein["components"]])
        self.assertNotIn("KLEIN_API_URL", payload["env"])

    def test_lan_without_any_token_set_prints_no_code(self):
        fake = Fake(setup=lambda cmd: (0, server_answer(cmd[0], cmd[cmd.index("--models") + 1].split(","))))
        argv = ["install", "--models", "sa3-small", "--accept-licenses", "sa3-small", "--yes", "--json", "--lan"]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 1)
        self.assertEqual(fake.tty_lines, [])
        self.assertEqual(payload["env"], {})

    def test_lan_without_a_terminal_does_not_print_the_code_anywhere(self):
        fake = Fake(terminal=False)
        argv = ["install", "--models", "sa3-small", "--accept-licenses", "sa3-small", "--yes", "--json", "--lan"]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 3)
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["fix"]["needsHuman"])
        self.assertIn("端末", payload["message"])
        for text in [*fake.out_lines, *fake.err_lines]:
            self.assertNotIn(TOKEN, text)
            self.assertNotIn(
                ixa_ai.encode_connect_code([{"id": "sfx-api", "url": "http://ai-mac.local:8769", "token": TOKEN}]), text
            )

    def test_unreadable_server_answer_fails_and_adds_no_env(self):
        fake = Fake(setup=lambda cmd: (2, "usage: sfx-api ...\n"))
        code, payload = run_main(fake, "install", "--models", "sa3-small", "--accept-licenses", "sa3-small", "--yes", "--json")
        self.assertEqual(code, 1)
        self.assertEqual(payload["env"], {})
        self.assertIn("--reinstall", payload["servers"][0]["components"][0]["fix"]["command"])

    def test_needs_human_from_server_keeps_env_and_exits_3(self):
        fake = Fake(setup=lambda cmd: (3, server_answer("klein-api", ["klein-4b"], "needs_human")))
        code, payload = run_main(fake, "install", "--models", "klein-4b", "--accept-licenses", "klein-4b", "--yes", "--json")
        self.assertEqual(code, 3)
        self.assertEqual(payload["env"]["LOCAL_IMAGE_GENERATOR"], "klein")

    def test_whisper_installs_with_brew_and_sets_model_path(self):
        fake = Fake()
        argv = ["install", "--models", "whisper-cpp", "--accept-licenses", "whisper-cpp", "--yes", "--json"]
        code, payload = run_main(fake, *argv)
        self.assertEqual(code, 0)
        self.assertIn(["brew", "install", "whisper-cpp"], [c for c, _ in fake.calls])
        self.assertEqual(len(fake.downloads), 1)
        self.assertTrue(payload["env"]["WHISPER_CPP_MODEL"].endswith("whisper.cpp/ggml-large-v3-turbo.bin"))

    def test_interactive_selection_and_licence_prompts(self):
        fake = Fake(tty=True, answers=["10,11", "y", "n", "y"])
        code = ixa_ai.main(["install"], fake.io)
        self.assertEqual(code, 0)
        (cmd, _), *_ = fake.setups()
        self.assertEqual(cmd[3], "sa3-small")

    def test_interactive_all_skips_unrunnable(self):
        for word in ("all", "a", "全部", " ALL "):
            with self.subTest(word=word):
                fake = Fake(tty=True, macos="15.0", ram=16, answers=[word, *["n"] * 20])
                io_ = replace(fake.io)
                # 動かないもの（h3 など）を外してからライセンスを聞く（外さないと「動かないもの」で 1 になる）。
                self.assertEqual(ixa_ai.main(["install"], io_), 3)


def checked_installed(cmd: list[str]) -> tuple[int, str]:
    """決めた版の `setup --check`：どれも入っていると答える。"""
    return 0, server_answer(cmd[0], cmd[cmd.index("--models") + 1].split(","), "installed")


SFX_REINSTALL = ["uv", "tool", "install", "--reinstall", "git+https://github.com/kabatin/sfx-api@v0.1.1"]
SFX_ARGV = ["install", "--models", "sa3-small", "--accept-licenses", "sa3-small", "--yes", "--json"]


class OutdatedServerTest(unittest.TestCase):
    """決めた版（catalog の ref）より古いサーバーの CLI は `setup --check` を知らない（2026-10-28 に起きた）。"""

    def test_plan_marks_an_older_cli_outdated_without_asking_it(self):
        fake = Fake(tools=("uv", "brew", "klein-api"), versions={"klein-api": "0.1.0"}, check=checked_installed)
        code, payload = run_main(fake, "plan", "--json")
        self.assertEqual(code, 0)
        states = {i["state"] for i in payload["items"] if i["server"] == "klein-api"}
        self.assertEqual(states, {"outdated"})
        self.assertFalse(any(c[:2] == ["klein-api", "setup"] for c, _ in fake.calls))

    def test_plan_asks_a_cli_at_the_pinned_version(self):
        fake = Fake(tools=("uv", "brew", "klein-api"), versions={"klein-api": "0.1.1"}, check=checked_installed)
        _, payload = run_main(fake, "plan", "--json")
        states = {i["state"] for i in payload["items"] if i["server"] == "klein-api"}
        self.assertEqual(states, {"installed"})

    def test_plan_tells_a_human_the_cli_is_old_and_will_be_upgraded(self):
        fake = Fake(tools=("uv", "brew", "klein-api"), versions={"klein-api": "0.1.0"})
        self.assertEqual(ixa_ai.main(["plan"], fake.io), 0)
        self.assertIn("klein-api 0.1.0 は古い版", fake.out_lines[-1])

    def test_install_upgrades_an_older_cli_then_counts_only_what_is_missing(self):
        # 空き 1 GB では sa3-small（1.9 GB）は落とせない。上げて聞き直し、入っていると分かれば止まらない。
        fake = Fake(tools=("uv", "brew", "sfx-api"), versions={"sfx-api": "0.1.0"}, check=checked_installed, free_gb=1)
        code, payload = run_main(fake, *SFX_ARGV)
        self.assertEqual(code, 0)
        commands = [c for c, _ in fake.calls]
        self.assertIn(SFX_REINSTALL, commands)
        (setup, _), *_ = fake.setups()
        self.assertLess(commands.index(SFX_REINSTALL), commands.index(setup))
        self.assertEqual(payload["env"]["LOCAL_SFX_GENERATOR"], "sfx_api")

    def test_install_stops_before_setup_when_the_cli_cannot_be_upgraded(self):
        fake = Fake(tools=("uv", "brew", "sfx-api"), versions={"sfx-api": "0.1.0"}, uv_code=1)
        code, payload = run_main(fake, *SFX_ARGV)
        self.assertEqual(code, 1)
        self.assertEqual(payload["fix"]["command"], " ".join(SFX_REINSTALL))
        self.assertEqual(fake.setups(), [])


class JsonErrorTest(unittest.TestCase):
    """--json のときは、引数の誤り・思わぬ失敗でも最後に JSON を 1 つだけ出す。"""

    def test_argparse_errors_emit_one_json_object(self):
        for argv in (["install", "--json", "--nope"], ["--json"], ["bogus", "--json"]):
            with self.subTest(argv=argv):
                fake = Fake()
                with unittest.mock.patch("sys.stderr", io.StringIO()):
                    code = ixa_ai.main(argv, fake.io)
                self.assertEqual(code, 2)
                self.assertEqual(len(fake.out_lines), 1)
                payload = json.loads(fake.out_lines[0])
                self.assertFalse(payload["ok"])
                self.assertIn("message", payload)

    def test_unexpected_exception_emits_json_and_exits_1(self):
        fake = Fake()

        def boom(_cmd, _env):
            raise RuntimeError("壊れた")

        broken = replace(fake.io, run=boom)
        code = ixa_ai.main(["plan", "--json"], broken)
        self.assertEqual(code, 1)
        payload = json.loads(fake.out_lines[-1])
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["action"], "plan")


class DownloadTest(unittest.TestCase):
    """本物の _real_download を file:// で回す（ネットワークは使わない）。"""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src = self.dir / "model.bin"
        self.src.write_bytes(b"weights" * 1000)
        self.sha = hashlib.sha256(self.src.read_bytes()).hexdigest()
        self.dest = self.dir / "out" / "model.bin"
        self.part = self.dest.with_suffix(".bin.part")

    def test_matching_sha256_moves_the_file_in_place(self):
        ixa_ai._real_download(self.src.as_uri(), self.dest, self.sha)
        self.assertEqual(self.dest.read_bytes(), self.src.read_bytes())
        self.assertFalse(self.part.exists())

    def test_wrong_sha256_leaves_nothing(self):
        with self.assertRaises(OSError):
            ixa_ai._real_download(self.src.as_uri(), self.dest, "0" * 64)
        self.assertFalse(self.dest.exists())
        self.assertFalse(self.part.exists())

    def test_failed_download_removes_the_part_file(self):
        with self.assertRaises(OSError):
            ixa_ai._real_download((self.dir / "missing.bin").as_uri(), self.dest, self.sha)
        self.assertFalse(self.part.exists())

    def test_whisper_model_is_pinned(self):
        self.assertRegex(ixa_ai.WHISPER_MODEL_SHA256, r"^[0-9a-f]{64}$")
        self.assertNotIn("/resolve/main/", ixa_ai.WHISPER_MODEL_URL)


if __name__ == "__main__":
    unittest.main()
