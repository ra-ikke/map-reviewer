export type CommandMode = '!np' | '/np' | '/npp'

export type Decision = 'left_as_is' | 'p1ed' | 'will_be_discussed' | 'ignored'

export type InputMethod = 'session_api' | 'session_json' | 'file_text' | 'clipboard' | 'textarea'

export type ItemStatus = 'pending' | 'reviewed'

export interface QueueItem {
  id: string
  mapcode: string
  author?: string | null
  xml?: string | null
  p?: number | null
  submitter?: string | null
  importedIgnored?: boolean | null
  importedReason?: string | null
  commandsUsed: CommandMode[]
  review: string
  decision: Decision | null
  status: ItemStatus
  createdAt: string
  updatedAt: string
}

export interface SessionState {
  category: string
  inputMethod: InputMethod
  startedAt: string
  // preenchido quando importado via Session API/JSON
  threadId?: string | null
  collectedAt?: string | null
  limitPerUser?: number | null
}

export interface Settings {
  commandMode: CommandMode
  dedupe: boolean
  autoCaptureClipboard: boolean
  showIgnoredInQueue: boolean
  reviewHotkeysEnabled: boolean
  reviewHotkeys: {
    prevMap: string
    nextMap: string
    replayCurrent: string
  }
  massPermHotkeys: {
    toggle: string
    playCurrent: string
    next: string
    prev: string
  }
  authToken: string | null
  authUserId: string | null
}

export interface AppState {
  appVersion: string
  settings: Settings
  session: SessionState | null
  items: QueueItem[]
  selectedId: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  commandMode: '!np',
  dedupe: true,
  autoCaptureClipboard: false,
  showIgnoredInQueue: true,
  reviewHotkeysEnabled: true,
  reviewHotkeys: {
    prevMap: 'PageUp',
    nextMap: 'PageDown',
    replayCurrent: 'Insert',
  },
  massPermHotkeys: {
    toggle: 'Ctrl+P',
    playCurrent: 'Insert',
    next: 'PageDown',
    prev: 'PageUp',
  },
  authToken: null,
  authUserId: null,
}

export const APP_VERSION = '1.0.7'

