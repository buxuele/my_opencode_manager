import asyncio
import ipaddress
import json
import os
import shlex
import subprocess
import tempfile
import time
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from platform_ops import PlatformError, current_ops
from preferences import PreferencesError, read_preferences, write_preferences

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SERVICE_FILE = Path.home() / ".local" / "state" / "opencode" / "service.json"
MACHINES_FILE = ROOT / ".machines.json"
STATE_FILE = ROOT / ".machines.state.json"
API_TIMEOUT = httpx.Timeout(60.0, connect=5.0)
CURRENT_MACHINE = ContextVar("current_machine", default="local")
OPS = current_ops()


def local_service_url(url):
    parts = urlsplit(str(url))
    if parts.hostname in {"0.0.0.0", "::"}:
        host = "127.0.0.1"
        netloc = f"{host}:{parts.port}" if parts.port else host
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return str(url)

app = FastAPI(title="opencode")


@app.middleware("http")
async def bind_machine(request: Request, call_next):
    machine = request.headers.get("x-opc-machine") or request.query_params.get("machine") or "local"
    token = CURRENT_MACHINE.set(machine)
    try:
        return await call_next(request)
    finally:
        CURRENT_MACHINE.reset(token)


def read_remote_machines():
    if not MACHINES_FILE.exists():
        return []
    try:
        raw = json.loads(MACHINES_FILE.read_text())
    except (OSError, ValueError):
        return []
    items = raw.get("machines") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    machines = []
    for item in items:
        if not isinstance(item, dict) or not item.get("id") or not item.get("password"):
            continue
        routes = []
        for value in [item.get("url"), *(item.get("urls") or [])]:
            if not isinstance(value, str):
                continue
            value = value.strip().rstrip("/")
            if value and value not in routes:
                routes.append(value)
        if not routes:
            continue
        machines.append({**item, "url": routes[0], "routes": routes})
    return machines


def read_route_state():
    if not STATE_FILE.exists():
        return {}
    try:
        raw = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_route_state(machine_id, route):
    data = read_route_state()
    data[machine_id] = {"route": route, "seen": int(time.time())}
    try:
        STATE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    except OSError:
        pass


def known_route(machine_id):
    entry = read_route_state().get(machine_id)
    if isinstance(entry, dict) and isinstance(entry.get("route"), str):
        return entry["route"]
    return None


def machine_list():
    machines = [{"id": "local", "name": "本机", "kind": "local"}]
    for item in read_remote_machines():
        machines.append({"id": item["id"], "name": item.get("name") or item["id"], "kind": "remote"})
    return machines


def machine_config(machine=None):
    mid = machine or CURRENT_MACHINE.get() or "local"
    if mid == "local":
        service = read_service()
        return {
            "id": "local",
            "url": service["url"],
            "password": service["password"],
            "version": service.get("version"),
            "pid": service.get("pid"),
        }
    for item in read_remote_machines():
        if item["id"] == mid:
            return {
                "id": mid,
                "url": item["url"],
                "routes": item["routes"],
                "ports": item.get("ports") or [],
                "password": item["password"],
            }
    raise HTTPException(status_code=404, detail=f"没有配置这台机器：{mid}")
@app.post("/api/pick-folder")
def pick_folder(payload: dict = Body(default={})):
    require_local()
    raw = str(payload.get("path") or "").strip()
    initial = Path(raw).expanduser() if raw else None
    try:
        return OPS.pick_folder(initial)
    except PlatformError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/platform")
def platform_info():
    return OPS.info()


@app.get("/api/preferences")
def get_preferences():
    try:
        return read_preferences()
    except PreferencesError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/api/preferences")
def put_preferences(payload: dict = Body(...)):
    try:
        return write_preferences(payload)
    except PreferencesError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def read_service():
    if not SERVICE_FILE.exists():
        raise HTTPException(
            status_code=503,
            detail="没有找到 opencode 服务信息。请先启动 opencode，或运行 opencode serve",
        )
    try:
        raw = json.loads(SERVICE_FILE.read_text())
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=f"读取 opencode 服务信息失败：{exc}")
    url = raw.get("url")
    password = raw.get("password")
    if not url or not password:
        raise HTTPException(status_code=503, detail="opencode 服务信息不完整，缺少地址或密码")
    return raw


