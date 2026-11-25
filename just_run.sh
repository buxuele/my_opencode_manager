#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7860}"
URL="http://127.0.0.1:${PORT}/"
VENV=".venv"
STAMP="${VENV}/.requirements.sha"
FOUND_PID=""
FOUND_CMD=""

printf '\033]0;opencode_manager:%s\007' "${PORT}"

detect_instance() {
  local pid cwd cmd
  pid="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [ -z "${pid}" ]; then
    FOUND_PID=""
    FOUND_CMD=""
    return 1
  fi
  cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  FOUND_PID="${pid}"
  FOUND_CMD="${cmd}"
  if [ "${cwd}" = "$(pwd -P)" ] && [[ "${cmd}" == *"uvicorn server:app"* ]]; then
    return 0
  fi
  return 2
}

open_page() {
  if [ -n "${OCM_NO_OPEN:-}" ]; then
    return 0
  fi
  open "${URL}" 2>/dev/null || echo "自动打开失败，请手动访问 ${URL}"
}

handle_busy() {
  detect_instance && DETECTED=0 || DETECTED=$?
  if [ "${DETECTED}" -eq 0 ]; then
    echo "opencode 管理界面已经在运行：${URL}"
    echo "已为你打开页面，这个终端可以直接关闭。"
    open_page
    exit 0
  fi
  if [ "${DETECTED}" -eq 2 ]; then
    echo "端口 ${PORT} 被其他程序占用，占用者："
    lsof -nP -iTCP:${PORT} -sTCP:LISTEN
    exit 1
  fi
}

handle_busy

if ! command -v python3 >/dev/null 2>&1; then
  echo "没有找到 Python 3，请先安装 Python 3 后重试。"
  exit 1
fi

if ! python3 ensure_opencode.py; then
  echo "opencode 后台服务没有就绪，已停止启动。"
  exit 1
fi

if [ ! -x "${VENV}/bin/python" ]; then
  echo "正在创建虚拟环境。"
  python3 -m venv "${VENV}"
fi

REQ_HASH="$(shasum -a 256 requirements.txt | awk '{print $1}')"
STAMP_HASH=""
if [ -f "${STAMP}" ]; then
  STAMP_HASH="$(cat "${STAMP}")"
fi
if [ "${STAMP_HASH}" != "${REQ_HASH}" ]; then
  echo "正在安装后端依赖。"
  if ! "${VENV}/bin/python" -m pip install -q -r requirements.txt; then
    echo "默认源安装失败，改用清华镜像重试。"
    "${VENV}/bin/python" -m pip install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  fi
  printf '%s' "${REQ_HASH}" >"${STAMP}"
fi

if [ ! -d web/node_modules ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "没有找到 npm，请先安装 Node.js 后重试。"
    exit 1
  fi
  echo "正在安装前端依赖。"
  (cd web && npm install --no-audit --no-fund)
fi

if [ ! -f dist/index.html ] || [ -n "$(find web/src web/index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "正在构建前端。"
  (cd web && npm run build)
fi

handle_busy

echo "opencode 管理界面准备就绪：${URL}"
echo "终端标题为 opencode_manager:${PORT}，服务就绪后会打开页面，按 Ctrl+C 停止。"
(
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "${URL}" 2>/dev/null; then
      open_page
      exit 0
    fi
    sleep 0.5
  done
  echo "服务在 30 秒内没有就绪，未自动打开页面。" >&2
) &

exec "${VENV}/bin/python" -m uvicorn server:app --host 127.0.0.1 --port "${PORT}"
