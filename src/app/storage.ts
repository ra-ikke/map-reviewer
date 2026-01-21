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
    const settings: AppState['settings'] = {
      ...DEFAULT_SETTINGS,
      ...parsedSettings,
      reviewHotkeys: {
        ...DEFAULT_SETTINGS.reviewHotkeys,
        ...(parsedSettings.reviewHotkeys ?? {}),
      },
      massPermHotkeys: {
        ...DEFAULT_SETTINGS.massPermHotkeys,
        ...(parsedSettings.massPermHotkeys ?? {}),
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

