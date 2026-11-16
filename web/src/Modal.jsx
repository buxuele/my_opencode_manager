import { useEffect } from 'react'
import { Icon } from './Icons'

export default function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div
        className={`modal-card ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