def remote_cfg(machine=None):
    cfg = machine_config(machine)
    return cfg if cfg["id"] != "local" else None


def curl_url(cfg, path, params=None):
    url = cfg["url"].rstrip("/") + path
    if params:
        items = params.items() if isinstance(params, dict) else params
        query = "&".join(f"{quote(str(key))}={quote(str(value))}" for key, value in items)
        url = f"{url}?{query}"
    return url


CURL_ERRORS = {
    5: "代理解析失败",
    6: "域名解析失败",
    7: "无法建立连接，请确认远端 opencode 在运行且地址端口正确",
    28: "请求超时",
    35: "TLS 握手失败",
    52: "远端没有返回内容",
    55: "发送数据失败",
    56: "网络传输中断",
}

REMOTE_ROUTES = {}


def curl_reason(code, err):
    hint = CURL_ERRORS.get(code)
    text = err.decode(errors="replace").strip()
    if hint and text:
        return f"{hint}（curl {code}：{text}）"
    return hint or text or f"curl 退出码 {code}"


def machine_routes(cfg):
    routes = cfg.get("routes") or [cfg["url"]]
    ordered = []
    for value in [REMOTE_ROUTES.get(cfg["id"]), known_route(cfg["id"]), *routes]:
        if value and value not in ordered:
            ordered.append(value)
    return ordered


