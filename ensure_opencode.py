import base64
import http.client
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

TIMEOUT = 30.0
POLL = 0.5


def service_file():
    override = os.environ.get("OCM_OPENCODE_STATE")
    if override:
        return Path(override).expanduser() / "service.json"
    return Path.home() / ".local" / "state" / "opencode" / "service.json"


def read_service():
    path = service_file()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get("url"):
        return None
    return data


def probe_service():
    data = read_service()
    if not data:
        return None
    parts = urlsplit(str(data["url"]))
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    host = "127.0.0.1" if parts.hostname in {"0.0.0.0", "::"} else parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    connection_class = (
        http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    )
    headers = {}
    password = data.get("password")
    if password:
        token = base64.b64encode(f"opencode:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    connection = connection_class(host, port, timeout=2)
    try:
        connection.request("GET", "/api/info", headers=headers)
        response = connection.getresponse()
        response.read(128)
        status = response.status
    except (OSError, http.client.HTTPException, ValueError):
        return None
    finally:
        connection.close()
    if status == 200:
        return str(data["url"])
    return None


def find_cli():
    override = os.environ.get("OCM_OPENCODE_BIN")
    if override:
        return override
    found = shutil.which("opencode")
    if found:
        return found
    for candidate in (
        Path.home() / ".opencode" / "bin" / "opencode.exe",
        Path.home() / ".opencode" / "bin" / "opencode",
    ):
        if candidate.is_file():
            return str(candidate)
    return None


def start_service(cli):
    print("opencode 后台服务没有运行，正在启动。", flush=True)
    command = [cli, "service", "start"]
    if os.name == "nt" and Path(cli).suffix.lower() in {".cmd", ".bat"}:
        command = ["cmd.exe", "/c", *command]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(Path.home()),
        )
    except (OSError, subprocess.SubprocessError) as error:
        print(f"启动 opencode 失败：{error}", flush=True)
        return False
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        print(f"启动 opencode 失败：{detail or '未知错误'}", flush=True)
        return False
    return True


def ensure(probe=probe_service, starter=None, timeout=TIMEOUT, pause=time.sleep):
    url = probe()
    if url:
        print(f"opencode 后台服务已在运行：{url}", flush=True)
        return 0
    if starter is None:
        cli = find_cli()
        if not cli:
            print("没有找到 opencode 命令，请先安装 opencode。", flush=True)
            return 1
        starter = lambda: start_service(cli)
    if not starter():
        return 1
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        url = probe()
        if url:
            print(f"opencode 后台服务已就绪：{url}", flush=True)
            return 0
        pause(POLL)
    print(f"opencode 在 {int(timeout)} 秒内没有就绪，请检查 opencode 安装。", flush=True)
    return 1


def main():
    return ensure()


if __name__ == "__main__":
    raise SystemExit(main())
