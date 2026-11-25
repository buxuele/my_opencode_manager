const FALLBACK = {
  name: 'windows',
  label: 'Windows',
  script: 'just_run.bat',
  folderLabel: '资源管理器',
  shortcut: 'Ctrl K',
}

export function detectPlatform() {
  if (typeof navigator === 'undefined') return FALLBACK
  const hint = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`
  if (/mac/i.test(hint)) {
    return {
      name: 'macos',
      label: 'macOS',
      script: 'just_run.sh',
      folderLabel: '访达',
      shortcut: '⌘K',
    }
  }
  if (/linux/i.test(hint)) {
    return {
      name: 'linux',
      label: 'Linux',
      script: 'just_run.sh',
      folderLabel: '文件管理器',
      shortcut: 'Ctrl K',
    }
  }
  return FALLBACK
}

export function shortcutLabel(platform) {
  return platform?.shortcut || FALLBACK.shortcut
}
