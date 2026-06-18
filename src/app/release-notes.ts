export interface ReleaseNotesSection {
  title: string
  items: string[]
}

export const RELEASE_NOTES: ReleaseNotesSection[] = [
  {
    title: "v1.0.15 - 2026-06-18",
    items: [
      'Map preview shows author and current category (name + icon).',
      'Map preview image shows URL from host server.',
      'Review panel reorganized: Mapcode → Current Category → Submitter → Author → Actions.',
    ],
  },
]
