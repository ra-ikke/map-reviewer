import type { ReviewImageAttachment } from './model'

/** Matches xero3.0 `_MAX_REVIEW_IMAGE_BYTES` — oversized images are ignored by the API. */
export const MAX_REVIEW_IMAGE_BYTES = 8 * 1024 * 1024

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function reviewImageDataUrl(image: ReviewImageAttachment): string {
  const mime = image.mimeType || 'image/png'
  return `data:${mime};base64,${image.base64}`
}

export function parseReviewImageFromExport(raw: unknown): ReviewImageAttachment | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const base64Raw = obj.base64 ?? obj.data ?? obj.imageBase64
  if (typeof base64Raw !== 'string' || !base64Raw.trim()) return null

  let mimeType = typeof obj.mimeType === 'string' ? obj.mimeType.trim() : ''
  let base64 = base64Raw.trim()
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/i.exec(base64)
  if (dataUrlMatch) {
    mimeType = mimeType || dataUrlMatch[1]!
    base64 = dataUrlMatch[2]!
  }
  base64 = base64.replace(/\s+/g, '')
  if (!base64) return null

  const filename =
    typeof obj.filename === 'string' && obj.filename.trim()
      ? obj.filename.trim()
      : `map.${mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'png'}`

  return {
    base64,
    filename,
    mimeType: mimeType || 'image/png',
  }
}

export function parseReviewImageFromItemFields(it: Record<string, unknown>): ReviewImageAttachment | null {
  if (it.image != null) {
    if (typeof it.image === 'string') {
      return parseReviewImageFromExport({ base64: it.image })
    }
    const fromObj = parseReviewImageFromExport(it.image)
    if (fromObj) return fromObj
  }
  if (typeof it.imageBase64 === 'string' && it.imageBase64.trim()) {
    return parseReviewImageFromExport({ base64: it.imageBase64 })
  }
  if (it.reviewImage != null) {
    return parseReviewImageFromExport(it.reviewImage)
  }
  return null
}

export async function readFileAsReviewImage(file: File): Promise<ReviewImageAttachment> {
  const mimeType = (file.type || 'image/png').toLowerCase()
  if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith('image/')) {
    throw new Error('Unsupported file type. Use PNG, JPEG, WebP, or GIF.')
  }
  if (file.size > MAX_REVIEW_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.floor(MAX_REVIEW_IMAGE_BYTES / (1024 * 1024))}MB).`)
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Failed to read image file.'))
    reader.readAsDataURL(file)
  })

  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) throw new Error('Failed to encode image as base64.')

  const detectedMime = match[1]!.toLowerCase()
  const base64 = match[2]!.replace(/\s+/g, '')
  // Approximate decoded size from base64 length
  const approxBytes = Math.floor((base64.length * 3) / 4)
  if (approxBytes > MAX_REVIEW_IMAGE_BYTES) {
    throw new Error(`Image is too large (max ${Math.floor(MAX_REVIEW_IMAGE_BYTES / (1024 * 1024))}MB).`)
  }

  const filename = file.name?.trim() || `attachment.${detectedMime.includes('jpeg') || detectedMime.includes('jpg') ? 'jpg' : detectedMime.includes('webp') ? 'webp' : detectedMime.includes('gif') ? 'gif' : 'png'}`

  return {
    base64,
    filename,
    mimeType: detectedMime || mimeType || 'image/png',
  }
}
