import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import type { CommandMode } from './model'
import type { ExportPayloadV1 } from './export'
import type { ReviewedCategoryCode } from './categories'

export async function readClipboardText(): Promise<string | null> {
  const res = await invoke<string | null>('read_clipboard_text')
  return res ?? null
}

export async function writeClipboardText(text: string): Promise<void> {
  await invoke('write_clipboard_text', { text })
}

export async function openImportFileDialog(): Promise<string | null> {
  const res = await open({
    multiple: false,
    filters: [{ name: 'Text/CSV/JSON', extensions: ['txt', 'csv', 'json'] }],
  })

  if (typeof res === 'string') return res
  if (Array.isArray(res) && typeof res[0] === 'string') return res[0]
  return null
}

export async function openExportSaveDialog(defaultFileName = 'maps-reviewer-export.json'): Promise<string | null> {
  const res = await save({
    defaultPath: defaultFileName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  return typeof res === 'string' && res.trim() ? res : null
}

export interface AuthRole {
  id: string
  name: string
}

export interface AuthUser {
  id: string
  name: string
  username: string
  avatar: string
  roles: AuthRole[]
}

export interface AuthRecord {
  createdAt: string
  guildId: string
}

export interface AuthSuccess {
  ok: true
  token: string
  user: AuthUser
  record: AuthRecord
}

export interface AuthEnvelope {
  ok: boolean
  status: number
  data?: AuthSuccess
  error?: string
}

export async function validateAuthToken(token: string): Promise<AuthEnvelope> {
  return await invoke<AuthEnvelope>('validate_auth_token', { token })
}

export async function readTextFileFromPath(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path })
}

export async function startClipboardWatch(): Promise<void> {
  await invoke('start_clipboard_watch')
}

export async function stopClipboardWatch(): Promise<void> {
  await invoke('stop_clipboard_watch')
}

export async function onClipboardChanged(cb: (text: string) => void): Promise<UnlistenFn> {
  return await listen<string>('clipboard_changed', (event) => cb(event.payload))
}

export async function onHotkeyPlayCurrent(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_play_current', () => cb())
}

export async function onHotkeyReplayCurrent(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_replay_current', () => cb())
}

export async function onHotkeyNavPlay(cb: (delta: number) => void): Promise<UnlistenFn> {
  return await listen<{ delta: number }>('hotkey_nav_play', (event) => cb(event.payload.delta))
}

export async function onHotkeysStatus(cb: (enabled: boolean) => void): Promise<UnlistenFn> {
  return await listen<{ enabled: boolean }>('hotkeys_status', (event) => cb(Boolean(event.payload.enabled)))
}

export async function onMassPermHotkeysStatus(cb: (enabled: boolean) => void): Promise<UnlistenFn> {
  return await listen<{ enabled: boolean }>('massperm_hotkeys_status', (event) => cb(Boolean(event.payload.enabled)))
}

export async function setNpContext(args: { mapcode: string | null; commandMode: CommandMode }): Promise<void> {
  await invoke('set_np_context', { ctx: { mapcode: args.mapcode, commandMode: args.commandMode } })
}

export async function sendNpToActiveWindow(args: { mapcode: string; commandMode: CommandMode }): Promise<string> {
  return await invoke<string>('send_np_to_active_window', { args: { mapcode: args.mapcode, commandMode: args.commandMode } })
}

export async function sendPermToActiveWindow(args: { mapcode: string; categoryNumber: number }): Promise<string> {
  return await invoke<string>('send_perm_to_active_window', { args: { mapcode: args.mapcode, categoryNumber: args.categoryNumber } })
}

export async function sendCustomToActiveWindow(args: { mapcode: string; prefix: string; suffix?: string }): Promise<string> {
  return await invoke<string>('send_custom_to_active_window', {
    args: { mapcode: args.mapcode, prefix: args.prefix, suffix: args.suffix ?? null },
  })
}

