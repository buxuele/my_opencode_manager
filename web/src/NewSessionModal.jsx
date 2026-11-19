import { useState } from 'react'
import Modal from './Modal'
import { Icon } from './Icons'
import { api } from './api'
import { shortPath } from './format'

export default function NewSessionModal({ initialPath, recents, onClose, onCreate }) {
  const [path, setPath] = useState(initialPath || '')
  const [input, setInput] = useState(initialPath || '')
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const openFinder = async () => {
    setError('')
    try {
      const result = await api('/show-folder', {
        method: 'POST',
        body: JSON.stringify({ path: input.trim() || path }),
      })
      if (result?.path) setPath(result.path)
      setPicking(true)
    } catch (err) {
      setError(err.message)
    }
  }

  const readSelection = async () => {
    setError('')
    try {
      const result = await api('/finder-selection')
      if (result?.path) {
        setPath(result.path)
        setInput(result.path)
        setPicking(false)
      }
    } catch (err) {
      setError(err.message)
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
        <div className="folder-actions">
          <button className="ghost-button" onClick={() => void openFinder()}>
            <Icon name="folder" size={15} />
            在访达中打开
          </button>
          <button
            className="ghost-button"
            onClick={() => void readSelection()}
            disabled={!picking}
          >
            读取选中的目录
          </button>
        </div>
        <input
          className="folder-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onBlur={() => setPath(input.trim())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setPath(input.trim())
          }}
          aria-label="会话目录"
          placeholder="也可以直接输入绝对路径"
        />
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
