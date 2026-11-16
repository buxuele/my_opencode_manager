import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { api } from './api'
import { Icon } from './Icons'

function costLabel(item) {
  const cost = Array.isArray(item.cost) ? item.cost[0] : null
  if (!cost) return ''
  const input = Number(cost.input) || 0
  const output = Number(cost.output) || 0
  if (input === 0 && output === 0) return '免费'
  return `输入 $${input}/M · 输出 $${output}/M`
}

export default function ModelPicker({ session, onClose, onPickModel, onPickAgent }) {
  const [tab, setTab] = useState('model')
  const [models, setModels] = useState([])
  const [agents, setAgents] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const directory = session?.info?.location?.directory || ''
  const currentModel = session?.info?.model
  const currentAgent = session?.info?.agent

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      api(`/models?directory=${encodeURIComponent(directory)}`),
      api(`/agents?directory=${encodeURIComponent(directory)}`),
    ])
      .then(([modelResult, agentResult]) => {
        if (cancelled) return
        setModels((modelResult?.data || []).filter((item) => item.enabled !== false))
        setAgents(agentResult?.data || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [directory])

  const keyword = query.trim().toLowerCase()
  const filteredModels = useMemo(
    () =>
      models
        .filter(
          (item) =>
            !keyword ||
            `${item.name} ${item.providerID} ${item.modelID}`.toLowerCase().includes(keyword),
        )
        .sort(
          (a, b) =>
            a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name),
        ),
    [models, keyword],
  )
  const filteredAgents = useMemo(
    () =>
      agents
        .filter((item) => !item.hidden && item.mode !== 'subagent')
        .filter(
          (item) =>
            !keyword ||
            `${item.name} ${item.id} ${item.description || ''}`.toLowerCase().includes(keyword),
        ),
    [agents, keyword],
  )

  return (
    <Modal title="模型与 agent" onClose={onClose} wide>
      <div className="picker-tabs">
        <button
          className={`picker-tab ${tab === 'model' ? 'on' : ''}`}
          onClick={() => setTab('model')}
        >
          模型
        </button>
        <button
          className={`picker-tab ${tab === 'agent' ? 'on' : ''}`}
          onClick={() => setTab('agent')}
        >
          Agent
        </button>
      </div>
      <input
        className="text-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={tab === 'model' ? '搜索模型或供应商' : '搜索 agent'}
        aria-label="搜索"
      />
      {loading ? (
        <p className="picker-note">正在读取可选列表…</p>
      ) : error ? (
        <p className="picker-note error">{error}</p>
      ) : tab === 'model' ? (
        <div className="picker-list">
          {filteredModels.map((item) => {
            const active =
              currentModel?.id === item.modelID && currentModel?.providerID === item.providerID
            return (
              <button
                key={`${item.providerID}/${item.modelID}/${item.id}`}
                className={`picker-row ${active ? 'active' : ''}`}
                onClick={() =>
                  onPickModel({ id: item.modelID, providerID: item.providerID })
                }
              >
                <span className="picker-main">
                  <span className="picker-name">{item.name}</span>
                  <span className="picker-meta">
                    {item.providerID} / {item.modelID}
                    {item.status && item.status !== 'active' ? ` · ${item.status}` : ''}
                  </span>
                  <span className="picker-cost">{costLabel(item)}</span>
                </span>
                {active ? <Icon name="check" size={16} /> : null}
              </button>
            )
          })}
          {filteredModels.length === 0 ? <p className="picker-note">没有匹配的模型</p> : null}
        </div>
      ) : (
        <div className="picker-list">
          {filteredAgents.map((item) => {
            const active = currentAgent === item.id
            return (
              <button
                key={item.id}
                className={`picker-row ${active ? 'active' : ''}`}
                onClick={() => onPickAgent(item.id)}
              >
                <span className="picker-main">
                  <span className="picker-name">{item.name}</span>
                  <span className="picker-meta">
                    {item.id}
                    {item.description ? ` · ${item.description}` : ''}
                  </span>
                </span>
                {active ? <Icon name="check" size={16} /> : null}
              </button>
            )
          })}
          {filteredAgents.length === 0 ? <p className="picker-note">没有匹配的 agent</p> : null}
        </div>
      )}
      <p className="picker-note">切换只影响之后的回合；费用按每百万 token 计，额度不足会在执行时提示。</p>
    </Modal>
  )
}