export async function setMassPermHotkeysConfig(args: {
  enabled: boolean
  hotkeys: { toggle: string; playCurrent: string; next: string; prev: string }
}): Promise<void> {
  await invoke('set_massperm_hotkeys_enabled_cmd', { args })
}

export async function exportJsonToPath(path: string, payload: ExportPayloadV1): Promise<string> {
  return await invoke<string>('export_json', { path, payload })
}

export async function registerHotkeys(args?: {
  loadCurrent?: string
  prevMap?: string
  nextMap?: string
  replayCurrent?: string
}): Promise<void> {
  const payload = {
    loadCurrent: args?.loadCurrent ?? 'Ctrl+Alt+L',
    prevMap: args?.prevMap,
    nextMap: args?.nextMap,
    replayCurrent: args?.replayCurrent,
  }
  await invoke('register_hotkeys', { args: payload })
}

export async function setReviewHotkeysEnabled(enabled: boolean): Promise<void> {
  await invoke('set_review_hotkeys_enabled_cmd', { enabled })
}

export async function onHotkeyMassPermToggle(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_massperm_toggle', () => cb())
}

export async function onHotkeyMassPermPlayCurrent(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_massperm_play_current', () => cb())
}

export async function onHotkeyMassPermNext(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_massperm_next', () => cb())
}

export async function onHotkeyMassPermPrev(cb: () => void): Promise<UnlistenFn> {
  return await listen('hotkey_massperm_prev', () => cb())
}

export interface SessionApiMap {
  submitter: string
  mapCode: string
  ignored: boolean
  reason: string | null
}

export interface SessionApiSuccess {
  category: string
  threadId: string
  collectedAt: string
  limitPerUser: number
  maps: SessionApiMap[]
}

export interface SessionApiError {
  error: string
  category?: string
  threadId?: string
}

export interface SessionApiEnvelope {
  ok: boolean
  status: number
  data?: SessionApiSuccess
  error?: SessionApiError
}

export async function fetchSessionFromApi(categoryType: ReviewedCategoryCode): Promise<SessionApiEnvelope> {
  return await invoke<SessionApiEnvelope>('fetch_session_api', { categoryType })
}

export interface SubmitReviewEnvelope {
  ok: boolean
  status: number
  body?: string | null
  error?: string | null
}

export async function submitSessionReview(
  categoryType: string,
  payload: ExportPayloadV1,
  token?: string | null,
): Promise<SubmitReviewEnvelope> {
  return await invoke<SubmitReviewEnvelope>('submit_session_review_api', { categoryType, payload, token })
}

export interface MapInfoEntry {
  id: number
  author: string
  xml: string
  p: number
}

export interface MapInfoResponse {
  error: boolean
  data: MapInfoEntry[]
}

export async function fetchMapInfo(mapIds: number[]): Promise<MapInfoResponse> {
  return await invoke<MapInfoResponse>('fetch_map_info', { mapIds })
}

// -------------------------
// Updater (Tauri plugin)
// -------------------------
export type UpdaterDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number; accumulated: number; contentLength?: number } }
  | { event: 'Finished'; data: unknown }
  | { event: 'Installed'; data: unknown }
  | { event: string; data: any }

export interface UpdateAvailable {
  available: true
  version: string
  date?: string | null
  body?: string | null
  raw: any
}

export async function checkForUpdate(): Promise<UpdateAvailable | null> {
  const upd = await check()
  if (!upd || !upd.available) return null
  return {
    available: true,
    version: String(upd.version),
    date: (upd.date ?? null) as any,
    body: (upd.body ?? null) as any,
    raw: upd,
  }
}

export async function downloadAndInstallUpdate(update: UpdateAvailable, onEvent?: (ev: UpdaterDownloadEvent) => void): Promise<void> {
  await update.raw.downloadAndInstall(onEvent)
}

export async function relaunchApp(): Promise<void> {
  await relaunch()
}

export async function getAppVersion(): Promise<string> {
  return await getVersion()
}
