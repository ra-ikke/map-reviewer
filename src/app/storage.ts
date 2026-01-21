import { APP_VERSION, DEFAULT_SETTINGS, type AppState } from './model'

const STORAGE_KEY = 'maps-reviewer-state-v1'

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw) as AppState
    if (!parsed || typeof parsed !== 'object') return freshState()
    const session = parsed.session && typeof parsed.session === 'object' ? (parsed.session as AppState['session']) : null
    // migração leve: threadId pode ter sido salvo como number (perde precisão)
    if (session && typeof (session as any).threadId === 'number') {
      ;(session as any).threadId = String((session as any).threadId)
    }

    const parsedSettings = (parsed.settings ?? {}) as Partial<AppState['settings']>
    const baseMassPerm = parsedSettings.massPermHotkeys ?? {}
    const legacyToggle =
      (baseMassPerm as any).toggle ??
      (baseMassPerm as any).play ??
      DEFAULT_SETTINGS.massPermHotkeys.toggle
    const legacyPlayCurrent = (baseMassPerm as any).playCurrent ?? DEFAULT_SETTINGS.massPermHotkeys.playCurrent
    const legacyNext = (baseMassPerm as any).next ?? DEFAULT_SETTINGS.massPermHotkeys.next
    const legacyPrev = (baseMassPerm as any).prev ?? DEFAULT_SETTINGS.massPermHotkeys.prev

    const settings: AppState['settings'] = {
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      reviewHotkeys: {
        ...DEFAULT_SETTINGS.reviewHotkeys,
        ...(parsedSettings.reviewHotkeys ?? {}),
      },
      massPermHotkeys: {
        toggle: legacyToggle,
        playCurrent: legacyPlayCurrent,
        next: legacyNext,
        prev: legacyPrev,
      },
    }

    return {
      appVersion: parsed.appVersion ?? APP_VERSION,
      settings,
      session,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null,
    }
  } catch {
    return freshState()
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function freshState(): AppState {
  return {
    appVersion: APP_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    session: null,
    items: [],
    selectedId: null,
  }
}

