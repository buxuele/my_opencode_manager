import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_SETTINGS = {"completionSound": True, "background": "#f2f2f2"}
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
PINNED_LIMIT = 500


class PreferencesError(ValueError):
    pass


def preferences_path():
    override = os.environ.get("OCM_PREFERENCES")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".config" / "opencode_manager" / "preferences.json"


def normalize_settings(raw):
    settings = dict(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        return settings
    if isinstance(raw.get("completionSound"), bool):
        settings["completionSound"] = raw["completionSound"]
    background = raw.get("background")
    if isinstance(background, str) and HEX_COLOR.match(background):
        settings["background"] = background.lower()
    return settings


def normalize_pinned(raw):
    if not isinstance(raw, list):
        return []
    seen = set()
    result = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
        if len(result) >= PINNED_LIMIT:
            break
    return result


def read_preferences():
    path = preferences_path()
    if not path.exists():
        return {
            "initialized": False,
            "version": SCHEMA_VERSION,
            "settings": dict(DEFAULT_SETTINGS),
            "pinnedProjects": [],
            "updated": None,
        }
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PreferencesError(f"读取偏好设置失败：{exc}")
    if not isinstance(raw, dict):
        raise PreferencesError("偏好设置文件格式不正确")
    return {
        "initialized": True,
        "version": SCHEMA_VERSION,
        "settings": normalize_settings(raw.get("settings")),
        "pinnedProjects": normalize_pinned(raw.get("pinnedProjects")),
        "updated": raw.get("updated"),
    }


def write_preferences(payload):
    if not isinstance(payload, dict):
        raise PreferencesError("偏好设置必须是对象")
    unknown = set(payload) - {"settings", "pinnedProjects"}
    if unknown:
        raise PreferencesError(f"不支持的偏好字段：{'、'.join(sorted(unknown))}")
    current = read_preferences()
    if "settings" in payload and not isinstance(payload["settings"], dict):
        raise PreferencesError("settings 必须是对象")
    if "pinnedProjects" in payload and not isinstance(payload["pinnedProjects"], list):
        raise PreferencesError("pinnedProjects 必须是数组")
    settings = normalize_settings({**current["settings"], **(payload.get("settings") or {})})
    if "pinnedProjects" in payload:
        pinned = normalize_pinned(payload["pinnedProjects"])
    else:
        pinned = current["pinnedProjects"]
    data = {
        "version": SCHEMA_VERSION,
        "settings": settings,
        "pinnedProjects": pinned,
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    path = preferences_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(
        dir=str(path.parent), prefix=".preferences-", suffix=".json"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except OSError as exc:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise PreferencesError(f"保存偏好设置失败：{exc}")
    return {"initialized": True, **data}
