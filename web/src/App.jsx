import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import Sidebar from './Sidebar'
import Overview from './Overview'
import SessionView from './SessionView'
import ModelPicker from './ModelPicker'
import NewSessionModal from './NewSessionModal'
import Modal from './Modal'
import Toast from './Toast'
import { Icon, Logo } from './Icons'
import { basename, parentPath } from './format'
import { detectPlatform } from './platform'
import { playCompletionSound, unlockAudio } from './sound'

const autoAllowedPermissions = new Set()

async function autoAllowPermissions(sessionId, permissions) {
  for (const request of permissions || []) {
    if (!request?.id || autoAllowedPermissions.has(request.id)) continue
    autoAllowedPermissions.add(request.id)
    try {
      await api(`/sessions/${sessionId}/permissions/${request.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'always' }),
      })
    } catch {
      autoAllowedPermissions.delete(request.id)
    }
  }
}

const EVENT_TYPES = [
  'session.created',
  'session.deleted',
  'session.renamed',
  'session.inbox.enqueued',
  'session.inbox.delivered',
  'session.inbox.cancelled',
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
  'session.model.selected',
  'session.agent.selected',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.revert.staged',
  'session.revert.cleared',
  'session.revert.committed',
  'permission.asked',
  'permission.replied',
  'form.created',
  'form.replied',
  'form.cancelled',
  'session.step.ended',
  'session.step.streamed',
  'session.text.ended',
  'project.updated',
]

function normalizeSessions(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data || []
  return list.map((item) => ({ ...item }))
}

function normalizeQueued(item) {
  return {
    id: item.id,
    time: item.time || { created: Date.now() },
    text: item.payload?.text || '',
    files: item.payload?.files || [],
    type: 'user',
    delivery: item.delivery,
    queued: item.delivery === 'queue',
    steering: item.delivery === 'steer',
  }
}

function messageSignature(message) {
  if (!message) return ''
  const parts = Array.isArray(message.content) ? message.content : []
  const tail = parts[parts.length - 1]
  return [
    message.id,
    message.time?.created || 0,
    message.time?.completed || 0,
    message.error?.message || '',
    parts.length,
    tail?.type || '',
    (tail?.text || '').length,
    tail?.state?.status || '',
    (tail?.state?.output || '').length,
  ].join('|')
}

function mergeMessage(known, item) {
  const previous = known.get(item.id)
  if (previous?.steering && !item.steering) {
    known.set(item.id, item)
    return
  }
  if (previous && messageSignature(previous) === messageSignature(item)) return
  known.set(item.id, item)
}

const INITIAL_MESSAGE_LIMIT = 12
const FILL_MESSAGE_LIMIT = 18
const LOAD_OLDER_LIMIT = 30
const RECENT_MESSAGE_LIMIT = 80
const TERMINAL_GRACE = 2500

async function loadRecentMessages(sessionId, limit = RECENT_MESSAGE_LIMIT) {
  const page = await api(`/sessions/${sessionId}/messages?limit=${limit}&order=desc`)
  return {
    messages: (page?.data || []).slice().reverse(),
    olderCursor: page?.cursor?.next || null,
  }
}

function readRoute() {
  const raw = (window.location.hash || '').replace(/^#/, '')
  if (raw.startsWith('/session/')) {
    const id = decodeURIComponent(raw.slice('/session/'.length))
    if (id) return { kind: 'session', id }
  }
  if (raw.startsWith('/project/')) {
    const id = decodeURIComponent(raw.slice('/project/'.length))
    if (id) return { kind: 'project', id }
  }
  return { kind: 'overview' }
}

function routeHash(view, selectedProject) {
  if (view.kind === 'session') return `#/session/${view.id}`
  if (selectedProject !== 'all') return `#/project/${selectedProject}`
  return '#/'
}

const DEFAULT_SETTINGS = { completionSound: true, background: '#f2f2f2' }

const LEGACY_BACKGROUNDS = {
  light: '#fafafa',
  mid: '#f2f2f2',
  deep: '#e5e5e5',
}

const GRAY_MIN = 90
const GRAY_MAX = 100

function normalizeBackground(value) {
  const legacy = LEGACY_BACKGROUNDS[value]
  if (legacy) return legacy
  if (!/^#[0-9a-f]{6}$/i.test(value || '')) return DEFAULT_SETTINGS.background
  const gray = parseInt(value.slice(1), 16)
  const channel = Math.max(
    230,
    Math.min(255, Math.round((((gray >> 16) & 255) + ((gray >> 8) & 255) + (gray & 255)) / 3)),
  )
  const hex = channel.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

function backgroundPercent(value) {
  const channel = parseInt(normalizeBackground(value).slice(1, 3), 16)
  return Math.round((channel / 255) * 100)
}

function backgroundFromPercent(percent) {
  const level = Math.max(GRAY_MIN, Math.min(GRAY_MAX, Math.round(Number(percent) || 95)))
  const channel = Math.round((level / 100) * 255)
  const hex = channel.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

function shadeColor(hex, ratio) {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift) => {
    const base = (value >> shift) & 255
    return Math.max(0, Math.min(255, Math.round(base * (1 + ratio))))
  }
  return `#${[16, 8, 0]
    .map((shift) => channel(shift).toString(16).padStart(2, '0'))
    .join('')}`
}

const PINNED_KEY = 'ocm_pinned_projects'
const SETTINGS_KEY = 'ocm_settings'

function loadPinnedProjects() {
  try {
    const raw = window.localStorage.getItem(PINNED_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function cachePinnedProjects(list) {
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(list))
  } catch {
    /* 浏览器禁用存储时只在本次会话生效 */
  }
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const stored = raw ? JSON.parse(raw) : {}
    return { ...DEFAULT_SETTINGS, ...stored, background: normalizeBackground(stored.background) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* 浏览器禁用存储时只在本次会话生效 */
  }
}

export default function App() {
  const initialRoute = useMemo(() => readRoute(), [])
  const [projects, setProjects] = useState([])
  const [sessions, setSessions] = useState([])
  const [active, setActive] = useState({})
  const [completed, setCompleted] = useState({})
  const [pending, setPending] = useState({ permissions: [], forms: [] })
  const [attention, setAttention] = useState({})
  const [service, setService] = useState(null)
  const [liveConnected, setLiveConnected] = useState(false)
  const [bootLoading, setBootLoading] = useState(true)
  const [bootError, setBootError] = useState('')

  const [selectedProject, setSelectedProject] = useState(
    initialRoute.kind === 'project' ? initialRoute.id : 'all',
  )
  const [view, setView] = useState(
    initialRoute.kind === 'session'
      ? { kind: 'session', id: initialRoute.id }
      : { kind: 'overview' },
  )
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(initialRoute.kind === 'session')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [settings, setSettings] = useState(loadSettings)
  const [pinned, setPinned] = useState(loadPinnedProjects)
  const [platform, setPlatform] = useState(detectPlatform)

  const viewRef = useRef(view)
  const activeRef = useRef(active)
  const sessionRef = useRef(session)
  const sessionsRef = useRef(sessions)
  const settingsRef = useRef(settings)
  const messageToken = useRef(0)
  const toastTimer = useRef(null)
  const preferencesTimer = useRef(null)
  const pendingPreferences = useRef({})
  const preferencesReady = useRef(false)
  const creatingRef = useRef(false)
  const bootRoute = useRef(initialRoute.kind === 'session' ? initialRoute : null)
  const hashInitialized = useRef(false)
  const idleSeen = useRef(new Map())
  const terminalTimers = useRef(new Map())

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    const background = normalizeBackground(settings.background)
    document.documentElement.style.setProperty('--bg', background)
    document.documentElement.style.setProperty('--sidebar-bg', shadeColor(background, -0.2))
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', background)
  }, [settings.background])

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const seen = idleSeen.current
    const timers = terminalTimers.current
    const clear = []
    const schedule = []

    sessions.forEach((item) => {
      const id = item?.id
      if (!id) return
      const idle = Number(item.time?.idle) || 0
      const outcome = item.outcome || ''
      const previous = seen.get(id)
      if (active[id]) {
        seen.set(id, idle)
        const timer = timers.get(id)
        if (timer) {
          clearTimeout(timer)
          timers.delete(id)
        }
        clear.push(id)
        return
      }
      if (!idle || !outcome) return
      seen.set(id, idle)
      if (previous === undefined || idle <= previous) return
      schedule.push({ id, idle, outcome })
    })

    if (clear.length > 0) {
      setCompleted((prev) => {
        let changed = false
        const next = { ...prev }
        clear.forEach((id) => {
          if (id in next) {
            delete next[id]
            changed = true
          }
        })
        return changed ? next : prev
      })
    }

    schedule.forEach(({ id, idle, outcome }) => {
      const existing = timers.get(id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        timers.delete(id)
        if (activeRef.current[id]) return
        const current = sessionsRef.current.find((entry) => entry.id === id)
        if (!current) return
        if ((Number(current.time?.idle) || 0) !== idle) return
        if ((current.outcome || '') !== outcome) return
        if (outcome === 'succeeded' && settingsRef.current.completionSound) {
          playCompletionSound()
        }
        const viewing = viewRef.current.kind === 'session' && viewRef.current.id === id
        if (viewing) return
        const badge = outcome === 'failed' ? 'failed' : outcome === 'interrupted' ? 'interrupted' : 'done'
        setCompleted((prev) => ({ ...prev, [id]: badge }))
      }, TERMINAL_GRACE)
      timers.set(id, timer)
    })
  }, [sessions, active])

  useEffect(
    () => () => {
      terminalTimers.current.forEach((timer) => clearTimeout(timer))
      terminalTimers.current.clear()
    },
    [],
  )

  const activeKey = useMemo(() => Object.keys(active || {}).sort().join(','), [active])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (bootLoading || projects.length === 0) return
    if (selectedProject !== 'all' && !projects.some((item) => item.id === selectedProject)) {
      setSelectedProject('all')
    }
  }, [bootLoading, projects, selectedProject])

  useEffect(() => {
    const handler = (event) => {
      if (event.key !== 'Escape') return
      if (modal) return
      if (sidebarOpen) {
        setSidebarOpen(false)
        return
      }
      if (viewRef.current.kind === 'session') closeSession()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modal, sidebarOpen])

  const notify = useCallback((text, kind = 'error') => {
    setToast({ text, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4600)
  }, [])

  const flushPreferences = useCallback(() => {
    if (preferencesTimer.current) {
      clearTimeout(preferencesTimer.current)
      preferencesTimer.current = null
    }
    const pending = pendingPreferences.current
    pendingPreferences.current = {}
    if (Object.keys(pending).length === 0) return
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending),
      keepalive: true,
    }).catch(() => {
      /* 浏览器缓存已保存，下次操作会再同步到本机偏好文件 */
    })
  }, [])

  const queuePreferences = useCallback(
    (patch) => {
      if (!preferencesReady.current) return
      pendingPreferences.current = { ...pendingPreferences.current, ...patch }
      if (preferencesTimer.current) clearTimeout(preferencesTimer.current)
      preferencesTimer.current = setTimeout(flushPreferences, 250)
    },
    [flushPreferences],
  )

  useEffect(() => {
    window.addEventListener('beforeunload', flushPreferences)
    return () => {
      window.removeEventListener('beforeunload', flushPreferences)
      flushPreferences()
    }
  }, [flushPreferences])

  const applySettings = (next) => {
    setSettings(next)
    saveSettings(next)
    queuePreferences({ settings: next })
  }

  const toggleCompletionSound = () => {
    const next = { ...settings, completionSound: !settings.completionSound }
    applySettings(next)
    if (next.completionSound) playCompletionSound()
  }

  const chooseBackground = (percent) => {
    const next = { ...settings, background: backgroundFromPercent(percent) }
    applySettings(next)
  }

  const togglePinProject = (project) => {
    if (!project?.id) return
    const next = pinned.includes(project.id)
      ? pinned.filter((id) => id !== project.id)
      : [...pinned, project.id]
    setPinned(next)
    cachePinnedProjects(next)
    queuePreferences({ pinnedProjects: next })
  }

  const loadSessions = useCallback(async () => {
    const activeMap = await api('/sessions/active')
    const collected = []
    let cursor = null
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: '500' })
      if (cursor) query.set('cursor', cursor)
      const result = await api(`/sessions?${query.toString()}`)
      const batch = Array.isArray(result) ? result : result?.data || []
      collected.push(...batch)
      const next = Array.isArray(result) ? null : result?.cursor?.next || null
      if (!next || batch.length === 0) break
      cursor = next
    }
    setSessions(normalizeSessions(collected))
    setActive((activeMap && activeMap.data) || {})
  }, [])

  const loadPending = useCallback(async (sessionId) => {
    const [permissionResult, formResult] = await Promise.all([
      api(`/sessions/${sessionId}/permissions`).catch(() => ({ data: [] })),
      api(`/sessions/${sessionId}/forms`).catch(() => ({ data: [] })),
    ])
    setPending({
      permissions: permissionResult?.data || [],
      forms: formResult?.data || [],
    })
    void autoAllowPermissions(sessionId, permissionResult?.data || [])
  }, [])

  const loadAttention = useCallback(async () => {
    const ids = Array.from(
      new Set([
        ...Object.keys(activeRef.current || {}),
        ...sessionsRef.current
          .filter((item) => (item.time?.updated || 0) > Date.now() - 30 * 60 * 1000)
          .slice(0, 5)
          .map((item) => item.id),
      ]),
    )
    if (ids.length === 0) {
      setAttention({})
      return
    }
    const entries = await Promise.all(
      ids.map(async (id) => {
        const [permissionResult, formResult] = await Promise.all([
          api(`/sessions/${id}/permissions`).catch(() => ({ data: [] })),
          api(`/sessions/${id}/forms`).catch(() => ({ data: [] })),
        ])
        const count = (permissionResult?.data?.length || 0) + (formResult?.data?.length || 0)
        void autoAllowPermissions(id, permissionResult?.data || [])
        return [id, count]
      }),
    )
    setAttention(Object.fromEntries(entries.filter(([, count]) => count > 0)))
  }, [])

  useEffect(() => {
    void loadAttention()
    if (sessions.length === 0) return
    const timer = setInterval(() => void loadAttention(), 30000)
    return () => clearInterval(timer)
  }, [activeKey, sessions.length, loadAttention])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadSessions().catch(() => {})
    }, 60000)
    const onFocus = () => void loadSessions().catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadSessions])

  const fillRecent = useCallback(async (sessionId, cursor, token) => {
    try {
      const page = await api(
        `/sessions/${sessionId}/messages?limit=${FILL_MESSAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`,
      )
      if (token !== messageToken.current) return
      const older = (page?.data || []).slice().reverse()
      if (older.length === 0) return
      setSession((prev) => {
        if (!prev || prev.info?.id !== sessionId) return prev
        const ids = new Set(prev.messages.map((item) => item.id))
        const merged = older.filter((item) => !ids.has(item.id)).concat(prev.messages)
        return { ...prev, messages: merged, olderCursor: page?.cursor?.next || prev.olderCursor }
      })
    } catch {
      /* 补页失败时保留首屏内容 */
    }
  }, [])

  const loadSession = useCallback(async (sessionId, options = {}) => {
    const silent = Boolean(options.silent)
    const token = messageToken.current + 1
    messageToken.current = token
    if (!silent) setSessionLoading(true)
    try {
      const [detail, recent] = await Promise.all([
        api(`/sessions/${sessionId}`),
        loadRecentMessages(sessionId, INITIAL_MESSAGE_LIMIT),
      ])
      if (token !== messageToken.current) return
      setSession({
        info: detail?.data || detail,
        messages: recent.messages,
        olderCursor: recent.olderCursor,
      })
      void loadPending(sessionId)
      if (recent.olderCursor) void fillRecent(sessionId, recent.olderCursor, token)
    } catch (error) {
      if (token !== messageToken.current) return
      if (!silent) notify(error.message)
    } finally {
      if (token === messageToken.current && !silent) setSessionLoading(false)
    }
  }, [fillRecent, loadPending, notify])

  const syncSession = useCallback(async (sessionId, options = {}) => {
    const token = messageToken.current
    const current = sessionRef.current
    const [detail, inbox] = await Promise.all([
      api(`/sessions/${sessionId}`),
      api(`/sessions/${sessionId}/inbox`).catch(() => ({ data: [] })),
    ])
    if (token !== messageToken.current) return
    const info = detail?.data || detail
    const base = current && current.info?.id === sessionId ? current : null
    const known = new Map()
    if (base) {
      base.messages.forEach((item) => {
        if (!String(item.id).startsWith('local_')) known.set(item.id, item)
      })
    }
    const inboxItems = (inbox?.data || []).filter((item) => item.type === 'user')
    const baseIds = new Set(base ? base.messages.map((item) => item.id) : [])
    const inboxNew = inboxItems.some((item) => !baseIds.has(item.id))
    inboxItems.forEach((item) => {
      if (known.has(item.id)) return
      known.set(item.id, normalizeQueued(item))
    })
    let messages = Array.from(known.values())
    let olderCursor = base?.olderCursor || null
    const unchanged =
      !options.force &&
      base &&
      info?.time?.updated &&
      base.info?.time?.updated === info.time.updated &&
      !inboxNew
    if (!unchanged) {
      const limit = options.limit || 12
      const page = await api(`/sessions/${sessionId}/messages?limit=${limit}&order=desc`)
      if (token !== messageToken.current) return
      const incoming = (page?.data || []).slice().reverse()
      const overlap = incoming.some((item) => known.has(item.id))
      if (base && known.size > 0 && incoming.length > 0 && !overlap) {
        const recent = await loadRecentMessages(sessionId)
        if (token !== messageToken.current) return
        messages = recent.messages
        olderCursor = recent.olderCursor
      } else {
        incoming.forEach((item) => mergeMessage(known, item))
        messages = Array.from(known.values())
        if (!base) olderCursor = page?.cursor?.next || null
      }
    }
    const locals = base ? base.messages.filter((item) => String(item.id).startsWith('local_')) : []
    messages = messages.concat(locals)
    messages.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0))
    setSession({ info, messages, olderCursor })
  }, [])

  const bootstrap = useCallback(async () => {
    setBootLoading(true)
    setBootError('')
    try {
      const [health, projectList, storedPreferences, platformInfo] = await Promise.all([
        api('/health'),
        api('/projects'),
        api('/preferences').catch(() => null),
        api('/platform').catch(() => null),
      ])
      setService(health)
      setProjects(Array.isArray(projectList) ? projectList : [])
      if (platformInfo?.name) setPlatform(platformInfo)
      if (storedPreferences) {
        if (storedPreferences.initialized) {
          const merged = {
            ...DEFAULT_SETTINGS,
            ...(storedPreferences.settings || {}),
            background: normalizeBackground(storedPreferences.settings?.background),
          }
          setSettings(merged)
          saveSettings(merged)
          const pinnedList = Array.isArray(storedPreferences.pinnedProjects)
            ? storedPreferences.pinnedProjects
            : []
          setPinned(pinnedList)
          cachePinnedProjects(pinnedList)
        } else {
          api('/preferences', {
            method: 'PUT',
            body: JSON.stringify({
              settings: loadSettings(),
              pinnedProjects: loadPinnedProjects(),
            }),
          }).catch(() => {})
        }
      }
      preferencesReady.current = true
      if (!health.reachable) {
        setBootError('opencode 服务没有响应，请确认本机 opencode 正在运行')
        return
      }
      void loadSessions()
    } catch (error) {
      setBootError(error.message)
    } finally {
      setBootLoading(false)
    }
  }, [loadSessions])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const route = bootRoute.current
    if (!route) return
    bootRoute.current = null
    void loadSession(route.id)
  }, [loadSession])

  useEffect(() => {
    if (view.kind !== 'session' || session?.info?.id !== view.id) return
    const projectId = session.info.projectID
    if (projectId && selectedProject !== projectId) setSelectedProject(projectId)
  }, [view, session, selectedProject])

  const applyRoute = useCallback((route) => {
    if (route.kind === 'session') {
      const current = viewRef.current
      if (current.kind === 'session' && current.id === route.id) return
      setView({ kind: 'session', id: route.id })
      setSidebarOpen(false)
      setCompleted((prev) => {
        if (!prev[route.id]) return prev
        const next = { ...prev }
        delete next[route.id]
        return next
      })
      void loadSession(route.id)
      return
    }
    setSession(null)
    setPage(1)
    setView({ kind: 'overview' })
    setSelectedProject(route.kind === 'project' ? route.id : 'all')
  }, [loadSession])

  useEffect(() => {
    const handler = () => applyRoute(readRoute())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [applyRoute])

  useEffect(() => {
    const target = routeHash(view, selectedProject)
    if (window.location.hash === target) {
      hashInitialized.current = true
      return
    }
    if (!hashInitialized.current) {
      window.history.replaceState(null, '', target)
      hashInitialized.current = true
      return
    }
    window.location.hash = target
  }, [view, selectedProject])

  useEffect(() => {
    let sessionsTimer = null
    let messagesTimer = null
    let pendingTimer = null
    let messagesForce = false

    const scheduleSessions = (delay = 2000) => {
      if (sessionsTimer) return
      sessionsTimer = setTimeout(async () => {
        sessionsTimer = null
        try {
          await loadSessions()
        } catch {
          /* 后台刷新失败时保留现有数据 */
        }
      }, delay)
    }

    const scheduleMessages = (delay = 900, options = {}) => {
      if (options.force) messagesForce = true
      if (messagesTimer) return
      messagesTimer = setTimeout(async () => {
        messagesTimer = null
        const force = messagesForce
        messagesForce = false
        if (viewRef.current.kind !== 'session') return
        try {
          await syncSession(viewRef.current.id, force ? { force: true, limit: 6 } : {})
        } catch {
          /* 后台同步失败时保留现有数据 */
        }
      }, delay)
    }

    const schedulePending = (delay = 300) => {
      if (pendingTimer) return
      pendingTimer = setTimeout(async () => {
        pendingTimer = null
        if (viewRef.current.kind !== 'session') return
        try {
          await loadPending(viewRef.current.id)
        } catch {
          /* 读取待处理请求失败时保留现有数据 */
        }
      }, delay)
    }

    const source = new EventSource(
      `/api/events?${EVENT_TYPES.map((type) => `types=${encodeURIComponent(type)}`).join('&')}`,
    )
    source.onopen = () => setLiveConnected(true)
    source.onerror = () => setLiveConnected(false)
    source.onmessage = (event) => {
      let payload = null
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      const type = payload?.type || ''
      if (type === 'server.connected') {
        setLiveConnected(true)
        return
      }
      if (type === 'session.deleted') {
        const deletedId = payload?.data?.sessionID || payload?.data?.id
        if (deletedId && viewRef.current.kind === 'session' && viewRef.current.id === deletedId) {
          setView({ kind: 'overview' })
          setSession(null)
          notify('当前会话已被删除')
        }
        scheduleSessions(300)
        return
      }
      if (
        type === 'session.created' ||
        type === 'session.renamed' ||
        type.startsWith('project.')
      ) {
        scheduleSessions(600)
        return
      }
      if (
        type === 'session.inbox.enqueued' ||
        type === 'session.inbox.delivered' ||
        type === 'session.inbox.cancelled' ||
        type === 'session.execution.started' ||
        type === 'session.execution.succeeded' ||
        type === 'session.execution.failed' ||
        type === 'session.execution.interrupted'
      ) {
        const executed = payload?.data?.sessionID
        if (executed && type === 'session.execution.started') {
          setActive((prev) =>
            prev[executed] ? prev : { ...prev, [executed]: { type: 'running' } },
          )
        }
        if (
          executed &&
          (type === 'session.execution.succeeded' ||
            type === 'session.execution.failed' ||
            type === 'session.execution.interrupted')
        ) {
          setActive((prev) => {
            if (!prev[executed]) return prev
            const next = { ...prev }
            delete next[executed]
            return next
          })
        }
        scheduleSessions(type === 'session.execution.started' ? 800 : 500)
        scheduleMessages(500)
        return
      }
      if (type === 'session.step.ended') {
        scheduleMessages(400, { force: true })
        return
      }
      if (type === 'session.step.streamed' || type === 'session.text.ended') {
        scheduleMessages(700, { force: true })
        return
      }
      if (
        type === 'permission.asked' ||
        type === 'permission.replied' ||
        type === 'form.created' ||
        type === 'form.replied' ||
        type === 'form.cancelled'
      ) {
        schedulePending(200)
        void loadAttention()
        return
      }
      if (type === 'session.model.selected' || type === 'session.agent.selected') {
        scheduleMessages(300, { force: true })
        return
      }
      if (type.startsWith('session.compaction.')) {
        scheduleMessages(500, { force: true })
        scheduleSessions(800)
        return
      }
      if (type.startsWith('session.revert.')) {
        if (viewRef.current.kind === 'session') {
          void loadSession(viewRef.current.id, { silent: true })
        }
        scheduleSessions(600)
      }
    }
    return () => {
      source.close()
      if (sessionsTimer) clearTimeout(sessionsTimer)
      if (messagesTimer) clearTimeout(messagesTimer)
      if (pendingTimer) clearTimeout(pendingTimer)
    }
  }, [loadPending, loadSessions, loadSession, loadAttention, syncSession, notify])

  const projectById = useMemo(() => {
    const map = new Map()
    projects.forEach((project) => map.set(project.id, project))
    return map
  }, [projects])

  const sessionCounts = useMemo(() => {
    const counts = new Map()
    sessions.forEach((item) => {
      counts.set(item.projectID, (counts.get(item.projectID) || 0) + 1)
    })
    return counts
  }, [sessions])

  const visibleProjects = useMemo(
    () =>
      projects.filter(
        (project) => project.exists !== false && (sessionCounts.get(project.id) || 0) > 0,
      ),
    [projects, sessionCounts],
  )

  const sidebarProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = keyword
      ? visibleProjects.filter((project) => {
          const haystack = [
            project.canonical || '',
            project.name || '',
            basename(project.canonical || ''),
          ]
            .join(' ')
            .toLowerCase()
          if (haystack.includes(keyword)) return true
          return sessions.some(
            (item) =>
              item.projectID === project.id &&
              (item.title || '').toLowerCase().includes(keyword),
          )
        })
      : visibleProjects
    const latest = new Map()
    sessions.forEach((item) => {
      const stamp = item.time?.updated || 0
      if (stamp > (latest.get(item.projectID) || 0)) latest.set(item.projectID, stamp)
    })
    const pinnedSet = new Set(pinned)
    return list
      .slice()
      .sort(
        (a, b) =>
          Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id)) ||
          (latest.get(b.id) || b.time?.active || 0) - (latest.get(a.id) || a.time?.active || 0),
      )
  }, [visibleProjects, query, sessions, pinned])

  const allSessions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0)),
    [sessions],
  )

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return allSessions.filter((item) => {
      if (selectedProject !== 'all' && item.projectID !== selectedProject) return false
      if (!keyword) return true
      const project = projectById.get(item.projectID)
      const haystack = [
        item.title || '',
        project?.canonical || '',
        project?.name || '',
        item.model?.id || '',
        item.model?.providerID || '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [allSessions, selectedProject, query, projectById])

  const currentProject = selectedProject === 'all' ? null : projectById.get(selectedProject) || null
  const sessionProject =
    view.kind === 'session' ? projectById.get(session?.info?.projectID || '') || null : null
  const breadcrumbProject = sessionProject || currentProject
  const activeCount = Object.keys(active || {}).length

  const openProject = (projectId) => {
    setSelectedProject(projectId)
    setView({ kind: 'overview' })
    setPage(1)
    setSession(null)
    setSidebarOpen(false)
  }

  const openSession = (sessionId, projectId) => {
    if (projectId && selectedProject !== 'all' && selectedProject !== projectId) {
      setSelectedProject(projectId)
    }
    setView({ kind: 'session', id: sessionId })
    setSidebarOpen(false)
    setCompleted((prev) => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    void loadSession(sessionId)
  }

  const defaultSessionPath = (chosenProject = null) => {
    const preferred =
      chosenProject || (selectedProject === 'all' ? null : projectById.get(selectedProject))
    const latest = sessions
      .map((item) => projectById.get(item.projectID))
      .find((project) => project && project.exists !== false)
    const target =
      preferred ||
      latest ||
      sidebarProjects[0] ||
      projects.find((project) => project.exists !== false)
    return target?.canonical || ''
  }

  const openNewSession = (chosenProject = null) => {
    setModal({ kind: 'new-session', path: defaultSessionPath(chosenProject) })
  }

  const createSessionAt = async (directory) => {
    if (creatingRef.current) return false
    const target = directory?.trim()
    if (!target) {
      notify('请选择会话目录')
      return false
    }
    creatingRef.current = true
    try {
      const result = await api('/sessions', {
        method: 'POST',
        body: JSON.stringify({ location: { directory: target } }),
      })
      const info = result?.data
      if (!info?.id) throw new Error('新建会话失败')
      await loadSessions()
      setSelectedProject(info.projectID || selectedProject)
      setView({ kind: 'session', id: info.id })
      setSession(null)
      setSidebarOpen(false)
      setModal(null)
      notify('已新建会话', 'success')
      void loadSession(info.id)
      return true
    } catch (error) {
      notify(error.message)
      return false
    } finally {
      creatingRef.current = false
    }
  }

  const closeSession = () => {
    setView({ kind: 'overview' })
    setSession(null)
  }

  useEffect(() => {
    const handler = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return
      if (event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      openNewSession()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedProject, sessions])

  useEffect(() => {
    if (!sidebarOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [sidebarOpen])

  const refreshCurrent = async () => {
    try {
      await loadSessions()
      if (view.kind === 'session') await loadSession(view.id, { silent: true })
      notify('已刷新', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const updateSessionMeta = async (sessionId, payload) => {
    await api(`/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    await loadSessions()
    if (view.kind === 'session' && view.id === sessionId) {
      await loadSession(sessionId, { silent: true })
    }
  }

  const handleRename = async (title) => {
    const sessionId = modal?.sessionId || (view.kind === 'session' ? view.id : null)
    if (!sessionId) return
    try {
      await updateSessionMeta(sessionId, { title })
      setModal(null)
      notify('标题已更新', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const handleDelete = async () => {
    const target = modal?.session
    if (!target) return
    try {
      await api(`/sessions/${target.id}`, { method: 'DELETE' })
      try {
        window.localStorage.removeItem(`ocm_draft_${target.id}`)
      } catch {
        /* 浏览器禁用存储时忽略 */
      }
      setModal(null)
      if (view.kind === 'session' && view.id === target.id) closeSession()
      await loadSessions()
      notify('会话已删除', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const handleRenameProject = async (title) => {
    const projectId = modal?.projectId
    if (!projectId) return
    try {
      await api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: title }),
      })
      const list = await api('/projects')
      setProjects(Array.isArray(list) ? list : [])
      setModal(null)
      notify('项目名称已更新', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const handleSend = async (text, attachments = []) => {
    const current = viewRef.current
    if (current.kind !== 'session') return false
    const sessionId = current.id
    const command = /^\/([^\s]+)\s*([\s\S]*)$/.exec(text.trim())
    if (command && attachments.length === 0) {
      setSending(true)
      try {
        await api(`/sessions/${sessionId}/command`, {
          method: 'POST',
          body: JSON.stringify({
            name: command[1],
            arguments: command[2].trim(),
            text: text.trim(),
          }),
        })
        notify(`已执行 /${command[1]}`, 'success')
        void loadSessions().catch(() => {})
        void syncSession(sessionId, { force: true, limit: 6 }).catch(() => {})
        return true
      } catch (error) {
        notify(error.message)
        return false
      } finally {
        setSending(false)
      }
    }
    const running = Boolean(activeRef.current[sessionId])
    const tempId = `local_${Date.now()}`
    const files = attachments.map((item) => ({
      uri: item.uri,
      name: item.name,
      source: { type: 'inline' },
    }))
    const optimistic = {
      id: tempId,
      time: { created: Date.now() },
      text,
      files: attachments.map((item) => ({ name: item.name, mime: item.mime })),
      agents: [],
      type: 'user',
      steering: running,
    }
    setSession((prev) =>
      prev && prev.info?.id === sessionId
        ? { ...prev, messages: [...prev.messages, optimistic] }
        : prev,
    )
    setSending(true)
    try {
      const body = { text }
      if (files.length > 0) body.files = files
      if (running) body.delivery = 'steer'
      const result = await api(`/sessions/${sessionId}/prompt`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const admitted = result?.data
      setSession((prev) => {
        if (!prev || prev.info?.id !== sessionId) return prev
        const messages = prev.messages.map((item) =>
          item.id === tempId
            ? {
                id: admitted?.id || tempId,
                time: { created: admitted?.time?.created || Date.now() },
                text: admitted?.payload?.text || text,
                files: admitted?.payload?.files || [],
                type: 'user',
                delivery: admitted?.delivery,
                queued: admitted?.delivery === 'queue',
                steering: admitted?.delivery === 'steer',
              }
            : item,
        )
        return { ...prev, messages }
      })
      void loadSessions().catch(() => {})
      return true
    } catch (error) {
      setSession((prev) =>
        prev && prev.info?.id === sessionId
          ? { ...prev, messages: prev.messages.filter((item) => item.id !== tempId) }
          : prev,
      )
      notify(error.message)
      return false
    } finally {
      setSending(false)
    }
  }

  const handleStop = async () => {
    const current = viewRef.current
    if (current.kind !== 'session' || stopping) return
    const sessionId = current.id
    setStopping(true)
    try {
      const result = await api(`/sessions/${sessionId}/interrupt`, { method: 'POST' })
      const interrupted = result?.interrupted ?? result?.data?.interrupted
      if (interrupted === false) {
        notify('这一轮已经结束，没有可中断的执行', 'success')
      } else {
        notify('已中断执行', 'success')
        setActive((prev) => {
          const next = { ...prev }
          delete next[sessionId]
          return next
        })
      }
      await syncSession(sessionId)
      void loadSessions().catch(() => {})
    } catch (error) {
      notify(error.message)
    } finally {
      setStopping(false)
    }
  }

  const compactSession = async () => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      await api(`/sessions/${current.id}/compact`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      notify('已请求压缩上下文', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const findLastUser = () => {
    const messages = sessionRef.current?.messages || []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.type === 'user' && !String(messages[index].id).startsWith('local_')) {
        return messages[index]
      }
    }
    return null
  }

  const runRevert = async (lastUser, respawn) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    const sessionId = current.id
    await api(`/sessions/${sessionId}/revert`, {
      method: 'POST',
      body: JSON.stringify({ messageID: lastUser.id, files: false }),
    })
    await api(`/sessions/${sessionId}/revert/commit`, { method: 'POST' })
    if (respawn) {
      const files = (lastUser.files || []).map((item) => ({
        uri: item.uri || `data:${item.mime || 'application/octet-stream'};base64,${item.data}`,
        name: item.name,
        source: { type: 'inline' },
      }))
      const body = { text: lastUser.text || '' }
      if (files.length > 0) body.files = files
      await api(`/sessions/${sessionId}/prompt`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      notify('已重新生成上一条', 'success')
    } else {
      notify('已撤销上一轮', 'success')
    }
    await loadSession(sessionId, { silent: true })
    await loadSessions()
  }

  const handleUndo = async () => {
    const lastUser = findLastUser()
    if (!lastUser) {
      notify('没有可撤销的消息')
      setModal(null)
      return
    }
    try {
      await runRevert(lastUser, false)
      setModal(null)
    } catch (error) {
      notify(error.message)
    }
  }

  const handleRegenerate = async () => {
    const lastUser = findLastUser()
    if (!lastUser) {
      notify('没有可重新生成的消息')
      setModal(null)
      return
    }
    try {
      await runRevert(lastUser, true)
      setModal(null)
    } catch (error) {
      notify(error.message)
    }
  }

  const cancelQueued = useCallback(async (messageId) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      await api(`/sessions/${current.id}/inbox/${messageId}`, { method: 'DELETE' })
      setSession((prev) =>
        prev && prev.info?.id === current.id
          ? { ...prev, messages: prev.messages.filter((item) => item.id !== messageId) }
          : prev,
      )
      notify('已取消排队', 'success')
    } catch (error) {
      notify(error.message)
    }
  }, [notify])

  const replyPermission = useCallback(async (request, decision) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      await api(`/sessions/${current.id}/permissions/${request.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      setPending((prev) => ({
        ...prev,
        permissions: prev.permissions.filter((item) => item.id !== request.id),
      }))
      notify(decision === 'reject' ? '已拒绝授权' : '已允许授权', 'success')
      void loadAttention()
    } catch (error) {
      notify(error.message)
    }
  }, [loadAttention, notify])

  const replyForm = useCallback(async (form, answer) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      await api(`/sessions/${current.id}/forms/${form.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      })
      setPending((prev) => ({
        ...prev,
        forms: prev.forms.filter((item) => item.id !== form.id),
      }))
      notify('已提交', 'success')
      void loadAttention()
    } catch (error) {
      notify(error.message)
    }
  }, [loadAttention, notify])

  const cancelForm = useCallback(async (form) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      await api(`/sessions/${current.id}/forms/${form.id}`, { method: 'DELETE' })
      setPending((prev) => ({
        ...prev,
        forms: prev.forms.filter((item) => item.id !== form.id),
      }))
      notify('已关闭表单', 'success')
      void loadAttention()
    } catch (error) {
      notify(error.message)
    }
  }, [loadAttention, notify])

  const switchModel = async (model) => {
    const sessionId = viewRef.current.kind === 'session' ? viewRef.current.id : null
    if (!sessionId) return
    try {
      await api(`/sessions/${sessionId}/model`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      })
      setModal(null)
      await loadSession(sessionId, { silent: true })
      notify('模型已切换', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const switchAgent = async (agent) => {
    const sessionId = viewRef.current.kind === 'session' ? viewRef.current.id : null
    if (!sessionId) return
    try {
      await api(`/sessions/${sessionId}/agent`, {
        method: 'POST',
        body: JSON.stringify({ agent }),
      })
      setModal(null)
      await loadSession(sessionId, { silent: true })
      notify('agent 已切换', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const loadOlder = async () => {
    const current = sessionRef.current
    if (!current?.olderCursor || loadingOlder) return false
    const sessionId = current.info?.id
    setLoadingOlder(true)
    try {
      const page = await api(
        `/sessions/${sessionId}/messages?limit=${LOAD_OLDER_LIMIT}&cursor=${encodeURIComponent(current.olderCursor)}`,
      )
      const older = (page?.data || []).slice().reverse()
      setSession((prev) => {
        if (!prev || prev.info?.id !== sessionId) return prev
        const ids = new Set(prev.messages.map((item) => item.id))
        const merged = older.filter((item) => !ids.has(item.id)).concat(prev.messages)
        return { ...prev, messages: merged, olderCursor: page?.cursor?.next || null }
      })
      return true
    } catch (error) {
      notify(error.message)
      return false
    } finally {
      setLoadingOlder(false)
    }
  }

  const openAttachment = async (messageId, index) => {
    const current = viewRef.current
    if (current.kind !== 'session') return
    try {
      const result = await api(`/sessions/${current.id}/messages/${messageId}`)
      const message = result?.data || result
      const file = (message?.files || [])[index]
      if (!file?.data || !String(file.mime || '').startsWith('image/')) {
        notify('这个附件不支持预览')
        return
      }
      setModal({
        kind: 'image',
        src: `data:${file.mime};base64,${file.data}`,
        name: file.name || '附件',
      })
    } catch (error) {
      notify(error.message)
    }
  }

  const runProject = async (item) => {
    const directory =
      item?.location?.directory || projectById.get(item?.projectID || '')?.canonical
    if (!directory) {
      notify('找不到项目目录')
      return
    }
    try {
      const result = await api('/run', {
        method: 'POST',
        body: JSON.stringify({ path: directory }),
      })
      notify(`已在终端运行：${result?.title || platform.script}`, 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const openParentFolder = async (item) => {
    const directory =
      item?.location?.directory || projectById.get(item?.projectID || '')?.canonical
    if (!directory) {
      notify('找不到项目目录')
      return
    }
    const normalized = directory.replace(/[\\/]+$/, '')
    try {
      const result = await api('/reveal', {
        method: 'POST',
        body: JSON.stringify({ path: normalized, target: 'project' }),
      })
      notify(
        result?.selected
          ? `已打开上级目录并选中项目文件夹：${parentPath(normalized) || '.'}`
          : '已打开项目目录',
        'success',
      )
    } catch (error) {
      notify(error.message)
    }
  }

  const openFinder = async (target, project = null) => {
    const directory = (project || currentProject)?.canonical
    if (!directory) return
    try {
      await api('/reveal', {
        method: 'POST',
        body: JSON.stringify({
          path: directory,
          target: target === 'terminal' ? 'terminal' : 'project',
        }),
      })
      notify(target === 'terminal' ? '已在终端打开项目目录' : '已打开项目目录', 'success')
    } catch (error) {
      notify(error.message)
    }
  }

  const copyCommand = async (project = null) => {
    const directory = (project || currentProject)?.canonical
    if (!directory) return
    const command = `cd "${directory}" && opencode`
    try {
      await navigator.clipboard.writeText(command)
      notify('启动命令已复制', 'success')
    } catch {
      notify('浏览器拒绝了剪贴板写入，请手动复制目录', 'error')
    }
  }

  const currentSessionItem = view.kind === 'session' ? session?.info : null
  const running = Boolean(currentSessionItem && active[currentSessionItem.id])

  const breadcrumbNode = (
    <div className="breadcrumb">
      {view.kind === 'session' ? null : (
        <button className="crumb" onClick={() => openProject('all')}>
          全部项目
        </button>
      )}
      {breadcrumbProject ? (
        <>
          <Icon name="chevronRight" size={14} className="crumb-sep" />
          <button
            className="crumb project-crumb"
            onClick={() => openProject(breadcrumbProject.id)}
          >
            {breadcrumbProject.name || basename(breadcrumbProject.canonical)}
          </button>
        </>
      ) : null}
      {view.kind === 'session' && currentSessionItem ? (
        <>
          <Icon name="chevronRight" size={14} className="crumb-sep" />
          <span className="crumb current" title={currentSessionItem.title || '未命名会话'}>
            {currentSessionItem.title || '未命名会话'}
          </span>
        </>
      ) : null}
    </div>
  )

  if (bootLoading) {
    return (
      <div className="boot-screen">
        <Logo size={44} />
        <p>正在读取 opencode 数据…</p>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="boot-screen">
        <Logo size={44} />
        <h1>无法连接 opencode</h1>
        <p className="boot-message">{bootError}</p>
        <button className="primary-button" onClick={() => void bootstrap()}>
          重新连接
        </button>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={sidebarProjects}
        projectById={projectById}
        selectedProject={selectedProject}
        onSelectProject={openProject}
        sessions={allSessions}
        activeSessionId={view.kind === 'session' ? view.id : null}
        active={active}
        query={query}
        onQueryChange={setQuery}
        onOpenSession={openSession}
        sessionCounts={sessionCounts}
        projectTotal={visibleProjects.length}
        service={service}
        liveConnected={liveConnected}
        activeCount={activeCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        now={now}
        onCreateSession={() => openNewSession()}
        completed={completed}
        attention={attention}
        onGoHome={() => openProject('all')}
        onNewSessionInProject={(project) => openNewSession(project)}
        onOpenProjectFolder={(project, target) => void openFinder(target, project)}
        onCopyProjectCommand={(project) => void copyCommand(project)}
        pinned={pinned}
        onTogglePin={togglePinProject}
        onRefresh={() => void refreshCurrent()}
        onOpenSettings={() => setModal({ kind: 'settings' })}
        shortcut={platform.shortcut}
        folderLabel={platform.folderLabel}
        onRenameProject={(project) =>
          setModal({
            kind: 'project-rename',
            projectId: project.id,
            title: project.name || basename(project.canonical),
          })
        }
      />

      <main className="main-panel">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开菜单"
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-right">
            <span className={`live-pill ${liveConnected ? 'on' : 'off'}`}>
              <span className="live-dot" />
              <span className="live-label">{liveConnected ? '实时同步' : '实时断开'}</span>
            </span>
            <button className="icon-button" onClick={() => void refreshCurrent()} aria-label="刷新数据">
              <Icon name="refresh" />
            </button>
            <button
              className="icon-button"
              onClick={() => setModal({ kind: 'settings' })}
              aria-label="设置"
              title="设置"
            >
              <Icon name="settings" />
            </button>
          </div>
        </header>

        <div className="content">
          {view.kind === 'overview' ? (
            <Overview
              project={currentProject}
              projects={projects}
              sessions={filteredSessions}
              active={active}
              page={page}
              onPageChange={setPage}
              onOpenSession={openSession}
              onCreateSession={() => openNewSession()}
              onOpenFinder={() => void openFinder('finder')}
              onOpenTerminal={() => void openFinder('terminal')}
              onCopyCommand={() => void copyCommand()}
              onRenameProject={() =>
                currentProject &&
                setModal({
                  kind: 'project-rename',
                  projectId: currentProject.id,
                  title: currentProject.name || basename(currentProject.canonical),
                })
              }
              query={query}
              now={now}
              breadcrumb={breadcrumbNode}
              attention={attention}
              completed={completed}
              onClearQuery={() => setQuery('')}
              folderLabel={platform.folderLabel}
            />
          ) : (
            <SessionView
              session={session}
              sessionId={view.id}
              loading={sessionLoading}
              busy={running}
              stopping={stopping}
              breadcrumb={breadcrumbNode}
              olderCursor={session?.olderCursor}
              loadingOlder={loadingOlder}
              onLoadOlder={loadOlder}
              onBack={closeSession}
              onRename={() =>
                setModal({
                  kind: 'rename',
                  sessionId: view.id,
                  title: session?.info?.title || '',
                })
              }
              onCancelQueued={cancelQueued}
              onDelete={() =>
                setModal({
                  kind: 'delete',
                  session: currentSessionItem || { id: view.id, title: session?.info?.title },
                })
              }
              onOpenAttachment={openAttachment}
              onSend={handleSend}
              onStop={handleStop}
              pending={pending}
              onReplyPermission={replyPermission}
              onReplyForm={replyForm}
              onCancelForm={cancelForm}
              onOpenModel={() => setModal({ kind: 'model' })}
              onOpenFolder={() => void openParentFolder(session?.info)}
              onRun={() => void runProject(session?.info)}
              onCompact={() => void compactSession()}
              onUndo={() => setModal({ kind: 'revert', mode: 'undo' })}
              onRegenerate={() => setModal({ kind: 'revert', mode: 'regenerate' })}
              sending={sending}
              project={projectById.get(session?.info?.projectID || '')}
              now={now}
            />
          )}
        </div>
      </main>

      {sidebarOpen ? <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} /> : null}

      {modal?.kind === 'new-session' ? (
        <NewSessionModal
          initialPath={modal.path}
          recents={sidebarProjects.slice(0, 6).map((project) => ({
            name: project.name || basename(project.canonical),
            path: project.canonical,
          }))}
          onClose={() => setModal(null)}
          onCreate={(path) => createSessionAt(path)}
        />
      ) : null}

      {modal?.kind === 'rename' ? (
        <RenameModal
          title={modal.title}
          onClose={() => setModal(null)}
          onSubmit={handleRename}
        />
      ) : null}

      {modal?.kind === 'delete' ? (
        <Modal title="删除会话" onClose={() => setModal(null)}>
          <p className="modal-text">
            会话「{modal.session?.title || '未命名会话'}」及其消息会被永久删除，无法恢复。
          </p>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              取消
            </button>
            <button className="danger-button" onClick={() => void handleDelete()}>
              确认删除
            </button>
          </div>
        </Modal>
      ) : null}

      {modal?.kind === 'project-rename' ? (
        <RenameModal
          title={modal.title}
          heading="重命名项目"
          placeholder="输入项目显示名称"
          onClose={() => setModal(null)}
          onSubmit={handleRenameProject}
        />
      ) : null}

      {modal?.kind === 'model' ? (
        <ModelPicker
          session={session}
          onClose={() => setModal(null)}
          onPickModel={(model) => void switchModel(model)}
          onPickAgent={(agent) => void switchAgent(agent)}
        />
      ) : null}

      {modal?.kind === 'settings' ? (
        <Modal title="设置" onClose={() => setModal(null)}>
          <div className="settings-row">
            <div className="settings-copy">
              <strong>会话完成提示音</strong>
              <span>会话执行完成时播放轻提示音，默认开启。</span>
            </div>
            <div className="settings-actions">
              <button className="ghost-button" onClick={() => playCompletionSound()}>
                试听
              </button>
              <button
                className={`switch ${settings.completionSound ? 'on' : ''}`}
                onClick={toggleCompletionSound}
                role="switch"
                aria-checked={settings.completionSound}
                aria-label="会话完成提示音"
              >
                <span className="switch-knob" />
              </button>
            </div>
          </div>
          <div className="settings-row settings-row-theme">
            <div className="settings-copy">
              <strong>背景颜色</strong>
            </div>
            <label className="gray-slider">
              <input
                type="range"
                min={GRAY_MIN}
                max={GRAY_MAX}
                step="1"
                value={backgroundPercent(settings.background)}
                onChange={(event) => chooseBackground(event.target.value)}
                aria-label="背景灰度"
              />
              <span className="gray-slider-value">
                {backgroundPercent(settings.background)}%
              </span>
            </label>
          </div>
          <div className="modal-actions">
            <button className="primary-button" onClick={() => setModal(null)}>
              完成
            </button>
          </div>
        </Modal>
      ) : null}

      {modal?.kind === 'image' ? (
        <Modal title={modal.name || '图片'} onClose={() => setModal(null)} wide>
          <img className="image-preview" src={modal.src} alt={modal.name || '图片'} />
        </Modal>
      ) : null}

      {modal?.kind === 'revert' ? (
        <Modal
          title={modal.mode === 'regenerate' ? '重新生成回复' : '撤销上一轮'}
          onClose={() => setModal(null)}
        >
          <p className="modal-text">
            {modal.mode === 'regenerate'
              ? '会先删除最后一条消息及其回复，再用相同内容重新发送，文件改动不会回退。'
              : '会删除最后一条消息及其之后的全部回复，文件改动不会回退。'}
          </p>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className={modal.mode === 'regenerate' ? 'primary-button' : 'danger-button'}
              onClick={() =>
                void (modal.mode === 'regenerate' ? handleRegenerate() : handleUndo())
              }
            >
              确认
            </button>
          </div>
        </Modal>
      ) : null}

      {toast ? <Toast text={toast.text} kind={toast.kind} /> : null}
    </div>
  )
}

function RenameModal({ title, heading = '重命名会话', placeholder = '输入会话标题', onClose, onSubmit }) {
  const [value, setValue] = useState(title || '')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <Modal title={heading} onClose={onClose}>
      <input
        ref={inputRef}
        id="rename-input"
        name="title"
        className="text-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent?.isComposing) return
          if (event.key === 'Enter' && value.trim()) onSubmit(value.trim())
        }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="modal-actions">
        <button className="ghost-button" onClick={onClose}>
          取消
        </button>
        <button
          className="primary-button"
          disabled={!value.trim()}
          onClick={() => onSubmit(value.trim())}
        >
          保存
        </button>
      </div>
    </Modal>
  )
}
