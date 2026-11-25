import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ensure_opencode

PASSED = []


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name} 失败 {detail}")
    PASSED.append(name)
    print(f"通过 {name} {detail}".rstrip())


def main():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["OCM_OPENCODE_STATE"] = temp_dir
        check("缺少服务文件", ensure_opencode.read_service() is None)
        state = Path(temp_dir) / "service.json"
        state.write_text(
            json.dumps({"url": "http://127.0.0.1:1", "password": "x"}),
            encoding="utf-8",
        )
        check("读取服务文件", ensure_opencode.read_service()["password"] == "x")
        check("不可达服务", ensure_opencode.probe_service() is None)

    check("已在运行时直接返回", ensure_opencode.ensure(probe=lambda: "http://127.0.0.1:1") == 0)

    attempts = {"count": 0}

    def probe_after_start():
        attempts["count"] += 1
        return "http://127.0.0.1:2" if attempts["count"] > 1 else None

    check(
        "启动后等待就绪",
        ensure_opencode.ensure(
            probe=probe_after_start, starter=lambda: True, timeout=1, pause=lambda _: None
        )
        == 0,
    )
    check("启动失败返回非零", ensure_opencode.ensure(probe=lambda: None, starter=lambda: False) == 1)
    check(
        "超时返回非零",
        ensure_opencode.ensure(
            probe=lambda: None, starter=lambda: True, timeout=0, pause=lambda _: None
        )
        == 1,
    )

    if os.name == "nt":
        with tempfile.TemporaryDirectory() as temp_dir:
            marker = Path(temp_dir) / "marker.txt"
            cli = Path(temp_dir) / "opencode.cmd"
            cli.write_text(
                f'@echo off\r\necho %* > "{marker}"\r\nexit /b 0\r\n', encoding="ascii"
            )
            os.environ["OCM_OPENCODE_BIN"] = str(cli)
            try:
                started = ensure_opencode.start_service(str(cli))
            finally:
                os.environ.pop("OCM_OPENCODE_BIN", None)
            check(
                "启动命令调用",
                started and marker.read_text(encoding="ascii").strip() == "service start",
                marker.read_text(encoding="ascii").strip() if marker.exists() else "无标记",
            )

    print(f"\n全部 {len(PASSED)} 项通过")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"\n失败：{error}")
        sys.exit(1)
