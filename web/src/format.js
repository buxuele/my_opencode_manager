export function basename(path) {
  if (!path) return ''
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function parentPath(path) {
  if (!path) return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index <= 0) return trimmed
  return trimmed.slice(0, index)
}

export function formatDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatClock(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function relativeTime(ms, current) {
  if (!ms) return ''
  const now = current || Date.now()
  const diff = now - ms
  if (diff < 0) return '刚刚'
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function dayBucket(ms) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  if (ms >= startOfToday) return '今天'
  if (ms >= startOfToday - day) return '昨天'
  if (ms >= startOfToday - 7 * day) return '近 7 天'
  if (ms >= startOfToday - 30 * day) return '近 30 天'
  return '更早'
}

export function modelLabel(model) {
  if (!model) return '未记录模型'
  const id = model.id || model.modelID || ''
  const provider = model.providerID ? `${model.providerID} / ` : ''
  const variant = model.variant ? ` · ${model.variant}` : ''
  return `${provider}${id}${variant}`
}

export function outcomeBadge(value) {
  if (value === 'failed') return { label: '失败', className: 'failed' }
  if (value === 'interrupted') return { label: '已中断', className: 'interrupted' }
  return { label: '已完成', className: '' }
}

export function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) {
    return [hours ? `${hours} 小时` : '', minutes ? `${minutes} 分` : '', rest ? `${rest} 秒` : '']
      .filter(Boolean)
      .join(' ')
  }
  if (minutes > 0) {
    return [minutes ? `${minutes} 分` : '', rest ? `${rest} 秒` : ''].filter(Boolean).join(' ')
  }
  return `${rest} 秒`
}

export function duration(start, end) {
  if (!start || !end) return ''
  return formatElapsed(Math.round((end - start) / 1000))
}

export function shortPath(path) {
  if (!path) return ''
  const mac = path.match(/^\/Users\/[^/]+(\/.*)?$/)
  if (mac) return `~${mac[1] || ''}`
  const win = path.match(/^[A-Za-z]:\\Users\\[^\\]+(\\[^\\]+.*)?$/)
  if (win) return `~${win[1] || ''}`
  return path
}
