import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from './Icons'
import { basename, duration, formatClock, formatDate, modelLabel } from './format'

function Markdown({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}

function toolSummary(part) {
  const input = part.state?.input || {}
  const keys = ['command', 'filePath', 'path', 'pattern', 'description', 'url', 'query', 'prompt', 'name']
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const first = Object.values(input).find((value) => typeof value === 'string' && value.trim())
  return first || part.name || '工具调用'
}

function toolOutput(part) {
  const state = part.state || {}
  if (Array.isArray(state.content)) {
    const text = state.content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
    if (text) return text
  }
  if (typeof state.output === 'string') return state.output
  if (typeof state.content === 'string') return state.content
  return ''
}

function statusLabel(status) {
  if (status === 'running') return '运行中'
  if (status === 'completed') return '完成'
  if (status === 'error' || status === 'failed') return '失败'
  if (status === 'pending') return '等待'
  return status || '记录'
}

function ToolCard({ part }) {
  const [open, setOpen] = useState(false)
  const status = part.state?.status || (part.executed ? 'completed' : 'recorded')
  const output = toolOutput(part)
  const input = part.state?.input
  const hasDetail = Boolean(input) || Boolean(output)

  return (
    <div className={`tool-card ${status === 'error' || status === 'failed' ? 'failed' : ''}`}>
      <button
        className="tool-head"
        onClick={() => hasDetail && setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className={`tool-status ${status}`}>
          {status === 'running' ? <span className="spinner" /> : <Icon name="terminal" size={15} />}
        </span>
        <span className="tool-name">{part.name || 'tool'}</span>
        <span className="tool-summary">{toolSummary(part)}</span>
        <span className="tool-state">{statusLabel(status)}</span>
        {hasDetail ? (
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} className="tool-chevron" />
        ) : null}
      </button>
      {open ? (
        <div className="tool-body">
          {input ? (
            <div className="tool-block">
              <span className="tool-block-label">参数</span>
              <pre className="tool-pre">{JSON.stringify(input, null, 2)}</pre>
            </div>
          ) : null}
          {output ? (
            <div className="tool-block">
              <span className="tool-block-label">输出</span>
              <pre className="tool-pre output">{output}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Reasoning({ part, done }) {
  const [open, setOpen] = useState(false)
  const seconds = part.time?.created && part.time?.completed ? duration(part.time.created, part.time.completed) : ''
  const complete = Boolean(done || part.time?.completed)
  const text = part.text || ''
  if (!text) return null
  return (
    <div className="reasoning">
      <button className="reasoning-head" onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
        <Icon name={complete ? 'check' : 'dot'} size={14} />
        <span>{complete ? '思考过程' : '正在思考'}</span>
        {seconds ? <span className="reasoning-time">{seconds}</span> : null}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {open ? <div className="reasoning-body">{text}</div> : null}
    </div>
  )
}

function AssistantMessage({ message, onUndo, onRegenerate, showActions }) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)
  const parts = Array.isArray(message.content) ? message.content : []
  const visible = parts.filter((part) => part && (part.type === 'text' || part.type === 'reasoning' || part.type === 'tool'))
  const plainText = parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n\n')

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copy = async () => {
    if (!plainText) return
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 浏览器拒绝剪贴板时保持原样 */
    }
  }

  const errorText = message.error?.message || ''
  const interrupted = /interrupt/i.test(errorText)

  if (visible.length === 0) return null
  return (
    <div className="message assistant">
      <span className="assistant-avatar">oc</span>
      <div className="assistant-body">
        {visible.map((part, index) => {
          if (part.type === 'text') {
            return <Markdown key={`text-${index}`}>{part.text}</Markdown>
          }
          if (part.type === 'reasoning') {
            return <Reasoning key={`reasoning-${index}`} part={part} done={Boolean(message.time?.completed)} />
          }
          return <ToolCard key={part.id || `tool-${index}`} part={part} />
        })}
        {message.error ? (
          interrupted ? (
            <p className="message-note">本轮已中断</p>
          ) : (
            <p className="message-error">执行失败：{errorText || '未知错误'}</p>
          )
        ) : null}
        <div className="message-foot">
          <span>{formatClock(message.time?.created)}</span>
          {message.agent ? <span>agent {message.agent}</span> : null}
          {message.time?.completed && message.time?.created
            ? <span>耗时 {duration(message.time.created, message.time.completed)}</span>
            : null}
          {plainText ? (
            <button className="message-copy" onClick={() => void copy()}>
              {copied ? '已复制' : '复制'}
            </button>
          ) : null}
          {showActions ? (
            <>
              <button className="message-copy" onClick={onRegenerate}>
                重新生成
              </button>
              <button className="message-copy danger" onClick={onUndo}>
                撤销上一轮
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function UserMessage({ message, onCancelQueued, onOpenAttachment }) {
  return (
    <div className="message user">
      <div className="user-bubble">
        <Markdown>{message.text || ''}</Markdown>
        {message.files && message.files.length > 0 ? (
          <div className="user-files">
            {message.files.map((file, index) => (
              <button
                className="file-chip"
                key={index}
                onClick={() => onOpenAttachment?.(message.id, index)}
                title="查看附件"
              >
                <Icon name="folder" size={14} />
                {file.name || file.path || file.url || '附件'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="user-foot">
        {formatClock(message.time?.created)}
        {message.steering ? <span className="queue-badge">已插话</span> : null}
        {message.queued ? <span className="queue-badge">排队中</span> : null}
        {message.queued && onCancelQueued && !String(message.id).startsWith('local_') ? (
          <button className="queue-cancel" onClick={() => onCancelQueued(message.id)}>
            取消
          </button>
        ) : null}
      </div>
    </div>
  )
}

function MetaMessage({ message }) {
  const label =
    message.type === 'model-switched'
      ? `模型切换为 ${modelLabel(message.model)}`
      : message.type === 'agent-switched'
        ? `agent 切换为 ${message.agent || '未知'}`
        : ''
  if (!label) return null
  return (
    <div className="meta-line">
      <span>{label}</span>
    </div>
  )
}

function ShellMessage({ message }) {
  const text = message.command || message.text || ''
  return (
    <div className="shell-line">
      <code>$ {text}</code>
    </div>
  )
}

const MessageItem = memo(function MessageItem({ message, onCancelQueued, onOpenAttachment, actions }) {
  if (!message) return null
  if (message.type === 'user') {
    return (
      <UserMessage
        message={message}
        onCancelQueued={onCancelQueued}
        onOpenAttachment={onOpenAttachment}
      />
    )
  }
  if (message.type === 'assistant') {
    return (
      <AssistantMessage
        message={message}
        onUndo={actions?.onUndo}
        onRegenerate={actions?.onRegenerate}
        showActions={Boolean(actions)}
      />
    )
  }
  if (message.type === 'compaction') {
    return (
      <div className="meta-line compaction">
        <span>上下文已压缩</span>
        {message.summary ? <p>{message.summary}</p> : null}
      </div>
    )
  }
  if (message.type === 'shell') return <ShellMessage message={message} />
  if (message.type === 'model-switched' || message.type === 'agent-switched') {
    return <MetaMessage message={message} />
  }
  return null
})

export default function MessageList({
  messages,
  sessionId,
  busy,
  startedAt,
  onCancelQueued,
  olderCursor,
  loadingOlder,
  onLoadOlder,
  onUndo,
  onRegenerate,
  onOpenAttachment,
}) {
  const [atBottom, setAtBottom] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const lastCount = useRef(0)

  useEffect(() => {
    lastCount.current = 0
    setAtBottom(true)
  }, [sessionId])

  useEffect(() => {
    if (!busy) {
      setElapsed(0)
      return
    }
    const start = Number(startedAt) || Date.now()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [busy, sessionId, startedAt])

  const visible = useMemo(
    () =>
      messages.filter((message) =>
        ['user', 'assistant', 'compaction', 'shell', 'model-switched', 'agent-switched'].includes(
          message.type,
        ),
      ),
    [messages],
  )

  const lastAssistantId = useMemo(() => {
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const item = visible[index]
      if (item.type === 'assistant' && item.time?.completed) return item.id
    }
    return null
  }, [visible])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 260
    if (nearBottom || lastCount.current === 0) node.scrollTop = node.scrollHeight
    lastCount.current = visible.length
  }, [visible])

  useEffect(() => {
    const node = scrollRef.current
    if (node && busy) {
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 260
      if (nearBottom) node.scrollTop = node.scrollHeight
    }
  }, [busy])

  const scrollToBottom = () => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    setAtBottom(true)
  }

  const loadOlderKeepScroll = async () => {
    if (!onLoadOlder || loadingOlder) return
    const node = scrollRef.current
    const beforeHeight = node?.scrollHeight || 0
    const beforeTop = node?.scrollTop || 0
    const ok = await onLoadOlder()
    if (!ok) return
    requestAnimationFrame(() => {
      if (!node) return
      node.scrollTop = beforeTop + (node.scrollHeight - beforeHeight)
    })
  }

  return (
    <div className="transcript-shell">
      <div
        className="transcript"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget
          const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
          setAtBottom(nearBottom)
        }}
      >
        <div className="transcript-inner">
          {olderCursor ? (
            <button
              className="load-more"
              onClick={() => void loadOlderKeepScroll()}
              disabled={loadingOlder}
            >
              {loadingOlder ? '正在加载更早的消息…' : '加载更早的消息'}
            </button>
          ) : null}
          {visible.length === 0 && !busy ? (
            <div className="transcript-empty">
              <Icon name="chat" size={26} />
              <p>还没有消息，在下面输入开始这一轮</p>
            </div>
          ) : null}
          {visible.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              onCancelQueued={onCancelQueued}
              onOpenAttachment={onOpenAttachment}
              actions={
                !busy && message.id === lastAssistantId
                  ? { onUndo, onRegenerate }
                  : null
              }
            />
          ))}
          {busy ? (
            <div className="thinking-row">
              <span className="assistant-avatar">oc</span>
              <span className="thinking-text">正在执行</span>
              {elapsed > 0 ? <span className="thinking-elapsed">{elapsed} 秒</span> : null}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      {!atBottom ? (
        <button className="jump-latest" onClick={scrollToBottom}>
          回到最新
        </button>
      ) : null}
    </div>
  )
}

export function SessionHeader({
  session,
  project,
  busy,
  onRename,
  onDelete,
  onOpenFolder,
  onOpenModel,
  onCompact,
}) {
  const info = session?.info

  return (
    <header className="session-head">
      <div className="session-head-inner">
        <div className="session-head-main">
          <div className="session-title-row">
            <h1>{info?.title || '未命名会话'}</h1>
            {busy ? <span className="busy-pill"><span className="running-dot" />执行中</span> : null}
            {info?.parentID ? <span className="soft-pill">子会话</span> : null}
          </div>
          <div className="session-meta-line">
            <span>{project ? project.name || basename(project.canonical) : '未知项目'}</span>
            <span className="dot-sep" />
            <button className="model-button" onClick={onOpenModel} title="切换模型与 agent">
              {info?.model ? modelLabel(info.model) : '默认模型'}
            </button>
            {info?.agent ? (
              <>
                <span className="dot-sep" />
                <button className="model-button" onClick={onOpenModel} title="切换模型与 agent">
                  agent {info.agent}
                </button>
              </>
            ) : null}
            <span className="dot-sep" />
            <span className="created-at" title={formatDate(info?.time?.created)}>
              创建于 {formatDate(info?.time?.created)}
            </span>
            <span className="dot-sep" />
            <button className="model-button" onClick={onCompact} title="压缩上下文">
              压缩上下文
            </button>
          </div>
        </div>
        <div className="session-actions">
          <button className="ghost-button" onClick={onOpenFolder}>
            <Icon name="folder" size={16} />
            打开
          </button>
          <button className="ghost-button" onClick={onRename}>
            <Icon name="pencil" size={16} />
            重命名
          </button>
          <button className="ghost-button danger" onClick={onDelete}>
            <Icon name="trash" size={16} />
            删除
          </button>
        </div>
      </div>
    </header>
  )
}

function readDraft(key) {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function saveDraft(key, value) {
  try {
    if (value.trim()) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    /* 浏览器禁用存储时忽略草稿 */
  }
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function Composer({ sessionId, onSend, onStop, busy, sending, stopping }) {
  const storageKey = sessionId ? `ocm_draft_${sessionId}` : ''
  const [text, setText] = useState(() => (storageKey ? readDraft(storageKey) : ''))
  const [attachments, setAttachments] = useState([])
  const [attachError, setAttachError] = useState('')
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef(null)
  const fileRef = useRef(null)
  const saveTimer = useRef(null)
  const lastKey = useRef(storageKey)
  const latestDraft = useRef({ key: storageKey, text })
  latestDraft.current = { key: storageKey, text }

  useEffect(() => {
    if (lastKey.current === storageKey) return
    saveDraft(lastKey.current, latestDraft.current.text)
    lastKey.current = storageKey
    setText(storageKey ? readDraft(storageKey) : '')
    setAttachments([])
    setAttachError('')
  }, [storageKey])

  useEffect(() => () => {
    const pending = latestDraft.current
    if (pending.key) saveDraft(pending.key, pending.text)
  }, [])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`
  }, [text])

  useEffect(() => {
    if (!storageKey) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveDraft(storageKey, text)
    }, 250)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [text, storageKey])

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList).filter(Boolean)
    if (incoming.length === 0) return
    setAttachError('')
    const next = [...attachments]
    for (const file of incoming) {
      if (next.length >= 6) {
        setAttachError('最多添加 6 个附件')
        break
      }
      if (file.size > 8 * 1024 * 1024) {
        setAttachError('单个附件不能超过 8MB')
        continue
      }
      try {
        const uri = await readFileDataUrl(file)
        next.push({
          uri,
          name: file.name || '粘贴的图片.png',
          mime: file.type || 'application/octet-stream',
          size: file.size,
        })
      } catch {
        setAttachError('读取附件失败')
      }
    }
    setAttachments(next)
  }

  const submit = async () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || sending) return
    const sentFiles = attachments
    setText('')
    setAttachments([])
    setAttachError('')
    const ok = await onSend(value || '请看附件', sentFiles)
    if (ok === false) {
      setText((prev) => prev || value)
      setAttachments(sentFiles)
    }
  }

  return (
    <div className="composer-area">
      <div
        className={`composer ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void addFiles(event.dataTransfer?.files)
        }}
      >
        {attachments.length > 0 ? (
          <div className="attach-list">
            {attachments.map((file, index) => (
              <span className="attach-chip" key={`${file.name}-${index}`}>
                {file.mime?.startsWith('image/') ? (
                  <img className="attach-thumb" src={file.uri} alt="" />
                ) : (
                  <Icon name="folder" size={14} />
                )}
                <span className="attach-name">{file.name}</span>
                <button
                  className="attach-remove"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                  }
                  aria-label={`移除 ${file.name}`}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          id="session-composer"
          name="message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const items = Array.from(event.clipboardData?.items || []).filter((item) =>
              item.type.startsWith('image/'),
            )
            if (items.length === 0) return
            event.preventDefault()
            void addFiles(items.map((item) => item.getAsFile()))
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent?.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void submit()
          }}
          rows={1}
          placeholder={busy ? '继续输入，消息会插话到当前回合' : '继续这个会话，输入消息…'}
          aria-label="输入消息"
        />
        {attachError ? <p className="attach-error">{attachError}</p> : null}
        <div className="composer-bar">
          <span className="composer-tools">
            <button
              className="attach-button"
              onClick={() => fileRef.current?.click()}
              aria-label="添加附件"
              title="添加图片或文件"
            >
              <Icon name="attach" size={16} />
            </button>
            <span className="composer-hint">
              {busy ? '执行中，新消息会在下一步读取' : 'Enter 发送 · Shift + Enter 换行'}
            </span>
          </span>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <span className="composer-actions">
            {busy ? (
              <button className="stop-button" onClick={onStop} disabled={stopping}>
                <Icon name="stop" size={14} />
                {stopping ? '正在停止' : '停止执行'}
              </button>
            ) : null}
            <button
              className="send-button"
              onClick={() => void submit()}
              disabled={(!text.trim() && attachments.length === 0) || sending}
              aria-label="发送消息"
            >
              {sending ? <span className="spinner small" /> : <Icon name="arrowUp" size={17} />}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
