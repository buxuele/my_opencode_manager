import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Logo } from './Icons'
import { basename, relativeTime, shortPath } from './format'

export default function Sidebar({
  projects,
  projectById,
  selectedProject,
  onSelectProject,
  sessions,
  activeSessionId,
  active,
  completed,
  attention,
  query,
  onQueryChange,
  onOpenSession,
  sessionCounts,
  projectTotal,
  service,
  liveConnected,
  activeCount,
  open,
  onClose,
  now,
  onCreateSession,
  onGoHome,
  onNewSessionInProject,
  onOpenProjectFolder,
  onCopyProjectCommand,
  onRenameProject,
  pinned,
  onTogglePin,
  onRefresh,
  onOpenSettings,
}) {
  const searchRef = useRef(null)
  const scrollRef = useRef(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [revealed, setRevealed] = useState(() => new Set())
  const [menu, setMenu] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectedProject, query])

  useEffect(() => {
    if (!activeSessionId) return
    const owner = sessions.find((item) => item.id === activeSessionId)?.projectID
    if (!owner) return
    setExpanded((prev) => (prev.has(owner) ? prev : new Set(prev).add(owner)))
  }, [activeSessionId, sessions])

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const keyword = query.trim().toLowerCase()
  const hasPinned = pinned.length > 0

  const sessionsByProject = useMemo(() => {
    const map = new Map()
    sessions.forEach((item) => {
      const list = map.get(item.projectID)
      if (list) list.push(item)
      else map.set(item.projectID, [item])
    })
    map.forEach((list) =>
      list.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0)),
    )
    return map
  }, [sessions])

  const matchedSessions = useMemo(() => {
    if (!keyword) return []
    return sessions
      .filter((item) => {
        const owner = projectById.get(item.projectID)
        return [item.title || '', owner?.name || '', owner?.canonical || '']
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      })
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
  }, [sessions, keyword, projectById])

  const matchedIds = useMemo(
    () => new Set(matchedSessions.map((item) => item.id)),
    [matchedSessions],
  )

  const toggleProject = (projectId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const toggleRevealed = (projectId) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const activeProjects = useMemo(() => {
    const set = new Set()
    sessions.forEach((item) => {
      if (active[item.id]) set.add(item.projectID)
    })
    return set
  }, [sessions, active])

  useEffect(() => {
    if (!menu) return
    const close = (event) => {
      if (event.type === 'pointerdown' && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const openMenu = (event, project) => {
    event.preventDefault()
    const width = 200
    const height = 268
    setMenu({
      project,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    })
  }

  const runMenuAction = (handler, project) => {
    setMenu(null)
    handler(project)
  }

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand">
        <button className="brand-home" onClick={onGoHome} aria-label="回到首页">
          <Logo size={32} />
          <div className="brand-text">
            <strong>opencode</strong>
          </div>
        </button>
        <button className="icon-button mobile-only" onClick={onClose} aria-label="关闭菜单">
          <Icon name="x" />
        </button>
      </div>

      <div className="search-box">
        <Icon name="search" size={17} />
        <input
          ref={searchRef}
          id="global-search"
          name="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            if (event.nativeEvent?.isComposing) return
            if (matchedSessions.length > 0) {
              onOpenSession(matchedSessions[0].id, matchedSessions[0].projectID)
              return
            }
            if (projects.length > 0) onSelectProject(projects[0].id)
          }}
          placeholder="搜索项目或会话"
          aria-label="搜索项目或会话"
        />
        {query ? (
          <button className="clear-search" onClick={() => onQueryChange('')} aria-label="清空搜索">
            <Icon name="x" size={14} />
          </button>
        ) : (
          <kbd>⌘K</kbd>
        )}
      </div>

      <div className="sidebar-scroll" ref={scrollRef}>
        <div className="section-head">
          <span>项目</span>
          <span className="section-tools">
            <span className="section-count">{projectTotal} 个</span>
            <button
              className="section-add"
              onClick={onCreateSession}
              aria-label="新建会话"
              title="新建会话"
            >
              <Icon name="plus" size={15} />
            </button>
          </span>
        </div>

        {projects.map((project) => {
          const count = sessionCounts.get(project.id) || 0
          const name = project.name || basename(project.canonical)
          const list = sessionsByProject.get(project.id) || []
          const visible = keyword ? list.filter((item) => matchedIds.has(item.id)) : list
          const isOpen = keyword ? visible.length > 0 : expanded.has(project.id)
          const showAll = revealed.has(project.id)
          const shown = showAll ? visible : visible.slice(0, 5)
          const restCount = visible.length - shown.length
          return (
            <div className="project-block" key={project.id}>
              <div
                className={`project-row ${selectedProject === project.id ? 'active' : ''}`}
                onContextMenu={(event) => openMenu(event, project)}
              >
                <button
                  className="project-open"
                  onClick={() => toggleProject(project.id)}
                  title={shortPath(project.canonical)}
                >
                  {hasPinned ? (
                    <span className="pin-mark" title={pinned.includes(project.id) ? '已置顶' : ''}>
                      {pinned.includes(project.id) ? <Icon name="barUp" size={13} /> : null}
                    </span>
                  ) : null}
                  {activeProjects.has(project.id) ? (
                    <span className="running-dot project-running-dot" />
                  ) : null}
                  <span className="project-name">{name}</span>
                </button>
                <span className="project-count">{count}</span>
                <button
                  className="project-expand"
                  onClick={() => toggleProject(project.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `收起 ${name}` : `展开 ${name}`}
                >
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} />
                </button>
              </div>

              {isOpen ? (
                <div className="project-sessions">
                  {shown.map((item) => {
                    const running = Boolean(active[item.id])
                    const stamp = relativeTime(item.time?.updated, now)
                    return (
                      <button
                        key={item.id}
                        className={`project-session ${
                          activeSessionId === item.id ? 'active' : ''
                        }`}
                        onClick={() => onOpenSession(item.id, item.projectID)}
                        title={`${item.title || '未命名会话'} · ${stamp}`}
                      >
                        {running ? <span className="running-dot" /> : null}
                        <span className="project-session-title">
                          {item.title || '未命名会话'}
                        </span>
                        {attention?.[item.id] ? (
                          <span className="attention-badge">待处理</span>
                        ) : null}
                        {completed?.[item.id] ? (
                          <span
                            className={`done-badge ${
                              completed[item.id] === 'failed' ? 'failed' : ''
                            }`}
                          >
                            {completed[item.id] === 'failed' ? '失败' : '已完成'}
                          </span>
                        ) : null}
                        <span className="project-session-time">{stamp}</span>
                      </button>
                    )
                  })}

                  {restCount > 0 ? (
                    <button className="project-more" onClick={() => toggleRevealed(project.id)}>
                      更多 {restCount} 个
                    </button>
                  ) : null}
                  {showAll && visible.length > 5 ? (
                    <button className="project-more" onClick={() => toggleRevealed(project.id)}>
                      收起
                    </button>
                  ) : null}
                  {visible.length === 0 ? (
                    <p className="project-empty">还没有会话</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}

        {projects.length === 0 ? (
          <p className="sidebar-empty">{keyword ? '没有匹配的项目' : '没有本地存在的项目'}</p>
        ) : null}
      </div>

      {menu ? (
        <div
          className="context-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction(onNewSessionInProject, menu.project)}
          >
            <Icon name="plus" size={15} />
            <span>新建会话</span>
          </button>
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction(onTogglePin, menu.project)}
          >
            <Icon name="pin" size={15} />
            <span>{pinned.includes(menu.project.id) ? '取消置顶' : '置顶项目'}</span>
          </button>
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction((item) => onSelectProject(item.id), menu.project)}
          >
            <Icon name="chevronRight" size={15} />
            <span>打开项目页</span>
          </button>
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction((item) => onOpenProjectFolder(item, 'finder'), menu.project)}
          >
            <Icon name="folder" size={15} />
            <span>打开目录</span>
          </button>
          <button
            className="context-item"
            role="menuitem"
            onClick={() =>
              runMenuAction((item) => onOpenProjectFolder(item, 'terminal'), menu.project)
            }
          >
            <Icon name="terminal" size={15} />
            <span>在终端打开</span>
          </button>
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction(onCopyProjectCommand, menu.project)}
          >
            <Icon name="copy" size={15} />
            <span>复制启动命令</span>
          </button>
          <div className="context-sep" />
          <button
            className="context-item"
            role="menuitem"
            onClick={() => runMenuAction(onRenameProject, menu.project)}
          >
            <Icon name="pencil" size={15} />
            <span>重命名项目</span>
          </button>
        </div>
      ) : null}

      <footer className="sidebar-footer">
        <div className="sidebar-globals">
          <span className={`live-pill ${liveConnected ? 'on' : 'off'}`}>
            <span className="live-dot" />
            <span className="live-label">{liveConnected ? '实时同步' : '实时断开'}</span>
          </span>
          <button className="icon-button" onClick={onRefresh} aria-label="刷新数据">
            <Icon name="refresh" />
          </button>
          <button
            className="icon-button"
            onClick={onOpenSettings}
            aria-label="设置"
            title="设置"
          >
            <Icon name="settings" />
          </button>
        </div>
        <div className="service-line">
          <span className={`live-dot ${service?.reachable ? '' : 'bad'}`} />
          <span>{service?.reachable ? '服务在线' : '服务离线'}</span>
          <span className="foot-meta">{activeCount} 个运行中</span>
          <span className="service-version">v{service?.version || '未知'}</span>
        </div>
      </footer>
    </aside>
  )
}
