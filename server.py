import asyncio
import json
import os
import shlex
import subprocess
from pathlib import Path

import httpx
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SERVICE_FILE = Path.home() / ".local" / "state" / "opencode" / "service.json"
API_TIMEOUT = httpx.Timeout(60.0, connect=5.0)

app = FastAPI(title="opencode")


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


def upstream(timeout=None):
    service = read_service()
    return httpx.AsyncClient(
        base_url=service["url"],
        auth=httpx.BasicAuth("opencode", service["password"]),
        timeout=timeout or API_TIMEOUT,
        trust_env=False,
    )


async def call(method, path, **kwargs):
    async with upstream() as client:
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


@app.get("/api/health")
async def health():
    service = read_service()
    reachable = True
    info = None
    try:
        async with upstream(httpx.Timeout(5.0, connect=3.0)) as client:
            resp = await client.get("/api/info")
            reachable = resp.status_code < 500
            if resp.status_code == 200:
                info = resp.json()
    except httpx.HTTPError:
        reachable = False
    return {
        "reachable": reachable,
        "url": service.get("url"),
        "version": service.get("version"),
        "pid": service.get("pid"),
        "info": info,
    }


@app.get("/api/projects")
async def projects():
    items = await call("GET", "/api/project", params={"archived": "false"})
    if isinstance(items, list):
        for item in items:
            canonical = item.get("canonical") or ""
            item["exists"] = bool(canonical) and Path(canonical).expanduser().is_dir()
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
    if not path.is_dir():
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
        for message in result.get("data") or []:
            files = message.get("files")
            if not isinstance(files, list):
                continue
            for item in files:
                if isinstance(item, dict):
                    item.pop("data", None)
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
):
    params = [("types", item) for item in (types or [])]
    if session:
        params.append(("session", session))

    async def stream():
        while True:
            if await request.is_disconnected():
                return
            try:
                async with upstream(httpx.Timeout(None, connect=10.0)) as client:
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


@app.post("/api/show-folder")
def show_folder(payload: dict = Body(default={})):
    raw = str(payload.get("path") or "").strip() or str(Path.home())
    directory = Path(raw).expanduser()
    if not directory.is_dir():
        directory = Path.home()
    escaped = str(directory).replace("\\", "\\\\").replace('"', '\\"')
    script = (
        'tell application "Finder"\n'
        "activate\n"
        f'open (POSIX file "{escaped}" as alias)\n'
        "end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", script], capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise HTTPException(status_code=500, detail=f"打开访达失败：{detail or '未知错误'}")
    return {"path": str(directory)}


@app.get("/api/finder-selection")
def finder_selection():
    script = (
        'tell application "Finder"\n'
        "set sel to selection\n"
        "if (count of sel) is 0 then return \"\"\n"
        "return POSIX path of (item 1 of sel as alias)\n"
        "end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", script], capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise HTTPException(status_code=500, detail=f"读取访达选区失败：{detail or '未知错误'}")
    chosen = result.stdout.strip().rstrip("/") or ""
    if not chosen:
        raise HTTPException(status_code=404, detail="访达里还没有选中文件夹")
    directory = Path(chosen)
    if not directory.is_dir():
        raise HTTPException(status_code=400, detail="请选中一个文件夹，而不是文件")
    return {"path": str(directory)}


@app.post("/api/run")
async def run_project(payload: dict = Body(...)):
    raw_path = str(payload.get("path", "")).strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="缺少目录路径")
    directory = Path(raw_path).expanduser()
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"目录不存在：{directory}")
    script = directory / "just_run.sh"
    if not script.is_file():
        raise HTTPException(status_code=404, detail="项目目录没有 just_run.sh")
    command = f"cd {shlex.quote(str(directory))} && ./just_run.sh"
    if not os.access(script, os.X_OK):
        command = f"cd {shlex.quote(str(directory))} && bash just_run.sh"
    title = f"{directory.name} · just_run.sh"
    escaped = command.replace("\\", "\\\\").replace('"', '\\"')
    escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
    applescript = (
        'tell application "Terminal"\n'
        "activate\n"
        f'do script "{escaped}"\n'
        f'set custom title of selected tab of front window to "{escaped_title}"\n'
        "set title displays custom title of selected tab of front window to true\n"
        "set frontmost of front window to true\n"
        "end tell"
    )
    result = subprocess.run(
        ["osascript", "-e", applescript], capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise HTTPException(status_code=500, detail=f"打开终端失败：{detail or '未知错误'}")
    return {"ok": True, "directory": str(directory), "title": title}


@app.post("/api/reveal")
async def reveal(payload: dict = Body(...)):
    raw_path = str(payload.get("path", "")).strip()
    target = str(payload.get("target", "finder"))
    select = bool(payload.get("select"))
    if not raw_path:
        raise HTTPException(status_code=400, detail="缺少目录路径")
    directory = Path(raw_path).expanduser()
    if not directory.is_dir():
        raise HTTPException(status_code=404, detail=f"目录不存在：{directory}")
    if target == "terminal":
        subprocess.Popen(["open", "-a", "Terminal", str(directory)])
        return {"ok": True, "directory": str(directory)}
    escaped = str(directory).replace("\\", "\\\\").replace('"', '\\"')
    if select:
        body = (
            "activate\n"
            f'set targetItem to (POSIX file "{escaped}" as alias)\n'
            "reveal targetItem\n"
            "select targetItem\n"
            "activate\n"
        )
    else:
        body = "activate\n" f'open (POSIX file "{escaped}" as alias)\n'
    applescript = 'tell application "Finder"\n' f"{body}" "end tell"
    result = subprocess.run(
        ["osascript", "-e", applescript], capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise HTTPException(status_code=500, detail=f"打开访达失败：{detail or '未知错误'}")
    opened = str(directory.parent) if select else str(directory)
    return {"ok": True, "directory": opened, "selected": str(directory) if select else None}


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
