// Wire contract shared by the Vercel API (api/) and the web client (src/).
// Type-only module: nothing here exists at runtime.

export type ApiFolder = 'inbox' | 'sent' | 'archive' | 'trash' | 'drafts'

export interface ApiAttachment { name: string; size?: string }

export interface ApiMessage {
  /** Grok Bot message id (pass this as replyToMessageId when replying). */
  id: string
  from: string          // display name
  fromAddr: string      // bare address
  to: string            // display string, comma separated
  cc?: string
  date: string          // ISO 8601
  body: string          // plain text
  bot?: boolean
  attachments?: ApiAttachment[]
}

export interface ApiThread {
  id: string            // Grok Bot thread id
  subject: string
  folder: ApiFolder
  labels: string[]
  unread?: boolean
  starred?: boolean
  bot?: boolean
  lastAt: string        // ISO 8601 of newest message
  messages: ApiMessage[] // oldest first
}

export type OutboundStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface OutboundItem {
  id: string
  from: string          // always the Grok Bot inbox address
  to: string[]
  cc?: string[]
  subject: string
  body: string
  replyToMessageId?: string
  threadId?: string
  status: OutboundStatus
  createdAt: string
  updatedAt: string
  /** Grok Bot message id returned by SendEmail, set when status = sent. */
  messageId?: string
  error?: string
}

export interface ThreadsResponse { threads: ApiThread[]; syncedAt: string | null; mailbox: string; syncRequest?: SyncRequest; syncPending?: boolean }
export interface OutboundResponse { items: OutboundItem[] }

/**
 * "Sync now" request raised from the web app's Sync button (botmail/sync-request.json).
 * pending  = AT pressed Sync, waiting for CoS
 * running  = CoS claimed it and is syncing + flushing
 * done     = CoS finished (completedAt set)
 * failed   = CoS gave up (error set)
 * idle     = no request has ever been made
 */
export type SyncRequestStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed'

export interface SyncRequest {
  id: string | null
  status: SyncRequestStatus
  requestedAt: string | null
  requestedBy?: 'app' | 'sync'
  startedAt?: string | null
  completedAt?: string | null
  error?: string
  /** 'ack' = CoS called POST /api/sync-request {status}; 'sync' = legacy auto-close (no longer happens); 'force' = manual cleanup. */
  completedBy?: 'ack' | 'sync' | 'force'
  /** Number of times Sync was pressed while this request was still open. */
  presses?: number
  /** When CoS pushed POST /api/sync?source=cos-pull for this request (a real inbox pull). Required before 'done'. */
  pulledAt?: string
  /** Last time /api/wake-sync successfully POSTed the Cursor automation webhook for this request. */
  wokeAt?: string
  /** Number of successful webhook wakes for this request. */
  wakes?: number
}

export interface SyncRequestResponse {
  request: SyncRequest
  /** true while status is pending or running */
  pending: boolean
  syncedAt: string | null
}
