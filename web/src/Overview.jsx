import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icons'
import {
  basename,
  formatDate,
  modelLabel,
  relativeTime,
  shortPath,
} from './format'

const PAGE_SIZE = 30

function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((n) => pages.add(n))
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => pages.add(n))
  const sorted = Array.from(pages).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const result = []
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) result.push('gap')
    result.push(n)
  })
  return result
}

export default function Overview({
  project,
  projects,
  sessions,
  active,
  page,
  onPageChange,
  onOpenSession,
  onCreateSession,
  onOpenFinder,
  onOpenTerminal,
  onCopyCommand,
  onRenameProject,
  query,
  now,
}) {
  const [sort, setSort] = useState('updated')

  const sorted = useMemo(() => {
    const list = sessions.slice()
    if (sort === 'created') {
      list.sort((a, b) => (b.time?.created || 0) - (a.time?.created || 0))
    } else {
      list.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
    }
    return list
  }, [sessions, sort])

  useEffect(() => {
    onPageChange(1)
  }, [sort, query, project?.id, onPageChange])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const visible = sorted.slice(start, start + PAGE_SIZE)

  useEffect(() => {
    if (page !== currentPage) onPageChange(currentPage)
  }, [page, currentPage, onPageChange])

  const name = project ? project.name || basename(project.canonical) : '全部项目'
  const pageItems = pageWindow(currentPage, totalPages)

  return (
    <div className={`overview ${project ? '' : 'list-only'}`}>
      {project ? (
        <>
          <section className="project-hero">
            <div className="hero-main">
              <span className="eyebrow">项目</span>
              <h1>{name}</h1>
              <p className="hero-path" title={project.canonical}>
                {shortPath(project.canonical)}
              </p>
              <div className="hero-actions">
                <button className="ghost-button" onClick={onOpenFinder}>
                  <Icon name="folder" size={16} />
                  打开目录
                </button>
                <button className="ghost-button" onClick={onOpenTerminal}>
                  <Icon name="terminal" size={16} />
                  在终端打开
                </button>
                <button className="ghost-button" onClick={onCopyCommand}>
                  <Icon name="copy" size={16} />
                  复制启动命令
                </button>
                <button className="ghost-button" onClick={onRenameProject}>
                  <Icon name="pencil" size={16} />
                  重命名项目
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className="session-section">
        <div className="list-toolbar">
          <div className="list-title">
            <h2>会话</h2>
            <span className="muted-text">
              {query ? `搜索“${query}”命中 ${sorted.length} 个` : `共 ${sorted.length} 个会话`}
            </span>
          </div>
          <div className="toolbar-actions">
            <button className="ghost-button" onClick={onCreateSession}>
              <Icon name="plus" size={16} />
              新建会话
            </button>
            <select
              className="select"
              id="session-sort"
              name="sort"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="排序方式"
            >
              <option value="updated">按更新时间</option>
              <option value="created">按创建时间</option>
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty-block">
            <Icon name="chat" size={26} />
            <p>{query ? '没有匹配的会话' : project ? '这个项目还没有会话' : '还没有任何会话'}</p>
            <span>在 opencode 中新建会话后，这里会自动出现。</span>
          </div>
        ) : (
          <div className="session-table">
            {visible.map((item) => {
              const projectInfo = projects.find((entry) => entry.id === item.projectID)
              const isRunning = Boolean(active[item.id])
              return (
                <button
                  key={item.id}
                  className="session-card"
                  onClick={() => onOpenSession(item.id, item.projectID)}
                >
                  <span className="session-card-main">
                    <span className="session-card-title">
                      {isRunning ? <span className="running-dot" /> : null}
                      {item.title || '未命名会话'}
                    </span>
                    <span className="session-card-meta">
                      {!project ? `${projectInfo ? projectInfo.name || basename(projectInfo.canonical) : '未知项目'} · ` : ''}
                      {modelLabel(item.model)}
                      {item.parentID ? ' · 子会话' : ''}
                    </span>
                  </span>
                  <span className="session-card-side">
                    <span className="session-time" title={formatDate(item.time?.updated)}>
                      {relativeTime(item.time?.updated, now)}
                    </span>
                    <Icon name="chevronRight" size={16} className="row-chevron" />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="pagination">
            <span className="pagination-total">
              第 {currentPage} / {totalPages} 页 · 共 {sorted.length} 条
            </span>
            <div className="pagination-controls">
              <button
                className="page-button"
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="上一页"
              >
                <Icon name="chevronRight" size={16} className="flip" />
              </button>
              {pageItems.map((item, index) =>
                item === 'gap' ? (
                  <span className="page-gap" key={`gap-${index}`}>
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    className={`page-button ${item === currentPage ? 'active' : ''}`}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                className="page-button"
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label="下一页"
              >
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
