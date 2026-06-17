export interface ReleaseNotesSection {
  title: string
  items: string[]
}

export const RELEASE_NOTES: ReleaseNotesSection[] = [
  {
    title: "What's New",
    items: [
      'Update check runs automatically when the app opens.',
      'Login screen shows the current version and release notes.',
      'Manual update check opens the install modal when available, or a toast when up to date.',
      'Live map API: refresh map data during review, map preview with URL and image.',
      'Session loading fetches Cypher data first, then live game data for missing maps.',
    ],
  },
]
