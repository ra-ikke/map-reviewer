import type { AppState, QueueItem } from './model'

export const EXPORT_SCHEMA_VERSION = 1 as const

export interface ExportSettingsV1 {
  commandMode: AppState['settings']['commandMode']
  dedupe: boolean
  autoCaptureClipboard: boolean
}

export interface ExportSessionV1 {
  category: string
  inputMethod: AppState['session'] extends infer S ? (S extends { inputMethod: infer I } ? I : string) : string
  startedAt: string
  reviewerUserId?: string | null
  threadId?: string | null
  collectedAt?: string | null
  limitPerUser?: number | null
}

export interface ExportQueueItemV1 {
  id: string
  mapcode: string
  author?: string | null
  xml?: string | null
  submitter?: string | null
  importedIgnored?: boolean | null
  importedReason?: string | null
  commandsUsed: QueueItem['commandsUsed']
  review: string
  decision: QueueItem['decision']
  status: QueueItem['status']
  createdAt: string
  updatedAt: string
}

export interface ExportPayloadV1 {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  appVersion: string
  exportedAt: string
  settings: ExportSettingsV1
  session?: ExportSessionV1 | null
  items: ExportQueueItemV1[]
}

export function buildExportPayloadV1(
  state: AppState,
  exportedAt = new Date().toISOString(),
  opts?: { includeXml?: boolean },
): ExportPayloadV1 {
  const includeXml = Boolean(opts?.includeXml)
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: state.appVersion,
    exportedAt,
    settings: {
      commandMode: state.settings.commandMode,
      dedupe: state.settings.dedupe,
      autoCaptureClipboard: state.settings.autoCaptureClipboard,
    },
    session: state.session
      ? {
          category: state.session.category,
          inputMethod: state.session.inputMethod,
          startedAt: state.session.startedAt,
          reviewerUserId: state.settings.authUserId ?? null,
          threadId: state.session.threadId ?? null,
          collectedAt: state.session.collectedAt ?? null,
          limitPerUser: state.session.limitPerUser ?? null,
        }
      : null,
    items: state.items.map((it) => {
      const base: ExportQueueItemV1 = {
        id: it.id,
        mapcode: it.mapcode,
        author: it.author ?? null,
        submitter: it.submitter ?? null,
        importedIgnored: it.importedIgnored ?? null,
        importedReason: it.importedReason ?? null,
        commandsUsed: it.commandsUsed,
        review: it.review,
        decision: it.decision,
        status: it.status,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      }

      if (includeXml) base.xml = it.xml ?? null
      return base
    }),
  }
}

