@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
if not defined PORT set "PORT=7860"
set "URL=http://127.0.0.1:%PORT%/"
set "VENV=.venv"
set "STAMP=%VENV%\.requirements.sha"
set "PSModulePath=%SystemRoot%\system32\WindowsPowerShell\v1.0\Modules"
title opencode_manager:%PORT%

where python >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Python，请先安装 Python 3 后重试。
  exit /b 1
)

python ensure_opencode.py
if errorlevel 1 (
  echo opencode 后台服务没有就绪，已停止启动。
  exit /b 1
)

call :detect
if "%DETECTED%"=="0" goto reuse
if "%DETECTED%"=="2" goto busy

if not exist "%VENV%\Scripts\python.exe" (
  echo 正在创建虚拟环境。
  python -m venv "%VENV%"
  if errorlevel 1 (
    echo 创建虚拟环境失败，请检查 Python 安装。
    exit /b 1
  )
)

for /f "usebackq delims=" %%H in (`%VENV%\Scripts\python.exe -c "import hashlib,pathlib;print(hashlib.sha256(pathlib.Path('requirements.txt').read_bytes()).hexdigest())"`) do set "REQ_HASH=%%H"
set "STAMP_HASH="
if exist "%STAMP%" set /p STAMP_HASH=<"%STAMP%"
if /i not "%STAMP_HASH%"=="%REQ_HASH%" (
  echo 正在安装后端依赖。
  "%VENV%\Scripts\python.exe" -m pip install -q -r requirements.txt
  if errorlevel 1 (
    echo 默认源安装失败，改用清华镜像重试。
    "%VENV%\Scripts\python.exe" -m pip install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 exit /b 1
  )
  >"%STAMP%" echo %REQ_HASH%
)

if not exist "web\node_modules" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo 没有找到 npm，请先安装 Node.js 后重试。
    exit /b 1
  )
  echo 正在安装前端依赖。
  pushd web
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

set "NEED_BUILD=0"
for /f "usebackq delims=" %%N in (`%VENV%\Scripts\python.exe -c "import pathlib,sys; d=pathlib.Path('dist/index.html'); src=[pathlib.Path('web/index.html')]+[p for p in pathlib.Path('web/src').rglob('*') if p.is_file()]; sys.stdout.write('1' if (not d.exists() or any(p.stat().st_mtime > d.stat().st_mtime for p in src)) else '0')"`) do set "NEED_BUILD=%%N"
if "%NEED_BUILD%"=="1" (
  echo 正在构建前端。
  pushd web
  call npm run build
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

call :detect
if "%DETECTED%"=="0" goto reuse
if "%DETECTED%"=="2" goto busy

echo opencode 管理界面准备就绪：%URL%
echo 终端标题为 opencode_manager:%PORT%，服务就绪后自动打开页面，按 Ctrl+C 停止。
start "" /b powershell -NoProfile -Command "$u='%URL%'; for($i=0;$i -lt 60;$i++){ try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null; if (-not $env:OCM_NO_OPEN) { Start-Process $u }; exit } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"

"%VENV%\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port %PORT% & set "SERVER_RC=!ERRORLEVEL!" & call :ignore_interrupt
echo 服务已停止。
exit /b !SERVER_RC!

:ignore_interrupt
exit /b 0
goto :eof

:reuse
echo opencode 管理界面已经在运行：%URL%
echo 已为你准备好页面，这个终端可以直接关闭。
if not defined OCM_NO_OPEN start "" "%URL%"
exit /b 0

:busy
echo 端口 %PORT% 被其他程序占用，已停止启动。
echo   !FOUND_CMD!
exit /b 1

:detect
set "DETECTED=1"
set "FOUND_PID="
set "FOUND_CMD="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /c:":%PORT%" ^| findstr /c:"LISTENING"') do if not defined FOUND_PID set "FOUND_PID=%%P"
if not defined FOUND_PID exit /b 0
for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=%FOUND_PID%').CommandLine"`) do set "FOUND_CMD=%%C"
echo !FOUND_CMD! | findstr /i /c:"uvicorn" /c:"server:app" >nul
if errorlevel 1 (
  set "DETECTED=2"
) else (
  set "DETECTED=0"
)
exit /b 0