def lan_hosts():
    if os.name == "nt":
        command = [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-NetIPAddress -AddressFamily IPv4 | ConvertTo-Json -Compress",
        ]
    else:
        command = ["ifconfig"]
    try:
        raw = subprocess.run(command, capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    interfaces = []
    if os.name == "nt":
        try:
            items = json.loads(raw or "[]")
        except ValueError:
            return []
        for item in items if isinstance(items, list) else [items]:
            interfaces.append((item.get("IPAddress"), item.get("PrefixLength")))
    else:
        for line in raw.splitlines():
            parts = line.split()
            if "inet" not in parts:
                continue
            index = parts.index("inet")
            address = parts[index + 1] if len(parts) > index + 1 else ""
            mask = ""
            if "netmask" in parts:
                mask_index = parts.index("netmask")
                mask = parts[mask_index + 1] if len(parts) > mask_index + 1 else ""
            interfaces.append((address, mask))
    hosts = []
    for address, mask in interfaces:
        try:
            ip = ipaddress.IPv4Address(address)
        except (ValueError, ipaddress.AddressValueError):
            continue
        if ip.is_loopback or not ip.is_private:
            continue
        try:
            if isinstance(mask, str) and mask.startswith("0x"):
                length = bin(int(mask, 16)).count("1")
            elif isinstance(mask, str) and "." in mask:
                length = ipaddress.IPv4Network(f"0.0.0.0/{mask}").prefixlen
            elif isinstance(mask, int):
                length = mask
            else:
                length = ipaddress.IPv4Network(f"{ip}/24", strict=False).prefixlen
            network = ipaddress.IPv4Network(f"{ip}/{length}", strict=False)
        except ValueError:
            continue
        if network.num_addresses > 256:
            network = ipaddress.IPv4Network(f"{ip}/24", strict=False)
        for host in network.hosts():
            value = str(host)
            if value != str(ip) and value not in hosts:
                hosts.append(value)
    return hosts


def scan_ports(cfg):
    ports = []
    for route in cfg.get("routes") or [cfg.get("url")]:
        try:
            port = urlsplit(route).port
        except ValueError:
            port = None
        if port and port not in ports:
            ports.append(port)
    for port in cfg.get("ports") or []:
        if isinstance(port, int) and 0 < port < 65536 and port not in ports:
            ports.append(port)
    if 4096 not in ports:
        ports.append(4096)
    return ports


async def scan_lan(cfg, timeout=0.5):
    hosts = lan_hosts()
    ports = scan_ports(cfg)
    if not hosts or not ports:
        return None
    semaphore = asyncio.Semaphore(64)

    async def probe(host, port):
        async with semaphore:
            url = f"http://{host}:{port}"
            try:
                proc = await asyncio.create_subprocess_exec(
                    "curl", "-sS", "--noproxy", "*", "-m", str(timeout),
                    "-u", f"opencode:{cfg['password']}", f"{url}/api/info",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except OSError:
                return None
            out, _ = await proc.communicate()
            if proc.returncode != 0 or not out:
                return None
            try:
                info = json.loads(out.decode(errors="replace"))
            except ValueError:
                return None
            if isinstance(info, dict) and info.get("version"):
                return url
            return None

    tasks = [asyncio.create_task(probe(host, port)) for port in ports for host in hosts]
    try:
        for task in asyncio.as_completed(tasks):
            route = await task
            if route:
                return route
        return None
    finally:
        for task in tasks:
            task.cancel()


DISCOVERY_AT = {}


async def discover_remote(cfg, force=False):
    mid = cfg["id"]
    now = time.time()
    if not force and now - DISCOVERY_AT.get(mid, 0) < 20:
        return None
    DISCOVERY_AT[mid] = now
    route = await scan_lan(cfg)
    if route:
        REMOTE_ROUTES[mid] = route
        save_route_state(mid, route)
    return route


class RemoteUnreachable(Exception):
    def __init__(self, detail):
        super().__init__(detail)
        self.detail = detail


async def curl_once(cfg, method, path, body_path, params=None, timeout=60):
    args = [
        "curl",
        "-sS",
        "--noproxy",
        "*",
        "-m",
        str(timeout),
        "-u",
        f"opencode:{cfg['password']}",
        "-X",
        method,
    ]
    if body_path:
        args += ["-H", "Content-Type: application/json", "--data-binary", f"@{body_path}"]
    args += [curl_url(cfg, path, params), "-w", "\n%{http_code}"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except OSError as exc:
        raise RemoteUnreachable(f"无法启动 curl：{exc}")
    out, err = await proc.communicate()
    text = out.decode(errors="replace")
    payload, _, status_text = text.rpartition("\n")
    status = 0
    if status_text.strip().isdigit():
        status = int(status_text.strip())
    if status == 0 or proc.returncode != 0:
        raise RemoteUnreachable(curl_reason(proc.returncode, err))
    if status == 204:
        return Response(status_code=204)
    if status >= 400:
        try:
            detail = json.loads(payload).get("detail") or json.loads(payload)
        except (ValueError, AttributeError):
            detail = payload[:300] or f"opencode 返回 {status}"
        raise HTTPException(status_code=status, detail=detail)
    if not payload.strip():
        return None
    try:
        return json.loads(payload)
    except ValueError:
        raise HTTPException(
            status_code=502, detail=f"远端返回内容不是 JSON：{payload[:120]}"
        )


async def curl_call(cfg, method, path, params=None, body=None, timeout=60):
    body_file = None
    body_path = None
    if body is not None:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", prefix="ocm-body-", suffix=".json", delete=False
        ) as handle:
            json.dump(body, handle, ensure_ascii=False)
            body_file = handle.name
        body_path = body_file
    failures = []
    try:
        for route in machine_routes(cfg):
            target = {**cfg, "url": route}
            try:
                result = await curl_once(
                    target, method, path, body_path, params=params, timeout=timeout
                )
            except RemoteUnreachable as exc:
                failures.append(f"{route}：{exc.detail}")
                if REMOTE_ROUTES.get(cfg["id"]) == route:
                    REMOTE_ROUTES.pop(cfg["id"], None)
                continue
            REMOTE_ROUTES[cfg["id"]] = route
            return result
        if cfg.get("discover", True):
            route = await discover_remote(cfg)
            if route:
                try:
                    result = await curl_once(
                        {**cfg, "url": route}, method, path, body_path,
                        params=params, timeout=timeout,
                    )
                except RemoteUnreachable as exc:
                    failures.append(f"{route}（自动发现）：{exc.detail}")
                else:
                    REMOTE_ROUTES[cfg["id"]] = route
                    save_route_state(cfg["id"], route)
                    return result
    finally:
        if body_file:
            try:
                os.unlink(body_file)
            except OSError:
                pass
    tried = "；".join(failures) or "没有配置可用地址"
    if len(failures) > 1:
        raise HTTPException(
            status_code=502, detail=f"远端所有地址都连不上，局域网里也没有找到。{tried}"
        )
    raise HTTPException(
        status_code=502, detail=f"连接远端服务失败，局域网里也没有找到：{tried}"
    )


def upstream(timeout=None, machine=None):
    service = machine_config(machine)
    base = local_service_url(service["url"]) if service["id"] == "local" else service["url"]
    return httpx.AsyncClient(
        base_url=base,
        auth=httpx.BasicAuth("opencode", service["password"]),
        timeout=timeout or API_TIMEOUT,
        trust_env=False,
    )


async def call(method, path, **kwargs):
    machine = kwargs.pop("machine", None)
    cfg = machine_config(machine)
    if cfg["id"] != "local":
        return await curl_call(
            cfg, method, path, params=kwargs.get("params"), body=kwargs.get("json")
        )
    async with upstream(machine=machine) as client:
        try:
            resp = await client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"连接 opencode 服务失败：{exc}")
    if resp.status_code == 204:
        return Response(status_code=204)
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text or f"opencode 返回 {resp.status_code}"
        raise HTTPException(status_code=resp.status_code, detail=detail)
    return resp.json()


@app.get("/api/machines")
async def machines():
    return {"current": CURRENT_MACHINE.get(), "machines": machine_list()}


@app.post("/api/machines/{machine_id}/discover")
async def discover_machine(machine_id: str):
    cfg = machine_config(machine_id)
    if cfg["id"] == "local":
        raise HTTPException(status_code=400, detail="本机不需要查找")
    route = await discover_remote(cfg, force=True)
    if not route:
        raise HTTPException(
            status_code=502,
            detail="局域网里没有找到这台机器的 opencode，确认那台机器已开机且防火墙放行端口",
        )
    return {"machine": machine_id, "route": route, "routes": machine_routes(cfg)}


@app.get("/api/health")
async def health():
    service = machine_config()
    reachable = True
    info = None
    error = None
    if service["id"] == "local":
        try:
            async with upstream(httpx.Timeout(5.0, connect=3.0)) as client:
                resp = await client.get("/api/info")
                reachable = resp.status_code < 500
                if resp.status_code == 200:
                    info = resp.json()
                else:
                    error = f"opencode 返回 {resp.status_code}"
        except httpx.HTTPError as exc:
            reachable = False
            error = str(exc)
    else:
        try:
            info = await curl_call(service, "GET", "/api/info", timeout=4)
        except HTTPException as exc:
            reachable = False
            error = exc.detail
    version = service.get("version")
    if isinstance(info, dict) and info.get("version"):
        version = info["version"]
    return {
        "reachable": reachable,
        "url": service.get("url"),
        "routes": service.get("routes") or [service.get("url")],
        "error": error,
        "version": version,
        "pid": service.get("pid"),
        "info": info,
        "machine": service["id"],
    }


@app.get("/api/projects")
async def projects():
    items = await call("GET", "/api/project", params={"archived": "false"})
    local = CURRENT_MACHINE.get() == "local"
    if isinstance(items, list):
        for item in items:
            canonical = item.get("canonical") or ""
            item["exists"] = (
                bool(canonical) and Path(canonical).expanduser().is_dir() if local else True
            )
    return items


@app.patch("/api/projects/{project_id}")
async def project_update(project_id: str, payload: dict = Body(...)):
    return await call("PATCH", f"/api/project/{project_id}", json=payload)


@app.get("/api/sessions")
async def sessions(
    limit: int = 500,
    project: str | None = None,
    search: str | None = None,
    cursor: str | None = None,
    parent: str | None = None,
):
    params = {"limit": str(limit), "archived": "false"}
    if project:
        params["project"] = project
    if search:
        params["search"] = search
    if cursor:
        params["cursor"] = cursor
    if parent:
        params["parentID"] = parent
    return await call("GET", "/api/session", params=params)


@app.post("/api/sessions")
async def session_create(payload: dict = Body(...)):
    location = payload.get("location") or {}
    directory = str(location.get("directory") or "").strip()
    if not directory:
        raise HTTPException(status_code=400, detail="缺少项目目录")
    path = Path(directory).expanduser()
    if CURRENT_MACHINE.get() == "local" and not path.is_dir():
        raise HTTPException(status_code=400, detail=f"项目目录不存在：{path}")
    body = {key: value for key, value in payload.items() if key != "location"}
    body["location"] = {"directory": str(path)}
    return await call("POST", "/api/session", json=body)


@app.get("/api/sessions/active")
async def active_sessions():
    return await call("GET", "/api/session/active")


@app.get("/api/sessions/{session_id}")
async def session_detail(session_id: str):
    return await call("GET", f"/api/session/{session_id}")


def trim_message_payload(result):
    for message in result.get("data") or []:
        files = message.get("files")
        if isinstance(files, list):
            for item in files:
                if isinstance(item, dict):
                    item.pop("data", None)
        for part in message.get("content") or []:
            if not isinstance(part, dict) or part.get("type") != "tool":
                continue
            state = part.get("state")
            if not isinstance(state, dict):
                continue
            blocks = state.get("content")
            if not isinstance(blocks, list):
                continue
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                for key in ("uri", "url", "data"):
                    value = block.get(key)
                    if isinstance(value, str) and value.startswith("data:"):
                        block.pop(key, None)
                        block["omitted"] = True
    return result


@app.get("/api/sessions/{session_id}/messages")
async def session_messages(
    session_id: str,
    limit: int = 200,
    order: str | None = None,
    cursor: str | None = None,
):
    params = {"limit": str(limit)}
    if cursor:
        params["cursor"] = cursor
    elif order:
        params["order"] = order
    result = await call("GET", f"/api/session/{session_id}/message", params=params)
    if isinstance(result, dict):
        return trim_message_payload(result)
    return result


@app.get("/api/sessions/{session_id}/messages/{message_id}")
async def session_message_detail(session_id: str, message_id: str):
    return await call("GET", f"/api/session/{session_id}/message/{message_id}")


@app.get("/api/sessions/{session_id}/inbox")
async def session_inbox(session_id: str):
    return await call("GET", f"/api/session/{session_id}/inbox")


@app.delete("/api/sessions/{session_id}/inbox/{inbox_id}")
async def session_inbox_cancel(session_id: str, inbox_id: str):
    return await call("DELETE", f"/api/session/{session_id}/inbox/{inbox_id}")


@app.get("/api/models")
async def models(directory: str | None = None):
    params = {}
    if directory:
        params["location[directory]"] = directory
    return await call("GET", "/api/model", params=params)


@app.get("/api/agents")
async def agents(directory: str | None = None):
    params = {}
    if directory:
        params["location[directory]"] = directory
    return await call("GET", "/api/agent", params=params)


@app.post("/api/sessions/{session_id}/model")
async def session_model(session_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/model", json=payload)


@app.post("/api/sessions/{session_id}/agent")
async def session_agent(session_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/agent", json=payload)


@app.post("/api/sessions/{session_id}/compact")
async def session_compact(session_id: str, payload: dict = Body(default={})):
    return await call("POST", f"/api/session/{session_id}/compact", json=payload)


@app.post("/api/sessions/{session_id}/revert")
async def session_revert_stage(session_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/revert/stage", json=payload)


@app.post("/api/sessions/{session_id}/revert/commit")
async def session_revert_commit(session_id: str):
    return await call("POST", f"/api/session/{session_id}/revert/commit")


@app.get("/api/sessions/{session_id}/permissions")
async def session_permissions(session_id: str):
    return await call("GET", f"/api/session/{session_id}/permission")


@app.post("/api/sessions/{session_id}/permissions/{request_id}/reply")
async def session_permission_reply(session_id: str, request_id: str, payload: dict = Body(...)):
    return await call(
        "POST", f"/api/session/{session_id}/permission/{request_id}/reply", json=payload
    )


@app.get("/api/sessions/{session_id}/forms")
async def session_forms(session_id: str):
    return await call("GET", f"/api/session/{session_id}/form")


@app.post("/api/sessions/{session_id}/forms/{form_id}/reply")
async def session_form_reply(session_id: str, form_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/form/{form_id}/reply", json=payload)


@app.delete("/api/sessions/{session_id}/forms/{form_id}")
async def session_form_cancel(session_id: str, form_id: str, message: str | None = None):
    params = {"message": message} if message else None
    return await call("DELETE", f"/api/session/{session_id}/form/{form_id}", params=params)


@app.patch("/api/sessions/{session_id}")
async def session_update(session_id: str, payload: dict = Body(...)):
    return await call("PATCH", f"/api/session/{session_id}", json=payload)


@app.delete("/api/sessions/{session_id}")
async def session_delete(session_id: str):
    return await call("DELETE", f"/api/session/{session_id}")


@app.post("/api/sessions/{session_id}/prompt")
async def session_prompt(session_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/prompt", json=payload)


@app.get("/api/commands")
async def commands(directory: str = Query(...)):
    return await call("GET", "/api/command", params={"location[directory]": directory})


@app.post("/api/sessions/{session_id}/command")
async def session_command(session_id: str, payload: dict = Body(...)):
    return await call("POST", f"/api/session/{session_id}/command", json=payload)


@app.post("/api/sessions/{session_id}/interrupt")
async def session_interrupt(session_id: str):
    return await call("POST", f"/api/session/{session_id}/interrupt")


@app.get("/api/stats")
async def stats(project: str | None = None, timezone: str = "Asia/Shanghai"):
    params = {"timezone": timezone, "tools": "summary"}
    if project:
        params["project"] = project
    return await call("GET", "/api/experimental/session/stats", params=params)


@app.get("/api/events")
async def events(
    request: Request,
    types: list[str] | None = Query(default=None),
    session: str | None = None,
    machine: str | None = None,
):
    target_machine = machine or CURRENT_MACHINE.get()
    target_cfg = machine_config(target_machine)
    params = [("types", item) for item in (types or [])]
    if session:
        params.append(("session", session))

    if target_cfg["id"] != "local":
        auth = f"opencode:{target_cfg['password']}"

        async def remote_stream():
            while True:
                if await request.is_disconnected():
                    return
                route = machine_routes(target_cfg)[0]
                event_url = curl_url({**target_cfg, "url": route}, "/api/event", params)
                proc = await asyncio.create_subprocess_exec(
                    "curl", "-sS", "-N", "--noproxy", "*", "-m", "0",
                    "-u", auth, "-H", "Accept: text/event-stream", event_url,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    while True:
                        chunk = await proc.stdout.read(4096)
                        if not chunk:
                            break
                        if await request.is_disconnected():
                            return
                        yield chunk
                finally:
                    if proc.returncode is None:
                        proc.kill()
                if await request.is_disconnected():
                    return
                yield b": relay heartbeat\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(
            remote_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def stream():
        while True:
            if await request.is_disconnected():
                return
            try:
                async with upstream(
                    httpx.Timeout(None, connect=10.0), machine=target_machine
                ) as client:
                    async with client.stream("GET", "/api/event", params=params or None) as resp:
                        if resp.status_code >= 400:
                            yield b"event: error\ndata: upstream rejected\n\n"
                            return
                        async for chunk in resp.aiter_bytes():
                            if await request.is_disconnected():
                                return
                            yield chunk
            except (httpx.HTTPError, RuntimeError):
                pass
            if await request.is_disconnected():
                return
            yield b": relay heartbeat\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def require_local():
    if CURRENT_MACHINE.get() != "local":
        raise HTTPException(status_code=400, detail="远端机器不支持本地目录与终端操作")


@app.post("/api/run")
async def run_project(payload: dict = Body(...)):
    require_local()
    raw_path = str(payload.get("path", "")).strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="缺少目录路径")
    directory = Path(raw_path).expanduser()
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"目录不存在：{directory}")
    script = directory / OPS.script_name
    if not script.is_file():
        raise HTTPException(status_code=404, detail=f"项目目录没有 {OPS.script_name}")
    try:
        return OPS.launch_project(directory)
    except PlatformError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/reveal")
async def reveal(payload: dict = Body(...)):
    require_local()
    raw_path = str(payload.get("path", "")).strip()
    target = str(payload.get("target", "finder"))
    select = bool(payload.get("select"))
    if not raw_path:
        raise HTTPException(status_code=400, detail="缺少目录路径")
    directory = Path(raw_path).expanduser()
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"目录不存在：{directory}")
    try:
        if target == "project":
            return OPS.reveal_project(directory)
        return OPS.reveal(directory, target=target, select=select)
    except PlatformError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    if not DIST.exists():
        return JSONResponse(
            status_code=503,
            content={"detail": "前端尚未构建，先运行 npm run build 或直接执行 just_run.sh"},
        )
    if full_path:
        candidate = (DIST / full_path).resolve()
        if candidate.is_file() and str(candidate).startswith(str(DIST.resolve())):
            return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
