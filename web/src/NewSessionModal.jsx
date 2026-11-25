import { useState } from 'react'
import Modal from './Modal'
import { Icon } from './Icons'
import { api } from './api'
import { shortPath } from './format'

export default function NewSessionModal({ initialPath, recents, onClose, onCreate, remote }) {
  const [path, setPath] = useState(initialPath || '')
  const [input, setInput] = useState(initialPath || '')
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const pickFolder = async () => {
    if (picking) return
    setPicking(true)
    setError('')
    try {
      const result = await api('/pick-folder', {
        method: 'POST',
        body: JSON.stringify({ prompt: '选择项目目录' }),
      })
      if (result?.path) {
        setPath(result.path)
        setInput(result.path)
      }
    } catch (err) {
      if (err.message !== '已取消选择') setError(err.message)
    } finally {
      setPicking(false)
    }
  }

  const submit = async () => {
    if (creating) return
    const target = (input.trim() || path).trim()
    if (!target) {
      setError('请先选择目录')
      return
    }
    setCreating(true)
    try {
      await onCreate(target)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal title="新建会话" onClose={onClose}>
      <div className="folder-picker">
        <div className="folder-path">
          <input
            id="session-directory"
            name="directory"
            className="folder-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={() => setPath(input.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setPath(input.trim())
            }}
            aria-label="会话目录"
            placeholder="输入绝对路径，或点浏览选择"
            data-autofocus
          />
          {remote ? null : (
            <button className="ghost-button" onClick={() => void pickFolder()} disabled={picking}>
              <Icon name="folder" size={15} />
              {picking ? '等待选择' : '浏览'}
            </button>
          )}
        </div>
        {remote ? null : (
          <p className="folder-hint">浏览会打开系统目录选择框，选中后直接填入路径。</p>
        )}
        {recents.length > 0 ? (
          <div className="folder-recents">
            {recents.map((item) => (
              <button
                key={item.path}
                className={`folder-recent ${
                  item.path === (input.trim() || path) ? 'active' : ''
                }`}
                onClick={() => {
                  setPath(item.path)
                  setInput(item.path)
                }}
                title={item.path}
              >
                {item.name}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="folder-error">{error}</p> : null}
        <div className="folder-foot">
          <span className="folder-current" title={path || input}>
            {shortPath(path || input) || '尚未选择目录'}
          </span>
          <button className="primary-button" onClick={() => void submit()} disabled={creating}>
            {creating ? '正在创建' : '在此新建会话'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
