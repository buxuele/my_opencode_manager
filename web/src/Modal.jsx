import { useEffect, useRef } from 'react'
import { Icon } from './Icons'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default function Modal({ title, children, onClose, wide = false }) {
  const cardRef = useRef(null)
  const lastFocused = useRef(null)

  useEffect(() => {
    lastFocused.current = document.activeElement
    const card = cardRef.current
    const first = card?.querySelector('[data-autofocus]') || card?.querySelector(FOCUSABLE)
    if (first instanceof HTMLElement) first.focus()
    return () => {
      const previous = lastFocused.current
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const items = Array.from(card.querySelectorAll(FOCUSABLE)).filter(
        (node) => node instanceof HTMLElement && node.offsetParent !== null,
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
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
        ref={cardRef}
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
