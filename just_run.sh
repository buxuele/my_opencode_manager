#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8860}"
URL="http://127.0.0.1:${PORT}/"
VENV=".venv"
STAMP="${VENV}/.requirements.sha"
MODE="run"
FOUND_PID=""

case "${1:-}" in
  --status) MODE="status" ;;
  --stop) MODE="stop" ;;
  --help | -h)
    echo "用法："
    echo "  ./just_run.sh           启动服务并自动打开页面"
    echo "  ./just_run.sh --status  查看是否在运行"
    echo "  ./just_run.sh --stop    停止本项目实例"
    exit 0
    ;;
  "") ;;
  *)
    echo "未知参数：$1"
    echo "可用参数：--status  --stop  --help"
    exit 2
    ;;
esac

detect_instance() {
  local pid cwd cmd
  pid="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [ -z "${pid}" ]; then
    FOUND_PID=""
    return 1
  fi
  cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  FOUND_PID="${pid}"
  if [ "${cwd}" = "$(pwd -P)" ] && [[ "${cmd}" == *"uvicorn server:app"* ]]; then
    return 0
  fi
  return 2
}

if [ "${MODE}" = "status" ]; then
  DETECTED=0
  detect_instance || DETECTED=$?
  if [ "${DETECTED}" -eq 0 ]; then
    echo "opencode 正在运行：${URL}"
    echo "进程号：${FOUND_PID}"
  elif [ "${DETECTED}" -eq 2 ]; then
    echo "端口 ${PORT} 被其他程序占用，占用者："
    lsof -nP -iTCP:${PORT} -sTCP:LISTEN
  else
    echo "opencode 未运行，端口 ${PORT} 空闲。"
  fi
  exit 0
fi

if [ "${MODE}" = "stop" ]; then
  DETECTED=0
  detect_instance || DETECTED=$?
  if [ "${DETECTED}" -eq 0 ]; then
    echo "停止 opencode：进程 ${FOUND_PID}，端口 ${PORT}"
    kill -INT "${FOUND_PID}" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "${FOUND_PID}" 2>/dev/null || { echo "已停止。"; exit 0; }
      sleep 0.5
    done
    kill -TERM "${FOUND_PID}" 2>/dev/null || true
    sleep 1
    if kill -0 "${FOUND_PID}" 2>/dev/null; then
      kill -9 "${FOUND_PID}" 2>/dev/null || true
      echo "已强制停止。"
    else
      echo "已停止。"
    fi
  elif [ "${DETECTED}" -eq 2 ]; then
    echo "端口 ${PORT} 被其他程序占用，未停止任何进程："
    lsof -nP -iTCP:${PORT} -sTCP:LISTEN
  else
    echo "opencode 未运行。"
  fi
  exit 0
fi

printf '\033]0;opencode_manager:%s\007' "${PORT}"

DETECTED=0
detect_instance || DETECTED=$?
if [ "${DETECTED}" -eq 0 ]; then
  echo "opencode 已经在运行：${URL}"
  echo "已为你打开页面，这个终端可以直接关闭。"
  open "${URL}" || echo "自动打开失败，请手动访问 ${URL}"
  exit 0
fi
if [ "${DETECTED}" -eq 2 ]; then
  echo "端口 ${PORT} 被其他程序占用，占用者："
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN
  exit 1
fi

if [ ! -x "${VENV}/bin/python" ]; then
  echo "创建虚拟环境…"
  python3 -m venv "${VENV}"
fi

REQ_HASH=$(shasum requirements.txt | awk '{print $1}')
if [ ! -f "${STAMP}" ] || [ "$(cat "${STAMP}")" != "${REQ_HASH}" ]; then
  echo "安装后端依赖…"
  if ! "${VENV}/bin/pip" install -q -r requirements.txt; then
    echo "默认源安装失败，改用清华镜像重试…"
    "${VENV}/bin/pip" install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  fi
  echo "${REQ_HASH}" > "${STAMP}"
fi

if [ ! -d web/node_modules ]; then
  echo "安装前端依赖…"
  (cd web && npm install --no-audit --no-fund)
fi

if [ ! -f dist/index.html ] || [ -n "$(find web/src web/index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "构建前端…"
  (cd web && npm run build)
fi

DETECTED=0
detect_instance || DETECTED=$?
if [ "${DETECTED}" -eq 0 ]; then
  echo "opencode 已经在运行：${URL}"
  echo "已为你打开页面，这个终端可以直接关闭。"
  open "${URL}" || echo "自动打开失败，请手动访问 ${URL}"
  exit 0
fi
if [ "${DETECTED}" -eq 2 ]; then
  echo "端口 ${PORT} 被其他程序占用，占用者："
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN
  exit 1
fi

echo "opencode 已启动：${URL}"
echo "终端标题：opencode_manager:${PORT}，服务就绪后会自动打开页面。"
echo "停止服务：./just_run.sh --stop"

(
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "${URL}" 2>/dev/null; then
      open "${URL}" || echo "自动打开失败，请手动访问 ${URL}" >&2
      exit 0
    fi
    sleep 0.5
  done
  echo "服务在 30 秒内没有就绪，未自动打开页面。" >&2
) &

exec "${VENV}/bin/python" -m uvicorn server:app --host 127.0.0.1 --port "${PORT}"
