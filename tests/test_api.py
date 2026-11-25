import json
import os
import sys
import tempfile

import httpx

BASE = os.environ.get("OCM_BASE", "http://127.0.0.1:7860")
PASSED = []


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name} 失败 {detail}")
    PASSED.append(name)
    print(f"通过 {name} {detail}".rstrip())


def main():
    client = httpx.Client(base_url=BASE, timeout=30.0, trust_env=False)

    health = client.get("/api/health").json()
    check("服务健康", health.get("reachable") is True, f"版本 {health.get('version')}")

    platform = client.get("/api/platform").json()
    check(
        "平台信息",
        platform.get("name") in {"windows", "macos", "linux"}
        and platform.get("script") in {"just_run.bat", "just_run.sh"},
        f"{platform.get('label')} · {platform.get('folderLabel')}",
    )

    preferences = client.get("/api/preferences").json()
    check(
        "偏好读取",
        isinstance(preferences.get("initialized"), bool)
        and isinstance(preferences.get("settings", {}).get("completionSound"), bool)
        and isinstance(preferences.get("pinnedProjects"), list),
        str(preferences.get("settings")),
    )

    projects = client.get("/api/projects").json()
    check("项目列表", isinstance(projects, list) and len(projects) > 0, f"{len(projects)} 个项目")
    first_project = projects[0]
    check(
        "项目字段",
        "id" in first_project and "canonical" in first_project,
        first_project.get("canonical", ""),
    )
    check(
        "项目目录存在标记",
        all("exists" in item for item in projects),
        f"{sum(1 for item in projects if item.get('exists'))} 个目录存在",
    )

    target = next((item for item in projects if item.get("exists")), first_project)
    model_list = client.get("/api/models", params={"directory": target["canonical"]}).json()
    check("模型列表", len(model_list.get("data", [])) > 0, f"{len(model_list['data'])} 个")
    agent_list = client.get("/api/agents", params={"directory": target["canonical"]}).json()
    check("Agent 列表", len(agent_list.get("data", [])) > 0, f"{len(agent_list['data'])} 个")
    with tempfile.TemporaryDirectory() as empty_dir:
        no_script = client.post("/api/run", json={"path": empty_dir})
    check(
        "运行缺少脚本",
        no_script.status_code == 404
        and ("just_run.bat" in str(no_script.json().get("detail")) or "just_run.sh" in str(no_script.json().get("detail"))),
        str(no_script.status_code),
    )
    created = client.post(
        "/api/sessions", json={"location": {"directory": target["canonical"]}}
    ).json()["data"]
    check("新建会话", created.get("id", "").startswith("ses_"), created.get("title", ""))
    inbox = client.get(f"/api/sessions/{created['id']}/inbox").json()
    check("会话队列", isinstance(inbox.get("data"), list), f"{len(inbox['data'])} 条排队")
    cancel = client.delete(f"/api/sessions/{created['id']}/inbox/msg_missing")
    check("取消排队", cancel.status_code == 204, str(cancel.status_code))

    model = next(
        (item for item in model_list["data"] if item.get("enabled")), model_list["data"][0]
    )
    switched_model = client.post(
        f"/api/sessions/{created['id']}/model",
        json={"model": {"id": model["modelID"], "providerID": model["providerID"]}},
    )
    check("切换模型", switched_model.status_code == 204, str(switched_model.status_code))

    agent = next(
        (
            item
            for item in agent_list["data"]
            if not item.get("hidden") and item.get("mode") != "subagent"
        ),
        agent_list["data"][0],
    )
    switched_agent = client.post(
        f"/api/sessions/{created['id']}/agent", json={"agent": agent["id"]}
    )
    check("切换 agent", switched_agent.status_code == 204, str(switched_agent.status_code))

    compact = client.post(f"/api/sessions/{created['id']}/compact", json={})
    check("压缩上下文", compact.status_code in (200, 409), str(compact.status_code))

    permissions = client.get(f"/api/sessions/{created['id']}/permissions").json()
    check("授权列表", isinstance(permissions.get("data"), list))
    permission_reply = client.post(
        f"/api/sessions/{created['id']}/permissions/per_missing/reply",
        json={"decision": "reject"},
    )
    check("授权回复接口", permission_reply.status_code == 404, str(permission_reply.status_code))

    commands = client.get("/api/commands", params={"directory": target["canonical"]}).json()
    check("命令列表", isinstance(commands.get("data"), list), f"{len(commands.get('data', []))} 个")
    missing_command = client.post(
        f"/api/sessions/{created['id']}/command",
        json={"name": "__missing__", "arguments": "", "text": "/__missing__"},
    )
    check("未知命令返回 404", missing_command.status_code == 404, str(missing_command.status_code))

    forms = client.get(f"/api/sessions/{created['id']}/forms").json()
    check("表单列表", isinstance(forms.get("data"), list))
    form_reply = client.post(
        f"/api/sessions/{created['id']}/forms/frm_missing/reply", json={"answer": {}}
    )
    check("表单回复接口", form_reply.status_code == 404, str(form_reply.status_code))

    revert = client.post(
        f"/api/sessions/{created['id']}/revert",
        json={"messageID": "msg_missing", "files": False},
    )
    check("回退接口", revert.status_code in (400, 404), str(revert.status_code))

    removed = client.delete(f"/api/sessions/{created['id']}")
    check("删除临时会话", removed.status_code == 204, str(removed.status_code))

    sessions = client.get("/api/sessions", params={"limit": 20}).json()
    check(
        "会话列表",
        isinstance(sessions.get("data"), list) and len(sessions["data"]) > 0,
        f"{len(sessions['data'])} 条",
    )

    active = client.get("/api/sessions/active").json()
    check("运行中会话", isinstance(active.get("data"), dict), f"{len(active.get('data', {}))} 个")

    stats = client.get("/api/stats").json()["data"]
    check("用量统计", "tokens" in stats and "cost" in stats, f"成本 {stats['cost']:.2f} 美元")

    session = sessions["data"][0]
    detail = client.get(f"/api/sessions/{session['id']}").json()["data"]
    check("会话详情", detail["id"] == session["id"], detail.get("title", ""))

    first_page = client.get(
        f"/api/sessions/{session['id']}/messages",
        params={"limit": 5, "order": "asc"},
    ).json()
    check("消息分页", isinstance(first_page.get("data"), list), f"{len(first_page['data'])} 条")
    cursor = (first_page.get("cursor") or {}).get("next")
    if cursor:
        second_page = client.get(
            f"/api/sessions/{session['id']}/messages",
            params={"limit": 5, "cursor": cursor},
        ).json()
        check("游标翻页", isinstance(second_page.get("data"), list), f"{len(second_page['data'])} 条")

    missing = client.get("/api/sessions/ses_不存在的会话")
    check("不存在会话返回 404", missing.status_code == 404, str(missing.status_code))

    index = client.get("/")
    check(
        "前端页面",
        index.status_code == 200 and "<title>opencode</title>" in index.text,
        f"{len(index.text)} 字节",
    )

    missing = client.post("/api/reveal", json={"path": "/tmp/不存在的目录xyz"})
    check("打开目录缺路径报错", missing.status_code == 404, str(missing.status_code))

    with client.stream(
        "GET", "/api/events", params=[("types", "session.created")], timeout=10.0
    ) as response:
        check("事件流状态", response.status_code == 200, str(response.status_code))
        got = None
        for line in response.iter_lines():
            if line.startswith("data:"):
                got = json.loads(line[len("data:"):].strip())
                break
        check("事件流首帧", got is not None, got.get("type", "") if got else "无数据")

    print(f"\n全部 {len(PASSED)} 项通过")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"\n失败：{error}")
        sys.exit(1)
    except httpx.HTTPError as error:
        print(f"\n网络错误：{error}")
        sys.exit(1)
