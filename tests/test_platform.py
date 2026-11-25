import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import platform_ops
import server
from platform_ops import MacOps, WindowsOps, current_ops
from preferences import (
    DEFAULT_SETTINGS,
    PreferencesError,
    read_preferences,
    write_preferences,
)

PASSED = []


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name} 失败 {detail}")
    PASSED.append(name)
    print(f"通过 {name} {detail}".rstrip())


def main():
    ops = current_ops()
    info = ops.info()
    check("当前平台", info["name"] in {"windows", "macos", "linux"}, info["name"])
    check(
        "启动脚本名",
        info["script"] == ("just_run.bat" if os.name == "nt" else "just_run.sh"),
        info["script"],
    )
    check(
        "平台信息字段",
        all(key in info for key in ("name", "label", "script", "folderLabel", "shortcut")),
    )
    check("macOS 适配", MacOps().info()["script"] == "just_run.sh")
    check("Windows 适配", WindowsOps().info()["script"] == "just_run.bat")

    with tempfile.TemporaryDirectory() as temp_dir:
        project = Path(temp_dir)
        if os.name == "nt":
            original_run = platform_ops.subprocess.run
            cancelled_calls = []

            def fake_cancel(command, **kwargs):
                cancelled_calls.append(command)
                return subprocess.CompletedProcess(command, 2, "", "")

            platform_ops.subprocess.run = fake_cancel
            try:
                result = WindowsOps().pick_folder(project)
            finally:
                platform_ops.subprocess.run = original_run
            check(
                "Windows 取消目录选择",
                result["cancelled"] is True
                and result["path"] is None
                and "-STA" in cancelled_calls[0],
            )

            def fake_ok(command, **kwargs):
                match = re.search(r"Set-Content -LiteralPath '([^']+)'", command[-1])
                Path(match.group(1)).write_text(str(project), encoding="utf-8")
                return subprocess.CompletedProcess(command, 0, "", "")

            platform_ops.subprocess.run = fake_ok
            try:
                result = WindowsOps().pick_folder(project)
            finally:
                platform_ops.subprocess.run = original_run
            check(
                "Windows 选中目录",
                result["cancelled"] is False and result["path"] == str(project),
                result["path"] or "无路径",
            )

            opened = {}
            original_startfile = platform_ops.os.startfile

            def fake_startfile(path):
                opened["path"] = path

            platform_ops.os.startfile = fake_startfile
            try:
                result = WindowsOps().reveal_project(project)
            finally:
                platform_ops.os.startfile = original_startfile
            check(
                "Windows 直接打开项目目录",
                result["directory"] == str(project)
                and result["selected"] is None
                and opened.get("path") == str(project),
                result["directory"],
            )

        original_run = platform_ops.subprocess.run

        def fake_mac_ok(command, **kwargs):
            return subprocess.CompletedProcess(command, 0, f"{project}/\n", "")

        platform_ops.subprocess.run = fake_mac_ok
        try:
            result = MacOps().pick_folder(project)
        finally:
            platform_ops.subprocess.run = original_run
        check(
            "macOS 选中目录",
            result["cancelled"] is False and result["path"] == str(project),
            result["path"] or "无路径",
        )

        def fake_mac_cancel(command, **kwargs):
            return subprocess.CompletedProcess(command, 1, "", "execution error: User canceled. (-128)")

        platform_ops.subprocess.run = fake_mac_cancel
        try:
            result = MacOps().pick_folder(project)
        finally:
            platform_ops.subprocess.run = original_run
        check("macOS 取消目录选择", result["cancelled"] is True and result["path"] is None)

        paths = {route.path for route in server.app.routes}
        check(
            "目录选择接口",
            "/api/pick-folder" in paths and "/api/fs" not in paths,
            "旧页面浏览接口已移除",
        )
        check(
            "本地服务地址归一",
            server.local_service_url("http://0.0.0.0:28894") == "http://127.0.0.1:28894"
            and server.local_service_url("http://192.168.0.102:28894")
            == "http://192.168.0.102:28894",
        )

        original_ops = server.OPS

        class FakeOps:
            def pick_folder(self, initial):
                return {"path": str(initial), "cancelled": False}

        server.OPS = FakeOps()
        try:
            endpoint_result = server.pick_folder({"path": str(project)})
        finally:
            server.OPS = original_ops
        check(
            "接口转交目录选择",
            endpoint_result["path"] == str(project) and endpoint_result["cancelled"] is False,
            endpoint_result["path"],
        )

        scripts = []
        mac = MacOps()
        mac._run_applescript = lambda script, failure: scripts.append(script)
        result = mac.reveal_project(project)
        check(
            "macOS 打开上级目录并选中",
            result["directory"] == str(project.parent)
            and result["selected"] == str(project)
            and "select targetItem" in scripts[0],
            result["directory"],
        )

    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["OCM_PREFERENCES"] = str(Path(temp_dir) / "preferences.json")
        empty = read_preferences()
        check("偏好首次读取", empty["initialized"] is False, str(empty["settings"]["background"]))
        check("默认背景", empty["settings"] == DEFAULT_SETTINGS)

        saved = write_preferences(
            {
                "settings": {"completionSound": False, "background": "#E5E5E5"},
                "pinnedProjects": ["prj_a", "prj_a", "prj_b"],
            }
        )
        check("偏好写入", saved["initialized"] is True, saved["updated"])
        loaded = read_preferences()
        check("偏好往返", loaded["settings"]["completionSound"] is False, loaded["settings"]["background"])
        check("置顶去重", loaded["pinnedProjects"] == ["prj_a", "prj_b"], str(loaded["pinnedProjects"]))

        write_preferences({"settings": {"completionSound": True}})
        merged = read_preferences()
        check(
            "合并写入",
            merged["settings"]["completionSound"] is True
            and merged["settings"]["background"] == "#e5e5e5"
            and merged["pinnedProjects"] == ["prj_a", "prj_b"],
        )

        invalid = write_preferences({"settings": {"background": "红色"}})
        check("非法背景回退", invalid["settings"]["background"] == "#f2f2f2", invalid["settings"]["background"])

        try:
            write_preferences({"unknown": 1})
        except PreferencesError as error:
            check("未知字段拒绝", "unknown" in str(error), str(error))
        else:
            raise AssertionError("未知字段没有被拒绝")

    print(f"\n全部 {len(PASSED)} 项通过")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"\n失败：{error}")
        sys.exit(1)
