import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


class PlatformError(RuntimeError):
    pass


def _applescript_string(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def _powershell_string(value):
    return str(value).replace("'", "''")


class BaseOps:
    name = "linux"
    label = "Linux"
    script_name = "just_run.sh"
    folder_label = "文件管理器"
    shortcut = "Ctrl K"

    def info(self):
        return {
            "name": self.name,
            "label": self.label,
            "script": self.script_name,
            "folderLabel": self.folder_label,
            "shortcut": self.shortcut,
        }

    def pick_folder(self, initial=None):
        start = Path(initial).expanduser() if initial else Path.home()
        if not start.is_dir():
            start = Path.home()
        zenity = shutil.which("zenity")
        if zenity:
            command = [
                zenity,
                "--file-selection",
                "--directory",
                "--title=选择项目目录",
                f"--filename={start}/",
            ]
        else:
            kdialog = shutil.which("kdialog")
            if not kdialog:
                raise PlatformError("当前系统没有可用的目录选择对话框")
            command = [kdialog, "--getexistingdirectory", str(start), "--title", "选择项目目录"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            return {"path": None, "cancelled": True}
        selected = result.stdout.strip()
        if not selected:
            return {"path": None, "cancelled": True}
        return {"path": selected, "cancelled": False}

    def open_terminal(self, directory):
        raise PlatformError("当前系统没有配置终端启动方式")

    def reveal(self, directory, target="folder", select=False):
        if target == "terminal":
            self.open_terminal(directory)
            return {"ok": True, "directory": str(directory)}
        opener = shutil.which("xdg-open")
        if not opener:
            raise PlatformError("没有找到 xdg-open，无法打开文件管理器")
        subprocess.Popen([opener, str(directory)])
        return {"ok": True, "directory": str(directory), "selected": None}

    def reveal_project(self, directory):
        return self.reveal(directory, target="folder", select=False)

    def launch_project(self, directory):
        command = f"cd {shlex.quote(str(directory))} && ./{self.script_name}"
        terminal = shutil.which("x-terminal-emulator")
        if not terminal:
            raise PlatformError("没有找到可用终端，无法运行项目脚本")
        subprocess.Popen([terminal, "-e", "bash", "-lc", command], cwd=str(directory))
        title = f"{directory.name} · {self.script_name}"
        return {"ok": True, "directory": str(directory), "title": title}


class WindowsOps(BaseOps):
    name = "windows"
    label = "Windows"
    script_name = "just_run.bat"
    folder_label = "资源管理器"
    shortcut = "Ctrl K"

    def folder_dialog_script(self, initial, output):
        start = Path(initial).expanduser() if initial else Path.home()
        if not start.is_dir():
            start = Path.home()
        return (
            "Add-Type -AssemblyName System.Windows.Forms\n"
            "Add-Type -AssemblyName System.Drawing\n"
            "$owner = New-Object System.Windows.Forms.Form\n"
            "$owner.TopMost = $true\n"
            "$owner.ShowInTaskbar = $false\n"
            "$owner.FormBorderStyle = 'None'\n"
            "$owner.Opacity = 0\n"
            "$owner.StartPosition = 'CenterScreen'\n"
            "$owner.Size = New-Object System.Drawing.Size(1, 1)\n"
            "$owner.Show()\n"
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog\n"
            "$dialog.Description = '选择项目目录'\n"
            "$dialog.ShowNewFolderButton = $true\n"
            f"$dialog.SelectedPath = '{_powershell_string(start)}'\n"
            "$result = $dialog.ShowDialog($owner)\n"
            "$owner.Close()\n"
            "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {\n"
            f"  Set-Content -LiteralPath '{_powershell_string(output)}' -Value $dialog.SelectedPath -Encoding UTF8\n"
            "  exit 0\n"
            "}\n"
            "exit 2\n"
        )

    def pick_folder(self, initial=None):
        powershell = shutil.which("powershell.exe") or shutil.which("powershell")
        if not powershell:
            raise PlatformError("没有找到 PowerShell，无法打开目录选择对话框")
        handle = tempfile.NamedTemporaryFile(delete=False, suffix=".txt")
        handle.close()
        output = Path(handle.name)
        script = self.folder_dialog_script(initial, output)
        env = os.environ.copy()
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        env["PSModulePath"] = str(
            Path(system_root) / "system32" / "WindowsPowerShell" / "v1.0" / "Modules"
        )
        try:
            result = subprocess.run(
                [
                    powershell,
                    "-NoProfile",
                    "-STA",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    script,
                ],
                capture_output=True,
                text=True,
                timeout=600,
                env=env,
            )
            if result.returncode == 2:
                return {"path": None, "cancelled": True}
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or "").strip()
                raise PlatformError(f"打开目录选择对话框失败：{detail or '未知错误'}")
            selected = output.read_text(encoding="utf-8-sig").strip()
            if not selected:
                return {"path": None, "cancelled": True}
            return {"path": selected, "cancelled": False}
        except (OSError, subprocess.SubprocessError) as exc:
            raise PlatformError(f"打开目录选择对话框失败：{exc}")
        finally:
            try:
                output.unlink()
            except OSError:
                pass

    def open_terminal(self, directory):
        wt = shutil.which("wt.exe") or shutil.which("wt")
        if wt:
            subprocess.Popen([wt, "-d", str(directory)])
            return
        subprocess.Popen(
            ["cmd.exe", "/c", "start", "", "cmd.exe", "/k", f"cd /d {directory}"],
            cwd=str(directory),
        )

    def reveal(self, directory, target="folder", select=False):
        if target == "terminal":
            self.open_terminal(directory)
            return {"ok": True, "directory": str(directory)}
        if select:
            subprocess.Popen(["explorer.exe", f"/select,{directory}"])
            return {
                "ok": True,
                "directory": str(directory.parent),
                "selected": str(directory),
            }
        os.startfile(str(directory))
        return {"ok": True, "directory": str(directory), "selected": None}

    def launch_project(self, directory):
        title = f"{directory.name} · just_run.bat"
        subprocess.Popen(
            ["cmd.exe", "/c", "start", title, "cmd.exe", "/k", "just_run.bat"],
            cwd=str(directory),
        )
        return {"ok": True, "directory": str(directory), "title": title}


class MacOps(BaseOps):
    name = "macos"
    label = "macOS"
    script_name = "just_run.sh"
    folder_label = "访达"
    shortcut = "⌘K"

    def pick_folder(self, initial=None):
        start = Path(initial).expanduser() if initial else None
        if start and start.is_dir():
            location = f'default location (POSIX file "{_applescript_string(start)}" as alias)'
        else:
            location = "default location (path to home folder)"
        script = f'POSIX path of (choose folder with prompt "选择项目目录" {location})'
        result = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, timeout=600
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            if "User canceled" in detail or "-128" in detail:
                return {"path": None, "cancelled": True}
            raise PlatformError(f"打开目录选择对话框失败：{detail or '未知错误'}")
        selected = result.stdout.strip().rstrip("/") or "/"
        return {"path": selected, "cancelled": False}

    def open_terminal(self, directory):
        subprocess.Popen(["open", "-a", "Terminal", str(directory)])

    def _run_applescript(self, script, failure):
        result = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise PlatformError(f"{failure}：{detail or '未知错误'}")

    def reveal(self, directory, target="folder", select=False):
        if target == "terminal":
            self.open_terminal(directory)
            return {"ok": True, "directory": str(directory)}
        escaped = _applescript_string(directory)
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
        script = 'tell application "Finder"\n' f"{body}" "end tell"
        self._run_applescript(script, "打开访达失败")
        opened = str(directory.parent) if select else str(directory)
        return {
            "ok": True,
            "directory": opened,
            "selected": str(directory) if select else None,
        }

    def reveal_project(self, directory):
        return self.reveal(directory, target="folder", select=True)

    def launch_project(self, directory):
        script_path = directory / self.script_name
        if os.access(script_path, os.X_OK):
            command = f"cd {shlex.quote(str(directory))} && ./{self.script_name}"
        else:
            command = f"cd {shlex.quote(str(directory))} && bash {self.script_name}"
        title = f"{directory.name} · {self.script_name}"
        applescript = (
            'tell application "Terminal"\n'
            "activate\n"
            f'do script "{_applescript_string(command)}"\n'
            f'set custom title of selected tab of front window to "{_applescript_string(title)}"\n'
            "set title displays custom title of selected tab of front window to true\n"
            "set frontmost of front window to true\n"
            "end tell"
        )
        self._run_applescript(applescript, "打开终端失败")
        return {"ok": True, "directory": str(directory), "title": title}


def current_ops():
    if os.name == "nt":
        return WindowsOps()
    if sys.platform == "darwin":
        return MacOps()
    return BaseOps()
