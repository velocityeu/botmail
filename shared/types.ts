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

export interface ThreadsResponse { threads: ApiThread[]; syncedAt: string | null; mailbox: string }
export interface OutboundResponse { items: OutboundItem[] }
