import { Icon } from './Icons'

export default function Toast({ text, kind }) {
  return (
    <div className={`toast ${kind === 'success' ? 'success' : 'error'}`} role="status">
      <Icon name={kind === 'success' ? 'check' : 'alert'} size={16} />
      <span>{text}</span>
    </div>
  )
}
