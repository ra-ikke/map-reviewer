import { APP_VERSION, DEFAULT_SETTINGS, type AppState } from './model'

const STORAGE_KEY = 'maps-reviewer-state-v1'

function isMacOs(): boolean {
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '') || /Mac OS X/.test(navigator.userAgent ?? '')
}

function getPlatformDefaults(): AppState['settings'] {
  if (!isMacOs()) {
    return { ...DEFAULT_SETTINGS }
  }

  return {
    ...DEFAULT_SETTINGS,
    reviewHotkeys: {
      ...DEFAULT_SETTINGS.reviewHotkeys,
      prevMap: 'Cmd+<',
      nextMap: 'Cmd+>',
      replayCurrent: 'Cmd+?',
    },
    massPermHotkeys: {
      ...DEFAULT_SETTINGS.massPermHotkeys,
      playCurrent: 'Cmd+?',
      next: 'Cmd+>',
      prev: 'Cmd+<',
    },
  }
}

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
    const platformDefaults = getPlatformDefaults()
    const baseMassPerm = parsedSettings.massPermHotkeys ?? {}
    const legacyToggle =
      (baseMassPerm as any).toggle ??
      (baseMassPerm as any).play ??
      platformDefaults.massPermHotkeys.toggle
    const legacyPlayCurrent = (baseMassPerm as any).playCurrent ?? platformDefaults.massPermHotkeys.playCurrent
    const legacyNext = (baseMassPerm as any).next ?? platformDefaults.massPermHotkeys.next
    const legacyPrev = (baseMassPerm as any).prev ?? platformDefaults.massPermHotkeys.prev

    const settings: AppState['settings'] = {
      ...platformDefaults,
      ...parsedSettings,
      reviewHotkeys: {
        ...platformDefaults.reviewHotkeys,
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
    settings: getPlatformDefaults(),
    session: null,
    items: [],
    selectedId: null,
  }
}

