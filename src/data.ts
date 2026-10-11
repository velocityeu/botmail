// UI view-model types + the offline "sample data" used only in Demo mode.
// Live mode maps the API contract (shared/types.ts) into these types in src/mailSource.ts.
import type { OutboundStatus } from '../shared/types'

export type Coin = 'brass' | 'gold' | 'bronze' | 'steel' | 'patina'
export type Folder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'trash'
export type Label = 'bots' | 'field' | 'builds' | 'calendar'

export interface Message {
  id: string
  from: string
  fromAddr: string
  to: string
  time: string
  coin: Coin
  initials: string
  bot?: boolean
  body: string
  attachments?: { name: string; size?: string }[]
  /** Set on messages that came from the outbound queue (not yet mirrored back from Grok Bot). */
  status?: OutboundStatus
  outboundId?: string
  error?: string
}

export interface Thread {
  id: string
  subject: string
  participants: string
  folder: Folder
  labels: Label[]
  unread: boolean
  starred?: boolean
  day: 'today' | 'earlier'
  time: string
  coin: Coin
  initials: string
  bot?: boolean
  messages: Message[]
  /** epoch ms of newest message (live mode sort key) */
  ts?: number
}

export const ME = { name: 'Alexander T', addr: 'alexandertr@mail.grokbot.com', initials: 'AT' }

export const SAMPLE_THREADS: Thread[] = [
  {
    id: 't-hello', subject: 'test hello', participants: 'Alexander T, Ok Bot', folder: 'inbox', labels: ['bots'],
    unread: true, day: 'today', time: '21:52', coin: 'patina', initials: 'OK', bot: true,
    messages: [
      { id: 'm1', from: 'Alexander T', fromAddr: 'at@example.com', to: ME.addr, time: '21:49', coin: 'brass', initials: 'AT',
        body: 'hello — testing the new Grok Bot address 👋' },
      { id: 'm2', from: 'Ok Bot', fromAddr: 'okbot@example.com', to: ME.addr, time: '21:52', coin: 'patina', initials: 'OK', bot: true,
        body: 'Ok! Loud and clear. Your Grok Bot inbox is live — mail sent to alexandertr@mail.grokbot.com lands here, and replies go out from the same address.\n\nNothing else to do. Reply to this thread any time to test a round trip.',
        attachments: [{ name: 'delivery-check.txt', size: '1 KB' }] },
    ],
  },
  {
    id: 't-field', subject: 'Saturday field run', participants: 'Mina Okafor', folder: 'inbox', labels: ['field'],
    unread: true, day: 'today', time: '20:14', coin: 'bronze', initials: 'MO',
    messages: [
      { id: 'm3', from: 'Mina Okafor', fromAddr: 'mina@example.com', to: ME.addr, time: '20:14', coin: 'bronze', initials: 'MO',
        body: 'Drone batteries are charged and the forecast looks clear. Meet at the north gate at 8?\n\nI’ll bring the spare props and the field tablet.' },
    ],
  },
  {
    id: 't-build', subject: 'Build #128 passed', participants: 'NOVA Square CI', folder: 'inbox', labels: ['builds'],
    unread: false, day: 'today', time: '18:40', coin: 'steel', initials: 'NS',
    messages: [
      { id: 'm4', from: 'NOVA Square CI', fromAddr: 'ci@example.com', to: ME.addr, time: '18:40', coin: 'steel', initials: 'NS',
        body: '480×480 firmware image ready for flash. 0 warnings, LVGL 9.2, size 2.4 MB.' },
    ],
  },
  {
    id: 't-cal', subject: 'Design review moved', participants: 'Calendar', folder: 'inbox', labels: ['calendar'],
    unread: false, day: 'earlier', time: 'Sat', coin: 'gold', initials: 'CA',
    messages: [
      { id: 'm5', from: 'Calendar', fromAddr: 'calendar@example.com', to: ME.addr, time: 'Sat', coin: 'gold', initials: 'CA',
        body: 'Now Monday 14:00 · Studio 2. Bring the 480 mocks.' },
    ],
  },
  {
    id: 't-ready', subject: 'Your address is ready', participants: 'Grok Bot Mail', folder: 'inbox', labels: [],
    unread: false, starred: true, day: 'earlier', time: 'Fri', coin: 'brass', initials: 'GB',
    messages: [
      { id: 'm6', from: 'Grok Bot Mail', fromAddr: 'hello@example.com', to: ME.addr, time: 'Fri', coin: 'brass', initials: 'GB',
        body: 'alexandertr@mail.grokbot.com can now send and receive.' },
    ],
  },
]
