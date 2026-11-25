import { useState } from 'react'
import { Icon } from './Icons'

function initialValues(form) {
  const values = {}
  form.fields.forEach((field) => {
    if (field.type === 'boolean') values[field.key] = Boolean(field.default)
    else if (field.type === 'multiselect') values[field.key] = Array.isArray(field.default) ? field.default : []
    else if (field.type === 'number' || field.type === 'integer') {
      values[field.key] = field.default === undefined ? '' : field.default
    } else values[field.key] = field.default ?? ''
  })
  return values
}

function FieldInput({ field, value, onChange }) {
  if (field.type === 'boolean') {
    return (
      <label className="pending-check">
        <input
          id={`field-${field.key}`}
          name={field.key}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{field.title || field.key}</span>
      </label>
    )
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="pending-field">
        <span className="pending-label">{field.title || field.key}</span>
        <div className="pending-options">
          {(field.options || []).map((option) => {
            const checked = selected.includes(option.value)
            return (
              <label key={option.value} className="pending-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((item) => item !== option.value)
                        : [...selected, option.value],
                    )
                  }
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      </div>
    )
  }
  if (field.type === 'external') {
    return (
      <div className="pending-field">
        <span className="pending-label">{field.title || field.key}</span>
        <a className="pending-link" href={field.url} target="_blank" rel="noreferrer">
          打开链接
        </a>
      </div>
    )
  }
  const inputType = field.type === 'number' || field.type === 'integer' ? 'number' : 'text'
  if (field.type === 'string' && Array.isArray(field.options) && field.options.length > 0) {
    return (
      <div className="pending-field">
        <span className="pending-label">{field.title || field.key}</span>
        <select
          className="select"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">请选择</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }
  return (
    <div className="pending-field">
      <span className="pending-label">{field.title || field.key}</span>
      <input
        className="text-input"
        type={inputType}
        value={value ?? ''}
        placeholder={field.placeholder || ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function fieldVisible(field, values) {
  return (field.when || []).every((condition) => {
    const value = values[condition.key]
    if (condition.op === 'neq') return value !== condition.value
    return value === condition.value
  })
}

function FormCard({ form, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => initialValues(form))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fields = (form.fields || []).filter(
    (field) => !field.hidden && fieldVisible(field, values),
  )

  const submit = async () => {
    const missing = fields.find((field) => {
      if (!field.required) return false
      const value = values[field.key]
      return value === '' || value === undefined || value === null ||
        (Array.isArray(value) && value.length === 0)
    })
    if (missing) {
      setError(`请填写${missing.title || missing.key}`)
      return
    }
    const answer = {}
    fields.forEach((field) => {
      if (field.type === 'external') return
      const value = values[field.key]
      if (field.type === 'number' || field.type === 'integer') {
        answer[field.key] = value === '' ? undefined : Number(value)
      } else if (field.type === 'boolean') answer[field.key] = Boolean(value)
      else if (field.type === 'multiselect') answer[field.key] = Array.isArray(value) ? value : []
      else answer[field.key] = value
    })
    setBusy(true)
    setError('')
    try {
      await onSubmit(form, answer)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pending-card">
      <div className="pending-head">
        <Icon name="chat" size={16} />
        <strong>{form.title || '需要填写'}</strong>
      </div>
      {fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
        />
      ))}
      {error ? <p className="pending-error">{error}</p> : null}
      <div className="pending-actions">
        <button className="ghost-button" onClick={() => onCancel(form)} disabled={busy}>
          忽略
        </button>
        <button className="primary-button" onClick={() => void submit()} disabled={busy}>
          {busy ? '提交中' : '提交'}
        </button>
      </div>
    </div>
  )
}

function PermissionCard({ request, onReply }) {
  const [busy, setBusy] = useState(false)
  const reply = async (decision) => {
    setBusy(true)
    try {
      await onReply(request, decision)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pending-card">
      <div className="pending-head">
        <Icon name="alert" size={16} />
        <strong>需要授权</strong>
      </div>
      <p className="pending-text">{request.action}</p>
      {request.resources?.length ? (
        <pre className="pending-resources">{request.resources.join('\n')}</pre>
      ) : null}
      {request.message ? <p className="pending-text muted">{request.message}</p> : null}
      <div className="pending-actions">
        <button className="ghost-button danger" onClick={() => void reply('reject')} disabled={busy}>
          拒绝
        </button>
        <button className="ghost-button" onClick={() => void reply('always')} disabled={busy}>
          始终允许
        </button>
        <button className="primary-button" onClick={() => void reply('once')} disabled={busy}>
          允许一次
        </button>
      </div>
    </div>
  )
}

export default function Pending({
  permissions,
  forms,
  onReplyPermission,
  onReplyForm,
  onCancelForm,
}) {
  if (permissions.length === 0 && forms.length === 0) return null
  return (
    <div className="pending-panel">
      {permissions.map((request) => (
        <PermissionCard key={request.id} request={request} onReply={onReplyPermission} />
      ))}
      {forms.map((form) => (
        <FormCard key={form.id} form={form} onSubmit={onReplyForm} onCancel={onCancelForm} />
      ))}
    </div>
  )
}
