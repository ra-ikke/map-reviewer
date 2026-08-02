import type { AppState, QueueItem, ReviewImageAttachment } from './model'

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

export interface ExportReviewImageV1 {
  base64: string
  filename: string
  mimeType: string
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
  /** Structured attachment preferred by Session API / Discord post. */
  image?: ExportReviewImageV1 | null
}

export interface ExportPayloadV1 {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  appVersion: string
  exportedAt: string
  settings: ExportSettingsV1
  session?: ExportSessionV1 | null
  items: ExportQueueItemV1[]
}

function toExportImage(image: ReviewImageAttachment | null | undefined): ExportReviewImageV1 | null {
  if (!image?.base64?.trim()) return null
  return {
    base64: image.base64.replace(/\s+/g, ''),
    filename: image.filename?.trim() || 'map.png',
    mimeType: image.mimeType?.trim() || 'image/png',
  }
}

export function buildExportPayloadV1(
  state: AppState,
  exportedAt = new Date().toISOString(),
  opts?: { includeXml?: boolean; includeReviewImages?: boolean },
): ExportPayloadV1 {
  const includeXml = Boolean(opts?.includeXml)
  const includeReviewImages = opts?.includeReviewImages !== false
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
      if (includeReviewImages) {
        const image = toExportImage(it.reviewImage)
        if (image) base.image = image
      }
      return base
    }),
  }
}
