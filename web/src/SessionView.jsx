import { Composer, SessionHeader } from './MessageList'
import MessageList from './MessageList'
import Pending from './Pending'
import { Icon } from './Icons'

export default function SessionView({
  session,
  sessionId,
  loading,
  busy,
  stopping,
  olderCursor,
  loadingOlder,
  onLoadOlder,
  onBack,
  onRename,
  onDelete,
  onSend,
  onCancelQueued,
  onStop,
  pending,
  onReplyPermission,
  onReplyForm,
  onCancelForm,
  onOpenModel,
  onOpenFolder,
  onRun,
  onCompact,
  onUndo,
  onRegenerate,
  onOpenAttachment,
  sending,
  project,
  breadcrumb,
}) {
  const ready = session && session.info && session.info.id === sessionId

  if (!ready) {
    return (
      <div className="session-view">
        <div className="session-loading">
          {loading ? (
            <>
              <span className="spinner large" />
              <p>正在读取会话内容…</p>
            </>
          ) : (
            <>
              <Icon name="chat" size={28} />
              <p>会话不存在或已被删除</p>
              <button className="ghost-button" onClick={onBack}>
                返回项目
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="session-view">
      <SessionHeader
        session={session}
        busy={busy}
        breadcrumb={breadcrumb}
        onRename={onRename}
        onDelete={onDelete}
        onOpenFolder={onOpenFolder}
        onOpenModel={onOpenModel}
        onRun={onRun}
      />
      <MessageList
        messages={session.messages}
        sessionId={sessionId}
        busy={busy}
        startedAt={session.info?.time?.busy}
        onCancelQueued={onCancelQueued}
        olderCursor={olderCursor}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onUndo={onUndo}
        onRegenerate={onRegenerate}
        onCompact={onCompact}
        onOpenAttachment={onOpenAttachment}
      />
      <Pending
        permissions={pending?.permissions || []}
        forms={pending?.forms || []}
        onReplyPermission={onReplyPermission}
        onReplyForm={onReplyForm}
        onCancelForm={onCancelForm}
      />
      <Composer
        sessionId={sessionId}
        onSend={onSend}
        onStop={onStop}
        busy={busy}
        sending={sending}
        stopping={stopping}
        model={session.info?.model}
        agent={session.info?.agent}
        onOpenModel={onOpenModel}
        directory={session.info?.location?.directory || ''}
      />
    </div>
  )
}
