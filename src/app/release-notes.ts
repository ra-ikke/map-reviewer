export interface ReleaseNotesSection {
  title: string
  items: string[]
}

export const RELEASE_NOTES: ReleaseNotesSection[] = [
  {
    title: "v1.0.16 - 2026-08-02",
    items: [
      'Comment editor with Discord markdown: bold, italic, underline, strikethrough, spoiler, code.',
      'Emoji picker with server custom emojis and common Unicode emojis.',
      'Optional image attachment per map (max 1, up to 8MB) — posted with the review on Discord.',
      'Votecrew can no longer create forum discussions automatically (requires review approval first).',
    ],
  },
  {
    title: "v1.0.15 - 2026-06-18",
    items: [
      'Map preview shows author and current category (name + icon).',
      'Map preview image shows URL from host server.',
      'Review panel reorganized: Mapcode → Current Category → Submitter → Author → Actions.',
    ],
  },
]
