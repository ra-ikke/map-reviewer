import { normalizeMapcode, parseMapcodesFromText, uniqPreserveOrder } from './mapcodes'
import { APP_VERSION, type AppState, type QueueItem } from './model'
import { loadState, saveState } from './storage'
import { buildExportPayloadV1 } from './export'
import { CATEGORIES, REVIEW_CATEGORIES, parseCategoryNumber, type ReviewedCategoryCode } from './categories'
import {
  exportJsonToPath,
  validateAuthToken,
  fetchMapInfo,
  fetchSessionFromApi,
  submitSessionReview,
  openImportFileDialog,
  openExportSaveDialog,
  onHotkeyNavPlay,
  onHotkeyPlayCurrent,
  onHotkeyReplayCurrent,
  onHotkeysStatus,
  onHotkeyMassPermNext,
  onHotkeyMassPermPrev,
  onHotkeyMassPermPause,
  onHotkeyMassPermPlay,
  onMassPermHotkeysStatus,
  onClipboardChanged,
  checkForUpdate,
  downloadAndInstallUpdate,
  relaunchApp,
  getAppVersion,
  readClipboardText,
  readTextFileFromPath,
  registerHotkeys,
  setReviewHotkeysEnabled,
  setMassPermHotkeysConfig,
  writeClipboardText,
  sendNpToActiveWindow,
  setNpContext,
  sendPermToActiveWindow,
  sendCustomToActiveWindow,
  startClipboardWatch,
  stopClipboardWatch,
} from './tauri'

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function createItem(mapcode: string): QueueItem {
  const ts = nowIso()
  return {
    id: newId(),
    mapcode,
    author: null,
    xml: null,
    p: null,
    submitter: null,
    importedIgnored: null,
    importedReason: null,
    commandsUsed: [],
    review: '',
    decision: null,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }
}

const DECISION_LABEL: Record<NonNullable<QueueItem['decision']>, string> = {
  left_as_is: 'left as is',
  p1ed: "p1'ed",
  will_be_discussed: 'will be discussed',
  ignored: 'ignored',
}

const REVIEW_MAX_CHARS = 2000

export function initApp(root: HTMLElement): void {
  let state: AppState = loadState()
  let unlistenClipboard: (() => void) | null = null
  let clipboardDebounceTimer: number | null = null
  let clipboardPendingText: string | null = null
  let clipboardLastProcessed: string | null = null
  let detailsBoundId: string | null = null
  let reviewSaveTimer: number | null = null
  let authUser: { name: string; username: string; avatar: string; roles: Array<{ id: string; name: string }> } | null = null
  let authBusy = false
  let authed = false
  let authStatusMsg = ''
  let authAutoTried = false
  let updaterAutoTried = false
  let runtimeVersion = APP_VERSION

  // Mass perm (local UI state)
  let massPermMapcodes: string[] = []
  let massPermIndex = 0
  let massPermLastSentIndex: number | null = null
  let massPermRunning = false
  let massPermTimer: number | null = null
  let massPermInFlight = false
  let massPermCategoryCode: string = 'P4'
  let massPermHotkeysEnabled = true
  let massPermIntervalSec = 0.3

  // Custom command (local UI state)
  let customCmdMapcodes: string[] = []
  let customCmdIndex = 0
  let customCmdLastSentIndex: number | null = null
  let customCmdRunning = false
  let customCmdTimer: number | null = null
  let customCmdInFlight = false
  let customCmdPrefix = ''
  let customCmdSuffix = ''
  let customCmdIntervalSec = 0.3

  function updateCompactMode(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    document.body.classList.toggle('compact', w <= 520 || h <= 420)
  }
  window.addEventListener('resize', () => updateCompactMode())
  updateCompactMode()

  root.innerHTML = `
    <div id="appShell" class="layout">
      <header class="header">
        <div class="title">
          <div class="h1">Maps Reviewer</div>
          <button id="aboutBtn" class="sub linkBtn" type="button">
            v<span id="appVersion">${APP_VERSION}</span>
          </button>
        </div>
        <div class="actions">
          <button id="homeBtn" class="btn" style="display:none">Home</button>
          <button id="exportSessionBtn" class="btn" style="display:none">Backup</button>
          <button id="finishReviewBtn" class="btn primary" style="display:none">Finish Review</button>
          <button id="cancelSessionBtn" class="btn danger" style="display:none">Cancel session</button>

          <button id="newSession" class="btn danger">New session</button>
          <button id="exportJson" class="btn">Export JSON</button>
          <button id="openMassPerm" class="btn">Mass perm</button>
        </div>
        <div class="settings">
          <label class="field">
            <span>Command</span>
            <select id="commandMode">
              <option value="!np">!np</option>
              <option value="/np">/np</option>
              <option value="/npp">/npp</option>
            </select>
          </label>
          <label class="field checkbox">
            <input id="dedupe" type="checkbox" />
            <span>Deduplicate</span>
          </label>
        </div>
      </header>

      <main class="main">
        <section class="panel" id="inputPanel">
          <div class="panelTitle">Input</div>
          <textarea id="pasteInput" class="textarea" rows="6" placeholder="Paste mapcodes here (one per line)"></textarea>
          <div class="row">
            <button id="addFromPaste" class="btn primary">Add list</button>
            <button id="importFile" class="btn">Import file</button>
          </div>
          <div class="row">
            <label class="field">
              <span>Discord Session</span>
              <select id="apiCategory">
                ${REVIEW_CATEGORIES.map((c) => `<option value="${c.code}">${c.description}</option>`).join('')}
              </select>
            </label>
            <button id="importFromApi" class="btn">Import from Discord session</button>
          </div>
          <div class="row">
            <button id="addFromClipboard" class="btn">Add from clipboard</button>
            <label class="field checkbox">
              <input id="autoCapture" type="checkbox" />
              <span>Auto-capture clipboard</span>
            </label>
          </div>
          <div id="inputStatus" class="status"></div>
        </section>

        <section class="panel" id="queuePanel">
          <div class="row" style="justify-content: space-between; align-items: center;">
            <div class="panelTitle">Queue</div>
            <div class="row" style="justify-content: flex-end;">
              <label class="field">
                <span>Load cmd</span>
                <select id="queueCommandMode">
                  <option value="!np">!np</option>
                  <option value="/np">/np</option>
                  <option value="/npp">/npp</option>
                </select>
              </label>
              <label class="field checkbox" title="Global hotkeys: Ctrl+Alt+L = load | PageUp = prev+load | PageDown = next+load | Insert = replay (Use this checkbox to enable/disable)">
                <input id="reviewHotkeys" type="checkbox" />
                <span>Hotkeys</span>
              </label>
              <button id="reviewHotkeysConfig" class="btn">Config hotkeys</button>
              <label class="field checkbox">
                <input id="showIgnored" type="checkbox" />
                <span>Show ignored</span>
              </label>
            </div>
          </div>
          <div id="queue" class="queue"></div>
        </section>

        <section class="panel" id="detailsPanel">
          <div class="panelTitle">Review</div>
          <div id="details" class="details muted">Select a mapcode from the queue.</div>
        </section>
      </main>
    </div>

    <div id="wizard" class="wizardOverlay" style="display:none"></div>
    <div id="massPerm" class="wizardOverlay" style="display:none"></div>
    <div id="confirmLeave" class="wizardOverlay" style="display:none"></div>
    <div id="confirmFinishReview" class="wizardOverlay" style="display:none"></div>
    <div id="submitReviewResult" class="wizardOverlay" style="display:none"></div>
    <div id="updateModal" class="wizardOverlay" style="display:none"></div>
    <div id="authOverlay" class="wizardOverlay" style="display:none"></div>
    <div id="confirmMassPermLeave" class="wizardOverlay" style="display:none"></div>
    <div id="aboutModal" class="wizardOverlay" style="display:none"></div>
    <div id="hotkeysModal" class="wizardOverlay" style="display:none"></div>
    <div id="customCommand" class="wizardOverlay" style="display:none"></div>
  `

  const els = {
    appShell: root.querySelector<HTMLDivElement>('#appShell')!,
    aboutBtn: root.querySelector<HTMLButtonElement>('#aboutBtn')!,
    appVersion: root.querySelector<HTMLSpanElement>('#appVersion')!,
    commandMode: root.querySelector<HTMLSelectElement>('#commandMode')!,
    dedupe: root.querySelector<HTMLInputElement>('#dedupe')!,
    pasteInput: root.querySelector<HTMLTextAreaElement>('#pasteInput')!,
    addFromPaste: root.querySelector<HTMLButtonElement>('#addFromPaste')!,
    importFile: root.querySelector<HTMLButtonElement>('#importFile')!,
    apiCategory: root.querySelector<HTMLSelectElement>('#apiCategory')!,
    importFromApi: root.querySelector<HTMLButtonElement>('#importFromApi')!,
    newSession: root.querySelector<HTMLButtonElement>('#newSession')!,
    exportJson: root.querySelector<HTMLButtonElement>('#exportJson')!,
    openMassPerm: root.querySelector<HTMLButtonElement>('#openMassPerm')!,
    homeBtn: root.querySelector<HTMLButtonElement>('#homeBtn')!,
    exportSessionBtn: root.querySelector<HTMLButtonElement>('#exportSessionBtn')!,
    finishReviewBtn: root.querySelector<HTMLButtonElement>('#finishReviewBtn')!,
    cancelSessionBtn: root.querySelector<HTMLButtonElement>('#cancelSessionBtn')!,
    addFromClipboard: root.querySelector<HTMLButtonElement>('#addFromClipboard')!,
    autoCapture: root.querySelector<HTMLInputElement>('#autoCapture')!,
    inputStatus: root.querySelector<HTMLDivElement>('#inputStatus')!,
    queue: root.querySelector<HTMLDivElement>('#queue')!,
    queueCommandMode: root.querySelector<HTMLSelectElement>('#queueCommandMode')!,
    reviewHotkeys: root.querySelector<HTMLInputElement>('#reviewHotkeys')!,
    reviewHotkeysConfig: root.querySelector<HTMLButtonElement>('#reviewHotkeysConfig')!,
    showIgnored: root.querySelector<HTMLInputElement>('#showIgnored')!,
    details: root.querySelector<HTMLDivElement>('#details')!,
    wizard: root.querySelector<HTMLDivElement>('#wizard')!,
    massPerm: root.querySelector<HTMLDivElement>('#massPerm')!,
    confirmLeave: root.querySelector<HTMLDivElement>('#confirmLeave')!,
    confirmFinishReview: root.querySelector<HTMLDivElement>('#confirmFinishReview')!,
    submitReviewResult: root.querySelector<HTMLDivElement>('#submitReviewResult')!,
    updateModal: root.querySelector<HTMLDivElement>('#updateModal')!,
    aboutModal: root.querySelector<HTMLDivElement>('#aboutModal')!,
    hotkeysModal: root.querySelector<HTMLDivElement>('#hotkeysModal')!,
    customCommand: root.querySelector<HTMLDivElement>('#customCommand')!,
    authOverlay: root.querySelector<HTMLDivElement>('#authOverlay')!,
    confirmMassPermLeave: root.querySelector<HTMLDivElement>('#confirmMassPermLeave')!,
    settings: root.querySelector<HTMLDivElement>('.settings')!,
  }

  async function hydrateAppVersion(): Promise<void> {
    try {
      const v = await getAppVersion()
      if (v && els.appVersion) {
        runtimeVersion = v
        els.appVersion.textContent = v
      }
    } catch {
      // fallback to static APP_VERSION when not running in Tauri
    }
  }

  function setStatus(msg: string): void {
    els.inputStatus.textContent = msg
  }

  function setMassPermStatus(msg: string): void {
    const el = els.massPerm.querySelector<HTMLDivElement>('#mpStatus')
    if (el) el.textContent = msg
  }

  function setCustomCommandStatus(msg: string): void {
    const el = els.customCommand.querySelector<HTMLDivElement>('#ccStatus')
    if (el) el.textContent = msg
  }

  function persist(): void {
    saveState(state)
  }

  function setSessionHeaderMode(active: boolean): void {
    els.homeBtn.style.display = active ? 'inline-flex' : 'none'
    els.exportSessionBtn.style.display = active ? 'inline-flex' : 'none'
    els.finishReviewBtn.style.display = active ? 'inline-flex' : 'none'
    els.cancelSessionBtn.style.display = active ? 'inline-flex' : 'none'

    els.newSession.style.display = active ? 'none' : 'inline-flex'
    els.exportJson.style.display = active ? 'none' : 'inline-flex'
    els.openMassPerm.style.display = active ? 'none' : 'inline-flex'

    // quando sessão está ativa, esconde settings (pedido: apenas 3 botões)
    els.settings.style.display = active ? 'none' : 'flex'
  }

  function setShellVisible(visible: boolean): void {
    els.appShell.style.display = visible ? 'flex' : 'none'
  }

  function getUnreviewedCount(): number {
    // Rule: can only finish when every map has a decision selected (decision != null)
    return state.items.filter((it) => !it.decision).length
  }

  function getUnreviewedMapcodes(): string[] {
    return state.items
      .filter((it) => !it.decision)
      .map((it) => `@${String(it.mapcode).replace(/^@+/, '')}`)
  }

  function updateFinishReviewButtonState(): void {
    // Only relevant when a session is active (button is hidden otherwise)
    if (!state.session) return
    const total = state.items.length
    const remaining = getUnreviewedCount()
    const canFinish = total > 0 && remaining === 0

    // Keep the button clickable so we can show the modal with the missing map list.
    // The actual finishing action is blocked inside the modal.
    els.finishReviewBtn.disabled = false
    els.finishReviewBtn.textContent = canFinish ? 'Finish Review' : `Finish Review (${remaining} remaining)`
    els.finishReviewBtn.title = canFinish
      ? 'Finish review'
      : total === 0
        ? 'Add maps to the queue before finishing.'
        : `You must review all maps before finishing. Remaining: ${remaining}.`
  }

  function setAuthVisible(visible: boolean): void {
    els.authOverlay.style.display = visible ? 'grid' : 'none'
    if (visible) {
      // garante que nada “fure” o login
      els.wizard.style.display = 'none'
      els.massPerm.style.display = 'none'
      els.customCommand.style.display = 'none'
      els.confirmLeave.style.display = 'none'
      els.confirmFinishReview.style.display = 'none'
      els.submitReviewResult.style.display = 'none'
      els.updateModal.style.display = 'none'
      els.confirmMassPermLeave.style.display = 'none'
      setShellVisible(false)
    }
  }

  function openUpdateModal(args: { version: string; body?: string | null }): void {
    els.updateModal.style.display = 'grid'
    const notes = (args.body ?? '').toString().trim()
    els.updateModal.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Update available</div>
            <div class="wizardHint">A new version is available: <b>${args.version}</b></div>
          </div>
        </div>
        <div class="wizardBody">
          ${
            notes
              ? `<div class="kv">
                  <div class="k">Release notes</div>
                  <div class="v" style="white-space: pre-wrap; word-break: break-word;">${notes}</div>
                </div>`
              : `<div class="wizardHint">No release notes.</div>`
          }
          <div class="status" id="updStatus"></div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="updLater">Later</button>
          </div>
          <div class="wizardFooterRight">
            <button class="btn primary" id="updInstall">Install update</button>
          </div>
        </div>
      </div>
    `

    const updLater = els.updateModal.querySelector<HTMLButtonElement>('#updLater')!
    const updInstall = els.updateModal.querySelector<HTMLButtonElement>('#updInstall')!
    const updStatus = els.updateModal.querySelector<HTMLDivElement>('#updStatus')!

    const close = () => {
      els.updateModal.style.display = 'none'
      els.updateModal.innerHTML = ''
    }

    updLater.addEventListener('click', () => close())
    updInstall.addEventListener('click', async () => {
      updInstall.disabled = true
      updLater.disabled = true
      updStatus.textContent = 'Downloading update…'
      try {
        // We re-check to get the update handle bound to this run.
        const upd = await checkForUpdate()
        if (!upd) {
          updStatus.textContent = 'Update is no longer available.'
          updLater.disabled = false
          return
        }

        await downloadAndInstallUpdate(upd, (ev) => {
          if (ev.event === 'Started') {
            updStatus.textContent = 'Download started…'
          } else if (ev.event === 'Progress') {
            const total = ev.data?.contentLength
            const acc = ev.data?.accumulated
            if (typeof total === 'number' && typeof acc === 'number' && total > 0) {
              const pct = Math.floor((acc / total) * 100)
              updStatus.textContent = `Downloading… ${pct}%`
            } else {
              updStatus.textContent = 'Downloading…'
            }
          } else if (ev.event === 'Finished') {
            updStatus.textContent = 'Installing…'
          } else if (ev.event === 'Installed') {
            updStatus.textContent = 'Installed. Restarting…'
          }
        })

        await relaunchApp()
      } catch (e) {
        updStatus.textContent = `Update failed: ${String(e)}`
        updInstall.disabled = false
        updLater.disabled = false
      }
    })
  }

  function openAboutModal(): void {
    els.aboutModal.style.display = 'grid'
    const v = runtimeVersion || APP_VERSION
    els.aboutModal.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">About</div>
            <div class="wizardHint">Maps Reviewer</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Version</div>
            <div class="v">v${v} (tag v${v})</div>
          </div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterRight">
            <button class="btn primary" id="aboutClose">OK</button>
          </div>
        </div>
      </div>
    `

    const closeBtn = els.aboutModal.querySelector<HTMLButtonElement>('#aboutClose')!
    const close = () => {
      els.aboutModal.style.display = 'none'
      els.aboutModal.innerHTML = ''
    }
    closeBtn.addEventListener('click', () => close())
  }

  async function checkForUpdatesOnBoot(): Promise<void> {
    if (updaterAutoTried) return
    updaterAutoTried = true
    try {
      const upd = await checkForUpdate()
      if (!upd) return
      openUpdateModal({ version: upd.version, body: upd.body })
    } catch {
      // silent (best effort)
    }
  }

  function renderAuth(): void {
    setAuthVisible(true)
    const saved = (state.settings.authToken ?? '').trim()
    els.authOverlay.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Authentication</div>
            <div class="wizardHint">Enter your token to access the app.</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Token</div>
            <div class="v">
              <input id="authTokenInput" class="textarea" style="min-height:auto; height:34px; padding:6px 10px;" type="password" placeholder="Paste your token here" value="${saved}" />
            </div>
          </div>
          <div class="row">
            <button class="btn primary" id="authValidate">${authBusy ? 'Validating…' : 'Validate token'}</button>
            <button class="btn" id="authClear">Change token</button>
          </div>
          <div class="status" id="authStatus">${authStatusMsg}</div>

          ${
            authUser
              ? `
                <div style="margin-top: 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 12px;">
                  <div class="row" style="align-items:center; gap:12px;">
                    <img src="${authUser.avatar}" alt="avatar" style="width:56px; height:56px; border-radius: 12px; object-fit: cover;" />
                    <div>
                      <div style="font-weight:700;">${authUser.name}</div>
                      <div class="wizardHint">@${authUser.username}</div>
                    </div>
                  </div>
                  <div style="margin-top: 10px; display:flex; flex-wrap:wrap; gap:6px;">
                    ${authUser.roles
                      .map((r) => `<span style="padding:4px 8px; border-radius: 999px; background: rgba(255,255,255,.06);">${r.name}</span>`)
                      .join('')}
                  </div>
                </div>
              `
              : ''
          }
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="authCheckUpdates">Check for updates</button>
          </div>
          <div class="wizardFooterRight">
            <button class="btn primary" id="authContinue" ${authed ? '' : 'disabled'}>Continue</button>
          </div>
        </div>
      </div>
    `

    const input = els.authOverlay.querySelector<HTMLInputElement>('#authTokenInput')!
    const validateBtn = els.authOverlay.querySelector<HTMLButtonElement>('#authValidate')!
    const clearBtn = els.authOverlay.querySelector<HTMLButtonElement>('#authClear')!
    const checkUpdatesBtn = els.authOverlay.querySelector<HTMLButtonElement>('#authCheckUpdates')!
    const contBtn = els.authOverlay.querySelector<HTMLButtonElement>('#authContinue')!

    const doValidate = async () => {
      const tok = input.value.trim()
      if (!tok) {
        authStatusMsg = 'Paste a token to validate.'
        renderAuth()
        return
      }
      authBusy = true
      authed = false
      authUser = null
      authStatusMsg = 'Validating token…'
      renderAuth()
      try {
        const res = await validateAuthToken(tok)
        if (res?.ok && res.data?.ok && res.data.user) {
          // salva token e libera app
          updateSettings({ authToken: tok, authUserId: res.data.user.id })
          authUser = {
            name: res.data.user.name,
            username: res.data.user.username,
            avatar: res.data.user.avatar,
            roles: res.data.user.roles ?? [],
          }
          authed = true
          authStatusMsg = 'Token is valid.'
        } else {
          updateSettings({ authToken: null, authUserId: null })
          authed = false
          authUser = null
          authStatusMsg = `Invalid token. ${res?.error ? String(res.error) : ''}`.trim()
        }
      } catch (e) {
        authed = false
        authUser = null
        authStatusMsg = `Failed to validate token: ${String(e)}`
      } finally {
        authBusy = false
        renderAuth()
      }
    }

    validateBtn.addEventListener('click', () => void doValidate())
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        void doValidate()
      }
    })

    clearBtn.addEventListener('click', () => {
      updateSettings({ authToken: null, authUserId: null })
      authUser = null
      authed = false
      authBusy = false
      authStatusMsg = ''
      renderAuth()
    })

    checkUpdatesBtn.addEventListener('click', async () => {
      if (authBusy) return
      checkUpdatesBtn.disabled = true
      authStatusMsg = 'Checking for updates…'
      renderAuth()
      try {
        const upd = await checkForUpdate()
        if (!upd) {
          authStatusMsg = 'You are up to date.'
          renderAuth()
          return
        }
        authStatusMsg = ''
        renderAuth()
        openUpdateModal({ version: upd.version, body: upd.body })
      } catch (e) {
        authStatusMsg = `Failed to check updates: ${String(e)}`
        renderAuth()
      } finally {
        // button will be recreated on renderAuth()
      }
    })

    contBtn.addEventListener('click', () => {
      if (!authed) return
      setAuthVisible(false)
      afterAuth()
    })

    // auto-validate se já tem token salvo (uma vez por boot)
    if (!authAutoTried && !authBusy && !authed && saved) {
      authAutoTried = true
      void doValidate()
    }
  }

  function afterAuth(): void {
    // libera UI
    render()
    syncNp()
    setShellVisible(true)
    void checkForUpdatesOnBoot()

    // se já existe sessão salva, trava categoria
    if (state.session?.category) {
      const code = state.session.category as ReviewedCategoryCode
      els.apiCategory.value = code
      els.apiCategory.disabled = true
    }

    // se não há sessão, abre wizard ao iniciar
    if (!state.session) {
      openLauncher()
    }
  }

  function endCurrentSession(): void {
    state.session = null
    state.items = []
    state.selectedId = null
    detailsBoundId = null
    persist()
    render()
    syncNp()
    // destrava seletor de categoria (quando sessão era travada)
    els.apiCategory.disabled = false
  }

  async function maybeExportBeforeLeaving(): Promise<boolean> {
    try {
      const path = await openExportSaveDialog(getDefaultSessionExportFileName())
      if (!path) return false
      const payload = buildExportPayloadV1(state, undefined, { includeXml: false })
      await exportJsonToPath(path, payload)
      return true
    } catch (e) {
      setStatus(`Failed to export JSON: ${String(e)}`)
      return false
    }
  }

  function getDefaultSessionExportFileName(): string {
    const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const category = (state.session?.category || 'unknown').toString().trim() || 'unknown'
    return `session_${category}_${date}.json`
  }

  function getDefaultBackupExportFileName(): string {
    const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const category = (state.session?.category || 'unknown').toString().trim() || 'unknown'
    return `backup_${category}_${date}.json`
  }

  let launcherAllowReturnToSession = false

  function openConfirmLeave(intent: 'home' | 'cancel'): void {
    els.confirmLeave.style.display = 'grid'
    els.confirmLeave.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Leave current session?</div>
            <div class="wizardHint">You can export the session JSON before leaving.</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Action</div>
            <div class="v">${intent === 'home' ? 'Go home' : 'Cancel session'}</div>
          </div>
          <div class="wizardHint">
            Leaving will clear the queue and the current session state.
          </div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="clCancel">Cancel</button>
          </div>
          <div class="wizardFooterRight">
            <button class="btn" id="clLeave">Leave without saving</button>
            <button class="btn primary" id="clSaveLeave">Save JSON & leave</button>
          </div>
        </div>
      </div>
    `

    const clCancel = els.confirmLeave.querySelector<HTMLButtonElement>('#clCancel')!
    const clLeave = els.confirmLeave.querySelector<HTMLButtonElement>('#clLeave')!
    const clSaveLeave = els.confirmLeave.querySelector<HTMLButtonElement>('#clSaveLeave')!

    const close = () => {
      els.confirmLeave.style.display = 'none'
      els.confirmLeave.innerHTML = ''
    }

    clCancel.addEventListener('click', () => close())

    clLeave.addEventListener('click', () => {
      close()
      if (intent === 'cancel') {
        endCurrentSession()
        openLauncher({ allowReturnToSession: false })
        setStatus('Session cancelled.')
      } else {
        // home: volta ao carrossel, mas mantém sessão ativa para "return"
        openLauncher({ allowReturnToSession: true })
        setStatus('Left session (still active).')
      }
    })

    clSaveLeave.addEventListener('click', async () => {
      const ok = await maybeExportBeforeLeaving()
      if (!ok) return // se usuário cancelou save dialog ou falhou, fica no modal
      close()
      if (intent === 'cancel') {
        endCurrentSession()
        openLauncher({ allowReturnToSession: false })
        setStatus('Session exported and closed.')
      } else {
        openLauncher({ allowReturnToSession: true })
        setStatus('Session exported. (Still active)')
      }
    })
  }

  function openConfirmFinishReview(): void {
    if (!state.session) return

    const total = state.items.length
    const remaining = getUnreviewedCount()
    const canFinish = total > 0 && remaining === 0
    const missingMapcodes = getUnreviewedMapcodes()

    els.confirmFinishReview.style.display = 'grid'
    els.confirmFinishReview.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Finish review?</div>
            <div class="wizardHint">${
              canFinish
                ? 'This will save the session file (without XML) and return to Home.'
                : `You can only finish when all maps have a decision selected. Remaining: ${remaining}.`
            }</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Category</div>
            <div class="v">${String(state.session.category)}</div>
          </div>
          ${
            !canFinish && missingMapcodes.length
              ? `
                <div class="kv">
                  <div class="k">Maps still pending</div>
                  <div class="v" style="max-height: 180px; overflow: auto; display:flex; flex-wrap:wrap; gap:6px;">
                    ${missingMapcodes
                      .slice(0, 200)
                      .map((mc) => `<span class="mono" style="padding:4px 8px; border-radius:999px; background: rgba(255,255,255,.06);">${mc}</span>`)
                      .join('')}
                    ${missingMapcodes.length > 200 ? `<span class="wizardHint">(+${missingMapcodes.length - 200} more)</span>` : ''}
                  </div>
                </div>
              `
              : ''
          }
          <div class="wizardHint">
            After finishing, the current session will be closed.
          </div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="frCancel">Cancel</button>
          </div>
          ${
            canFinish
              ? `
                <div class="wizardFooterRight">
                  <button class="btn primary" id="frFinish">Save & finish</button>
                </div>
              `
              : ''
          }
        </div>
      </div>
    `

    const frCancel = els.confirmFinishReview.querySelector<HTMLButtonElement>('#frCancel')!
    const frFinish = els.confirmFinishReview.querySelector<HTMLButtonElement>('#frFinish')

    const close = () => {
      els.confirmFinishReview.style.display = 'none'
      els.confirmFinishReview.innerHTML = ''
    }

    frCancel.addEventListener('click', () => close())

    frFinish?.addEventListener('click', async () => {
      try {
        const category = String(state.session?.category ?? '').trim()
        if (!category) {
          setStatus('Missing session category.')
          return
        }

        const path = await openExportSaveDialog(getDefaultSessionExportFileName())
        if (!path) return // usuário cancelou o save dialog -> continua no modal
        const payload = buildExportPayloadV1(state, undefined, { includeXml: false })
        const finalPath = await exportJsonToPath(path, payload)
        close()

        // envia review para Discord Session API (best effort)
        let submitOk = false
        let submitStatus = 0
        let submitMsg: string | null = null
        try {
          const res = await submitSessionReview(category, payload, state.settings.authToken)
          submitOk = Boolean(res?.ok)
          submitStatus = Number(res?.status ?? 0)
          submitMsg = (res?.error ?? res?.body ?? null) as any
        } catch (e) {
          submitOk = false
          submitStatus = 0
          submitMsg = String(e)
        }

        endCurrentSession()
        openLauncher({ allowReturnToSession: false })
        setStatus(`Session saved: ${finalPath}`)

        openSubmitReviewResultModal({
          ok: submitOk,
          status: submitStatus,
          message: submitMsg,
          category,
          filePath: finalPath,
        })
      } catch (e) {
        setStatus(`Failed to finish review: ${String(e)}`)
      }
    })
  }

  function openSubmitReviewResultModal(args: {
    ok: boolean
    status: number
    message: string | null
    category: string
    filePath: string
  }): void {
    els.submitReviewResult.style.display = 'grid'
    const title = args.ok ? 'Review submitted' : 'Failed to submit review'
    const hint = args.ok
      ? 'The review was sent to Discord successfully.'
      : 'The review could not be sent to Discord. You can retry later using the saved JSON.'

    els.submitReviewResult.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">${title}</div>
            <div class="wizardHint">${hint}</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Category</div>
            <div class="v">${args.category}</div>
          </div>
          <div class="kv">
            <div class="k">HTTP</div>
            <div class="v">${args.status || '-'}</div>
          </div>
          <div class="kv">
            <div class="k">File</div>
            <div class="v">${basename(args.filePath)}</div>
          </div>
          ${
            args.message
              ? `<div class="wizardHint" style="white-space: pre-wrap; word-break: break-word; margin-top: 10px;">${String(args.message)}</div>`
              : ''
          }
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterRight">
            <button class="btn primary" id="srOk">OK</button>
          </div>
        </div>
      </div>
    `

    const srOk = els.submitReviewResult.querySelector<HTMLButtonElement>('#srOk')!
    const close = () => {
      els.submitReviewResult.style.display = 'none'
      els.submitReviewResult.innerHTML = ''
    }
    srOk.addEventListener('click', () => close())
  }

  function syncNp(): void {
    const sel = getSelected()
    void setNpContext({ mapcode: sel?.mapcode ?? null, commandMode: state.settings.commandMode }).catch(() => {
      // best effort
    })
  }

  function select(id: string | null): void {
    state.selectedId = id
    persist()
    render()
    syncNp()
  }

  function addMapcodes(mapcodes: string[], sourceLabel: string): void {
    const normalized = uniqPreserveOrder(mapcodes)
    if (!normalized.length) {
      setStatus('Nothing to add.')
      return
    }

    const existing = new Set(state.items.map((i) => i.mapcode))
    const toAdd: string[] = []
    for (const mc of normalized) {
      if (state.settings.dedupe && existing.has(mc)) continue
      toAdd.push(mc)
    }

    const addedItems: QueueItem[] = []
    for (const mc of toAdd) {
      const it = createItem(mc)
      state.items.push(it)
      addedItems.push(it)
    }

    if (!state.selectedId && state.items.length > 0) {
      state.selectedId = state.items[0]!.id
    }

    persist()
    render()
    syncNp()
    setStatus(`Added ${toAdd.length} mapcode(s) (${sourceLabel}).`)

    void hydrateMapInfoForItems(addedItems).catch(() => {
      // best effort
    })
  }

  function normalizeCategorySelection(codeOrNumber: string): { code: string; number: number | null } {
    const t = codeOrNumber.trim()
    if (!t) return { code: 'P4', number: 4 }
    const code = t.toUpperCase().startsWith('P') ? t.toUpperCase() : `P${t.toUpperCase()}`
    return { code, number: parseCategoryNumber(code) }
  }

  function extractMapcodesFromTextOrSessionJson(text: string): string[] {
    const trimmed = text.trim()
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as any
        const maps = Array.isArray(obj?.maps) ? obj.maps : null
        if (maps) {
          const raw = maps
            .filter((m: any) => typeof m?.mapCode === 'string')
            .map((m: any) => String(m.mapCode))
            .join('\n')
          return parseMapcodesFromText(raw)
        }
      } catch {
        // fallback
      }
    }
    return parseMapcodesFromText(text)
  }

  function stopMassPerm(): void {
    massPermRunning = false
    massPermInFlight = false
    if (massPermTimer) {
      window.clearInterval(massPermTimer)
      massPermTimer = null
    }
  }

  function stopCustomCommand(): void {
    customCmdRunning = false
    customCmdInFlight = false
    if (customCmdTimer) {
      window.clearInterval(customCmdTimer)
      customCmdTimer = null
    }
  }

  function resetMassPermData(): void {
    stopMassPerm()
    massPermMapcodes = []
    massPermIndex = 0
    massPermLastSentIndex = null
    massPermCategoryCode = 'P4'
    massPermHotkeysEnabled = true
    massPermIntervalSec = 0.3
  }

  function resetCustomCommandData(): void {
    stopCustomCommand()
    customCmdMapcodes = []
    customCmdIndex = 0
    customCmdLastSentIndex = null
    customCmdPrefix = ''
    customCmdSuffix = ''
    customCmdIntervalSec = 0.3
  }

  function openConfirmMassPermLeave(): void {
    // só deve ser possível quando pausado/não iniciado
    if (massPermRunning || massPermInFlight) return

    els.confirmMassPermLeave.style.display = 'grid'
    els.confirmMassPermLeave.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Leave mass perm?</div>
            <div class="wizardHint">This will clear the mass perm list and progress.</div>
          </div>
        </div>
        <div class="wizardBody">
          <div class="kv">
            <div class="k">Action</div>
            <div class="v">Go back to Home</div>
          </div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="mpLeaveCancel">Cancel</button>
          </div>
          <div class="wizardFooterRight">
            <button class="btn danger" id="mpLeaveConfirm">Leave to Home</button>
          </div>
        </div>
      </div>
    `

    const close = () => {
      els.confirmMassPermLeave.style.display = 'none'
      els.confirmMassPermLeave.innerHTML = ''
    }

    const cancel = els.confirmMassPermLeave.querySelector<HTMLButtonElement>('#mpLeaveCancel')!
    const confirm = els.confirmMassPermLeave.querySelector<HTMLButtonElement>('#mpLeaveConfirm')!
    cancel.addEventListener('click', () => close())
    confirm.addEventListener('click', () => {
      close()
      void applyMassPermHotkeysConfig(false).catch(() => {
        // best effort
      })
      resetMassPermData()
      els.massPerm.style.display = 'none'
      openLauncher({ allowReturnToSession: Boolean(state.session) })
      setStatus('Mass perm cancelled.')
    })
  }

  async function massPermSendPerm(mapcode: string, categoryNumber: number, label: string): Promise<void> {
    try {
      const cmd = await sendPermToActiveWindow({ mapcode, categoryNumber })
      setMassPermStatus(`${label}: sent ${cmd}`)
    } catch (e) {
      setMassPermStatus(`${label}: failed (${String(e)})`)
    }
  }

  function buildCustomCommandPreview(prefix: string, suffix: string, mapcode: string): string {
    const p = prefix.trim() || '/<prefix>'
    const s = suffix.trim()
    const mc = `@${String(mapcode).replace(/^@+/, '') || 'mapcode'}`
    const raw = s ? `${p} ${mc} ${s}` : `${p} ${mc}`
    return raw.replace(/\s+@/, ' @').trim()
  }

  async function customCommandSend(mapcode: string, prefix: string, suffix: string, label: string): Promise<void> {
    try {
      const cmd = await sendCustomToActiveWindow({ mapcode, prefix, suffix })
      setCustomCommandStatus(`${label}: sent ${cmd}`)
    } catch (e) {
      setCustomCommandStatus(`${label}: failed (${String(e)})`)
    }
  }

  function renderMassPerm(): void {
    const categoriesOptions = CATEGORIES.map(
      (c) => `<option value="${c.code}">${c.code} — ${c.description}</option>`,
    ).join('')

    const sel = normalizeCategorySelection(massPermCategoryCode)
    const previewMap = massPermMapcodes[massPermIndex] ?? massPermMapcodes[0] ?? '@mapcode'
    const previewMapClean = `@${String(previewMap).replace(/^@+/, '') || 'mapcode'}`
    const previewPerm = sel.number != null ? `/p ${sel.number} ${previewMapClean}` : `/p <n> ${previewMapClean}`

    const total = massPermMapcodes.length
    const done = Math.min(massPermIndex, total)
    const current = massPermMapcodes[massPermIndex] ?? null
    const last = massPermLastSentIndex != null ? massPermMapcodes[massPermLastSentIndex] ?? null : null
    const canCancelToHome = !massPermRunning && !massPermInFlight
    const canManualNav = !massPermRunning && !massPermInFlight
    const hkLabel = massPermHotkeysEnabled ? 'enabled' : 'disabled'
    const mpKeys = state.settings.massPermHotkeys
    const intervalLabel = `${massPermIntervalSec.toFixed(1)}s`
    const intervalOptions = Array.from({ length: 10 }, (_, i) => (i + 1) / 10).map((v) => {
      const label = `${v.toFixed(1)}s`
      const selected = Math.abs(v - massPermIntervalSec) < 0.0001 ? 'selected' : ''
      return `<option value="${v.toFixed(1)}" ${selected}>${label}</option>`
    })

    els.massPerm.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Mass perm</div>
            <div class="wizardHint">Sends commands every <b>${intervalLabel}</b> to the active window.</div>
          </div>
        </div>

        <div class="wizardBody">
          <div class="row">
            <label class="field">
              <span>Target category</span>
              <select id="mpCategory">${categoriesOptions}</select>
            </label>
            <div class="wizardHint" id="mpTargetHint">Resolved: <b>${sel.code}</b> (${sel.number ?? 'N/A'})</div>
            <div class="wizardHint">Preview: <b>${previewPerm}</b></div>
          </div>

          <div class="kv">
            <div class="k">Map list</div>
            <textarea id="mpTextarea" class="textarea" rows="6" placeholder="Paste mapcodes here (one per line)"></textarea>
            <div class="row">
              <button class="btn primary" id="mpAddTextarea">Load from textarea</button>
              <button class="btn" id="mpFromClipboard">Load from clipboard</button>
              <button class="btn" id="mpFromFile">Import file</button>
              <button class="btn danger" id="mpClearList">Clear list</button>
            </div>
            <div class="status" id="mpStatus"></div>
          </div>

          <div class="kv">
            <div class="k">Progress</div>
            <div class="v mono">Done: ${done}/${total}</div>
            <div class="v mono">Current: ${current ? `@${current}` : '—'}</div>
            <div class="v mono">Last: ${last ? `@${last}` : '—'}</div>
          </div>

          <label class="field">
            <span>Interval</span>
            <select id="mpInterval">
              ${intervalOptions.join('')}
            </select>
          </label>

          <label class="field checkbox">
            <input id="mpHotkeys" type="checkbox" ${massPermHotkeysEnabled ? 'checked' : ''} />
            <span>Enable hotkeys (play: ${mpKeys.play}, pause: ${mpKeys.pause}, next: ${mpKeys.next}, back: ${mpKeys.prev})</span>
          </label>

          <div class="row">
            <button class="btn primary" id="mpPlay" title="Hotkey: ${mpKeys.play} (${hkLabel})">${massPermRunning ? 'Running…' : 'Play / Resume'}</button>
            <button class="btn" id="mpPause" title="Hotkey: ${mpKeys.pause} (${hkLabel})">Pause</button>
            <button class="btn" id="mpPrev" title="Hotkey: ${mpKeys.prev} (${hkLabel})" ${canManualNav ? '' : 'disabled'}>Back</button>
            <button class="btn" id="mpNext" title="Hotkey: ${mpKeys.next} (${hkLabel})" ${canManualNav ? '' : 'disabled'}>Next map</button>
            <button class="btn danger" id="mpCancel" ${canCancelToHome ? '' : 'disabled'}>Cancel</button>
            <button class="btn" id="mpHotkeysConfig">Config hotkeys</button>
          </div>
        </div>
      </div>
    `

    // bind controls
    const mpCategory = els.massPerm.querySelector<HTMLSelectElement>('#mpCategory')!
    const mpTextarea = els.massPerm.querySelector<HTMLTextAreaElement>('#mpTextarea')!
    const mpAddTextarea = els.massPerm.querySelector<HTMLButtonElement>('#mpAddTextarea')!
    const mpFromClipboard = els.massPerm.querySelector<HTMLButtonElement>('#mpFromClipboard')!
    const mpFromFile = els.massPerm.querySelector<HTMLButtonElement>('#mpFromFile')!
    const mpClearList = els.massPerm.querySelector<HTMLButtonElement>('#mpClearList')!
    const mpPlay = els.massPerm.querySelector<HTMLButtonElement>('#mpPlay')!
    const mpPause = els.massPerm.querySelector<HTMLButtonElement>('#mpPause')!
    const mpPrev = els.massPerm.querySelector<HTMLButtonElement>('#mpPrev')!
    const mpNext = els.massPerm.querySelector<HTMLButtonElement>('#mpNext')!
    const mpCancel = els.massPerm.querySelector<HTMLButtonElement>('#mpCancel')!
    const mpHotkeysConfig = els.massPerm.querySelector<HTMLButtonElement>('#mpHotkeysConfig')!
    const mpHotkeys = els.massPerm.querySelector<HTMLInputElement>('#mpHotkeys')!
    const mpInterval = els.massPerm.querySelector<HTMLSelectElement>('#mpInterval')!

    mpCategory.value = massPermCategoryCode
    mpInterval.value = massPermIntervalSec.toFixed(1)

    mpHotkeys.addEventListener('change', async () => {
      massPermHotkeysEnabled = mpHotkeys.checked
      try {
        await applyMassPermHotkeysConfig(massPermHotkeysEnabled)
        setMassPermStatus(`Hotkeys ${massPermHotkeysEnabled ? 'enabled' : 'disabled'}.`)
      } catch (e) {
        setMassPermStatus(`Failed to toggle hotkeys: ${String(e)}`)
        massPermHotkeysEnabled = !massPermHotkeysEnabled
      }
      renderMassPerm()
    })

    mpHotkeysConfig.addEventListener('click', () => {
      openHotkeysModal('mass_perm')
    })

    mpInterval.addEventListener('change', () => {
      const next = Number.parseFloat(mpInterval.value)
      if (!Number.isFinite(next)) return
      // clamp to 0.1..1.0 with step 0.1
      const clamped = Math.max(0.1, Math.min(1.0, Math.round(next * 10) / 10))
      massPermIntervalSec = clamped

      // if running, restart timer with the new interval (keep progress)
      if (massPermRunning) {
        if (massPermTimer) {
          window.clearInterval(massPermTimer)
          massPermTimer = null
        }

        const intervalMs = Math.round(massPermIntervalSec * 1000)
        massPermTimer = window.setInterval(async () => {
          if (massPermInFlight) return
          if (!massPermRunning) return
          if (massPermIndex >= massPermMapcodes.length) {
            stopMassPerm()
            setMassPermStatus('Done.')
            renderMassPerm()
            return
          }

          const mc = massPermMapcodes[massPermIndex]!
          massPermInFlight = true
          try {
            const resolved = normalizeCategorySelection(massPermCategoryCode)
            if (!resolved.number) {
              setMassPermStatus('Invalid category number.')
              stopMassPerm()
              renderMassPerm()
              return
            }
            await massPermSendPerm(mc, resolved.number, 'auto')
            massPermLastSentIndex = massPermIndex
            massPermIndex += 1
          } finally {
            massPermInFlight = false
            renderMassPerm()
          }
        }, intervalMs)
      }

      renderMassPerm()
    })

    mpCategory.addEventListener('change', () => {
      massPermCategoryCode = mpCategory.value
      renderMassPerm()
    })

    mpAddTextarea.addEventListener('click', () => {
      stopMassPerm()
      const list = extractMapcodesFromTextOrSessionJson(mpTextarea.value)
      massPermMapcodes = uniqPreserveOrder(list)
      massPermIndex = 0
      massPermLastSentIndex = null
      setMassPermStatus(`Loaded ${massPermMapcodes.length} map(s) from textarea.`)
      renderMassPerm()
    })

    mpFromClipboard.addEventListener('click', async () => {
      stopMassPerm()
      const txt = await readClipboardText()
      if (!txt) {
        setMassPermStatus('Clipboard is empty (or has no text).')
        return
      }
      const list = extractMapcodesFromTextOrSessionJson(txt)
      massPermMapcodes = uniqPreserveOrder(list)
      massPermIndex = 0
      massPermLastSentIndex = null
      setMassPermStatus(`Loaded ${massPermMapcodes.length} map(s) from clipboard.`)
      renderMassPerm()
    })

    mpFromFile.addEventListener('click', async () => {
      stopMassPerm()
      const path = await openImportFileDialog()
      if (!path) return
      const txt = await readTextFileFromPath(path)
      const list = extractMapcodesFromTextOrSessionJson(txt)
      massPermMapcodes = uniqPreserveOrder(list)
      massPermIndex = 0
      massPermLastSentIndex = null
      setMassPermStatus(`Loaded ${massPermMapcodes.length} map(s) from file.`)
      renderMassPerm()
    })

    mpClearList.addEventListener('click', () => {
      stopMassPerm()
      massPermMapcodes = []
      massPermIndex = 0
      massPermLastSentIndex = null
      setMassPermStatus('Cleared.')
      renderMassPerm()
    })

    mpPlay.addEventListener('click', () => {
      const resolved = normalizeCategorySelection(massPermCategoryCode)
      if (!resolved.number) {
        setMassPermStatus('Invalid category number.')
        return
      }
      if (!massPermMapcodes.length) {
        setMassPermStatus('No maps loaded.')
        return
      }
      if (massPermIndex >= massPermMapcodes.length) {
        setMassPermStatus('Already finished. Press Cancel to reset or load a new list.')
        return
      }
      if (massPermRunning) return

      massPermRunning = true
      const intervalMs = Math.round(massPermIntervalSec * 1000)
      massPermTimer = window.setInterval(async () => {
        if (massPermInFlight) return
        if (!massPermRunning) return
        if (massPermIndex >= massPermMapcodes.length) {
          stopMassPerm()
          setMassPermStatus('Done.')
          renderMassPerm()
          return
        }

        const mc = massPermMapcodes[massPermIndex]!
        massPermInFlight = true
        try {
          const resolved = normalizeCategorySelection(massPermCategoryCode)
          if (!resolved.number) {
            setMassPermStatus('Invalid category number.')
            stopMassPerm()
            renderMassPerm()
            return
          }
          await massPermSendPerm(mc, resolved.number, 'auto')
          massPermLastSentIndex = massPermIndex
          massPermIndex += 1
        } finally {
          massPermInFlight = false
          renderMassPerm()
        }
      }, intervalMs)

      renderMassPerm()
      setMassPermStatus('Running… focus the game window.')
    })

    mpPause.addEventListener('click', () => {
      stopMassPerm()
      setMassPermStatus('Paused.')
      renderMassPerm()
    })

    mpPrev.addEventListener('click', async () => {
      if (massPermInFlight) return
      if (massPermRunning) {
        setMassPermStatus('Pause first to go back.')
        return
      }
      if (massPermIndex <= 0) {
        setMassPermStatus('Already at the first map.')
        return
      }
      const resolved = normalizeCategorySelection(massPermCategoryCode)
      if (!resolved.number) {
        setMassPermStatus('Invalid category number.')
        return
      }
      const idx = massPermIndex - 1
      const mc = massPermMapcodes[idx]
      if (!mc) {
        setMassPermStatus('No map to apply.')
        return
      }
      massPermInFlight = true
      await massPermSendPerm(mc, resolved.number, 'manual')
      massPermLastSentIndex = idx
      massPermIndex = idx
      massPermInFlight = false
      renderMassPerm()
    })

    mpCancel.addEventListener('click', () => {
      if (!canCancelToHome) {
        setMassPermStatus('Pause first to cancel.')
        return
      }
      openConfirmMassPermLeave()
    })

    mpNext.addEventListener('click', async () => {
      if (massPermInFlight) return
      const resolved = normalizeCategorySelection(massPermCategoryCode)
      if (!resolved.number) {
        setMassPermStatus('Invalid category number.')
        return
      }
      if (!massPermMapcodes.length) {
        setMassPermStatus('No maps loaded.')
        return
      }
      if (massPermIndex >= massPermMapcodes.length) {
        setMassPermStatus('Done.')
        return
      }

      // Next map = send the command for the next unsent map, then advance.
      const idx = massPermIndex
      const mc = massPermMapcodes[idx]
      if (!mc) {
        setMassPermStatus('No map to apply.')
        return
      }

      massPermInFlight = true
      await massPermSendPerm(mc, resolved.number, 'manual')
      massPermLastSentIndex = idx
      massPermIndex = idx + 1
      massPermInFlight = false
      renderMassPerm()
    })
  }

  function renderCustomCommand(): void {
    const previewMap = customCmdMapcodes[customCmdIndex] ?? customCmdMapcodes[0] ?? '@mapcode'
    const preview = buildCustomCommandPreview(customCmdPrefix, customCmdSuffix, previewMap)

    const total = customCmdMapcodes.length
    const done = Math.min(customCmdIndex, total)
    const current = customCmdMapcodes[customCmdIndex] ?? null
    const last = customCmdLastSentIndex != null ? customCmdMapcodes[customCmdLastSentIndex] ?? null : null
    const canManualNav = !customCmdRunning && !customCmdInFlight
    const hkLabel = massPermHotkeysEnabled ? 'enabled' : 'disabled'
    const mpKeys = state.settings.massPermHotkeys
    const intervalLabel = `${customCmdIntervalSec.toFixed(1)}s`
    const intervalOptions = Array.from({ length: 10 }, (_, i) => (i + 1) / 10).map((v) => {
      const label = `${v.toFixed(1)}s`
      const selected = Math.abs(v - customCmdIntervalSec) < 0.0001 ? 'selected' : ''
      return `<option value="${v.toFixed(1)}" ${selected}>${label}</option>`
    })

    els.customCommand.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">Custom command</div>
            <div class="wizardHint">Sends commands every <b>${intervalLabel}</b> to the active window.</div>
          </div>
        </div>

        <div class="wizardBody">
          <div class="row">
            <label class="field">
              <span>Prefix</span>
              <input id="ccPrefix" class="textarea" style="min-height:auto; height:34px; padding:6px 10px;" placeholder="e.g. /np or !np or /p 100" />
            </label>
            <label class="field">
              <span>Suffix (optional)</span>
              <input id="ccSuffix" class="textarea" style="min-height:auto; height:34px; padding:6px 10px;" placeholder="e.g. #note or | tag" />
            </label>
            <div class="wizardHint">Preview: <b>${preview}</b></div>
          </div>

          <div class="kv">
            <div class="k">Map list</div>
            <textarea id="ccTextarea" class="textarea" rows="6" placeholder="Paste mapcodes here (one per line)"></textarea>
            <div class="row">
              <button class="btn primary" id="ccAddTextarea">Load from textarea</button>
              <button class="btn" id="ccFromClipboard">Load from clipboard</button>
              <button class="btn" id="ccFromFile">Import file</button>
              <button class="btn danger" id="ccClearList">Clear list</button>
            </div>
            <div class="status" id="ccStatus"></div>
          </div>

          <div class="kv">
            <div class="k">Progress</div>
            <div class="v mono">Done: ${done}/${total}</div>
            <div class="v mono">Current: ${current ? `@${current}` : '—'}</div>
            <div class="v mono">Last: ${last ? `@${last}` : '—'}</div>
          </div>

          <label class="field">
            <span>Interval</span>
            <select id="ccInterval">
              ${intervalOptions.join('')}
            </select>
          </label>

          <label class="field checkbox">
            <input id="ccHotkeys" type="checkbox" ${massPermHotkeysEnabled ? 'checked' : ''} />
            <span>Enable hotkeys (play: ${mpKeys.play}, pause: ${mpKeys.pause}, next: ${mpKeys.next}, back: ${mpKeys.prev})</span>
          </label>

          <div class="row">
            <button class="btn primary" id="ccPlay" title="Hotkey: ${mpKeys.play} (${hkLabel})">${customCmdRunning ? 'Running…' : 'Play / Resume'}</button>
            <button class="btn" id="ccPause" title="Hotkey: ${mpKeys.pause} (${hkLabel})">Pause</button>
            <button class="btn" id="ccPrev" title="Hotkey: ${mpKeys.prev} (${hkLabel})" ${canManualNav ? '' : 'disabled'}>Back</button>
            <button class="btn" id="ccNext" title="Hotkey: ${mpKeys.next} (${hkLabel})" ${canManualNav ? '' : 'disabled'}>Next map</button>
            <button class="btn danger" id="ccCancel" ${canManualNav ? '' : 'disabled'}>Cancel</button>
            <button class="btn" id="ccHotkeysConfig">Config hotkeys</button>
          </div>
        </div>
      </div>
    `

    const ccPrefix = els.customCommand.querySelector<HTMLInputElement>('#ccPrefix')!
    const ccSuffix = els.customCommand.querySelector<HTMLInputElement>('#ccSuffix')!
    const ccTextarea = els.customCommand.querySelector<HTMLTextAreaElement>('#ccTextarea')!
    const ccAddTextarea = els.customCommand.querySelector<HTMLButtonElement>('#ccAddTextarea')!
    const ccFromClipboard = els.customCommand.querySelector<HTMLButtonElement>('#ccFromClipboard')!
    const ccFromFile = els.customCommand.querySelector<HTMLButtonElement>('#ccFromFile')!
    const ccClearList = els.customCommand.querySelector<HTMLButtonElement>('#ccClearList')!
    const ccPlay = els.customCommand.querySelector<HTMLButtonElement>('#ccPlay')!
    const ccPause = els.customCommand.querySelector<HTMLButtonElement>('#ccPause')!
    const ccPrev = els.customCommand.querySelector<HTMLButtonElement>('#ccPrev')!
    const ccNext = els.customCommand.querySelector<HTMLButtonElement>('#ccNext')!
    const ccCancel = els.customCommand.querySelector<HTMLButtonElement>('#ccCancel')!
    const ccHotkeys = els.customCommand.querySelector<HTMLInputElement>('#ccHotkeys')!
    const ccInterval = els.customCommand.querySelector<HTMLSelectElement>('#ccInterval')!
    const ccHotkeysConfig = els.customCommand.querySelector<HTMLButtonElement>('#ccHotkeysConfig')!

    ccPrefix.value = customCmdPrefix
    ccSuffix.value = customCmdSuffix
    ccInterval.value = customCmdIntervalSec.toFixed(1)

    const updatePreview = () => {
      customCmdPrefix = ccPrefix.value
      customCmdSuffix = ccSuffix.value
      renderCustomCommand()
    }

    ccPrefix.addEventListener('blur', () => updatePreview())
    ccSuffix.addEventListener('blur', () => updatePreview())

    ccHotkeys.addEventListener('change', async () => {
      massPermHotkeysEnabled = ccHotkeys.checked
      try {
        await applyMassPermHotkeysConfig(massPermHotkeysEnabled)
        setCustomCommandStatus(`Hotkeys ${massPermHotkeysEnabled ? 'enabled' : 'disabled'}.`)
      } catch (e) {
        setCustomCommandStatus(`Failed to toggle hotkeys: ${String(e)}`)
        massPermHotkeysEnabled = !massPermHotkeysEnabled
      }
      renderCustomCommand()
    })

    ccHotkeysConfig.addEventListener('click', () => {
      openHotkeysModal('mass_perm')
    })

    ccInterval.addEventListener('change', () => {
      const next = Number.parseFloat(ccInterval.value)
      if (!Number.isFinite(next)) return
      const clamped = Math.max(0.1, Math.min(1.0, Math.round(next * 10) / 10))
      customCmdIntervalSec = clamped

      if (customCmdRunning) {
        if (customCmdTimer) {
          window.clearInterval(customCmdTimer)
          customCmdTimer = null
        }

        const intervalMs = Math.round(customCmdIntervalSec * 1000)
        customCmdTimer = window.setInterval(async () => {
          if (customCmdInFlight) return
          if (!customCmdRunning) return
          if (customCmdIndex >= customCmdMapcodes.length) {
            stopCustomCommand()
            setCustomCommandStatus('Done.')
            renderCustomCommand()
            return
          }

          const mc = customCmdMapcodes[customCmdIndex]!
          const prefix = customCmdPrefix.trim()
          if (!prefix) {
            setCustomCommandStatus('Enter a prefix first.')
            stopCustomCommand()
            renderCustomCommand()
            return
          }
          customCmdInFlight = true
          try {
            await customCommandSend(mc, prefix, customCmdSuffix, 'auto')
            customCmdLastSentIndex = customCmdIndex
            customCmdIndex += 1
          } finally {
            customCmdInFlight = false
            renderCustomCommand()
          }
        }, intervalMs)
      }

      renderCustomCommand()
    })

    ccAddTextarea.addEventListener('click', () => {
      stopCustomCommand()
      const list = extractMapcodesFromTextOrSessionJson(ccTextarea.value)
      customCmdMapcodes = uniqPreserveOrder(list)
      customCmdIndex = 0
      customCmdLastSentIndex = null
      setCustomCommandStatus(`Loaded ${customCmdMapcodes.length} map(s) from textarea.`)
      renderCustomCommand()
    })

    ccFromClipboard.addEventListener('click', async () => {
      stopCustomCommand()
      const txt = await readClipboardText()
      if (!txt) {
        setCustomCommandStatus('Clipboard is empty (or has no text).')
        return
      }
      const list = extractMapcodesFromTextOrSessionJson(txt)
      customCmdMapcodes = uniqPreserveOrder(list)
      customCmdIndex = 0
      customCmdLastSentIndex = null
      setCustomCommandStatus(`Loaded ${customCmdMapcodes.length} map(s) from clipboard.`)
      renderCustomCommand()
    })

    ccFromFile.addEventListener('click', async () => {
      stopCustomCommand()
      const path = await openImportFileDialog()
      if (!path) return
      const txt = await readTextFileFromPath(path)
      const list = extractMapcodesFromTextOrSessionJson(txt)
      customCmdMapcodes = uniqPreserveOrder(list)
      customCmdIndex = 0
      customCmdLastSentIndex = null
      setCustomCommandStatus(`Loaded ${customCmdMapcodes.length} map(s) from file.`)
      renderCustomCommand()
    })

    ccClearList.addEventListener('click', () => {
      stopCustomCommand()
      customCmdMapcodes = []
      customCmdIndex = 0
      customCmdLastSentIndex = null
      setCustomCommandStatus('Cleared.')
      renderCustomCommand()
    })

    ccPlay.addEventListener('click', () => {
      const prefix = customCmdPrefix.trim()
      if (!prefix) {
        setCustomCommandStatus('Enter a prefix first (e.g. /np, !np, /p 100).')
        return
      }
      if (!customCmdMapcodes.length) {
        setCustomCommandStatus('No maps loaded.')
        return
      }
      if (customCmdIndex >= customCmdMapcodes.length) {
        setCustomCommandStatus('Already finished. Press Cancel to reset or load a new list.')
        return
      }
      if (customCmdRunning) return

      customCmdRunning = true
      const intervalMs = Math.round(customCmdIntervalSec * 1000)
      customCmdTimer = window.setInterval(async () => {
        if (customCmdInFlight) return
        if (!customCmdRunning) return
        if (customCmdIndex >= customCmdMapcodes.length) {
          stopCustomCommand()
          setCustomCommandStatus('Done.')
          renderCustomCommand()
          return
        }

        const mc = customCmdMapcodes[customCmdIndex]!
        customCmdInFlight = true
        try {
          await customCommandSend(mc, prefix, customCmdSuffix, 'auto')
          customCmdLastSentIndex = customCmdIndex
          customCmdIndex += 1
        } finally {
          customCmdInFlight = false
          renderCustomCommand()
        }
      }, intervalMs)

      renderCustomCommand()
      setCustomCommandStatus('Running… focus the game window.')
    })

    ccPause.addEventListener('click', () => {
      stopCustomCommand()
      setCustomCommandStatus('Paused.')
      renderCustomCommand()
    })

    ccPrev.addEventListener('click', async () => {
      if (customCmdInFlight) return
      if (customCmdRunning) {
        setCustomCommandStatus('Pause first to go back.')
        return
      }
      if (customCmdIndex <= 0) {
        setCustomCommandStatus('Already at the first map.')
        return
      }
      const prefix = customCmdPrefix.trim()
      if (!prefix) {
        setCustomCommandStatus('Enter a prefix first.')
        return
      }
      const idx = customCmdIndex - 1
      const mc = customCmdMapcodes[idx]
      if (!mc) {
        setCustomCommandStatus('No map to apply.')
        return
      }
      customCmdInFlight = true
      await customCommandSend(mc, prefix, customCmdSuffix, 'manual')
      customCmdLastSentIndex = idx
      customCmdIndex = idx
      customCmdInFlight = false
      renderCustomCommand()
    })

    ccNext.addEventListener('click', async () => {
      if (customCmdInFlight) return
      const prefix = customCmdPrefix.trim()
      if (!prefix) {
        setCustomCommandStatus('Enter a prefix first.')
        return
      }
      if (!customCmdMapcodes.length) {
        setCustomCommandStatus('No maps loaded.')
        return
      }
      if (customCmdIndex >= customCmdMapcodes.length) {
        setCustomCommandStatus('Done.')
        return
      }

      const idx = customCmdIndex
      const mc = customCmdMapcodes[idx]
      if (!mc) {
        setCustomCommandStatus('No map to apply.')
        return
      }

      customCmdInFlight = true
      await customCommandSend(mc, prefix, customCmdSuffix, 'manual')
      customCmdLastSentIndex = idx
      customCmdIndex = idx + 1
      customCmdInFlight = false
      renderCustomCommand()
    })

    ccCancel.addEventListener('click', () => {
      if (!canManualNav) {
        setCustomCommandStatus('Pause first to cancel.')
        return
      }
      resetCustomCommandData()
      els.customCommand.style.display = 'none'
      openLauncher({ allowReturnToSession: Boolean(state.session) })
      setCustomCommandStatus('Custom command cancelled.')
    })
  }

  function openCustomCommand(): void {
    els.customCommand.style.display = 'grid'
    els.massPerm.style.display = 'none'
    renderCustomCommand()
    setCustomCommandStatus('Load a list and enter a prefix.')
    void applyMassPermHotkeysConfig(massPermHotkeysEnabled).catch(() => {
      // best effort
    })
  }

  function openMassPerm(): void {
    els.massPerm.style.display = 'grid'
    els.customCommand.style.display = 'none'
    // mass perm pode rodar sem sessão; não força mostrar o shell
    renderMassPerm()
    setMassPermStatus('Load a list and choose a category.')
    void applyMassPermHotkeysConfig(massPermHotkeysEnabled).catch(() => {
      // best effort
    })
  }

  function addItems(items: Array<Pick<QueueItem, 'mapcode'> & Partial<QueueItem>>, sourceLabel: string): void {
    if (!items.length) {
      setStatus('Nothing to add.')
      return
    }

    const existing = new Set(state.items.map((i) => i.mapcode))
    const toAdd: QueueItem[] = []
    for (const raw of items) {
      const normalized = normalizeMapcode(raw.mapcode)
      if (!normalized) continue
      if (state.settings.dedupe && existing.has(normalized)) {
        // Allow duplicates when they come from different submitters (same mapcode can be submitted by different people).
        const submitter = typeof raw.submitter === 'string' ? raw.submitter.trim() : ''
        if (!submitter) continue
        const alreadyHasSameSubmitter = state.items.some((it) => it.mapcode === normalized && (it.submitter ?? '') === submitter)
        if (alreadyHasSameSubmitter) continue
      }
      const base = createItem(normalized)
      toAdd.push({ ...base, ...raw, mapcode: normalized })
    }

    for (const it of toAdd) state.items.push(it)

    if (!state.selectedId && state.items.length > 0) {
      state.selectedId = state.items[0]!.id
    }

    persist()
    render()
    syncNp()
    setStatus(`Added ${toAdd.length} mapcode(s) (${sourceLabel}).`)

    void hydrateMapInfoForItems(toAdd).catch(() => {
      // best effort
    })
  }

  async function hydrateMapInfoForItems(items: QueueItem[]): Promise<void> {
    // pega IDs sem "@"
    const ids = uniqPreserveOrder(
      items
        .map((it) => Number.parseInt(String(it.mapcode).replace(/^@+/, ''), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => String(n)),
    ).map((s) => Number.parseInt(s, 10))

    if (!ids.length) return

    // If there are duplicates, first propagate existing info among them.
    const byId = new Map<number, QueueItem[]>()
    for (const it of state.items) {
      const id = Number.parseInt(String(it.mapcode).replace(/^@+/, ''), 10)
      if (!Number.isFinite(id) || id <= 0) continue
      const arr = byId.get(id) ?? []
      arr.push(it)
      byId.set(id, arr)
    }

    for (const id of ids) {
      const group = byId.get(id) ?? []
      if (!group.length) continue
      const donor = group.find((x) => x.xml || x.author || x.p != null)
      if (!donor) continue
      for (const it of group) {
        if (!it.author && donor.author) it.author = donor.author
        if (!it.xml && donor.xml) it.xml = donor.xml
        if (it.p == null && donor.p != null) it.p = donor.p
      }
    }

    // Avoid refetch only when all items for that map id already have author+xml.
    const missing = ids.filter((id) => {
      const group = byId.get(id) ?? []
      if (!group.length) return true
      const hasAllXml = group.every((it) => Boolean(it.xml))
      const hasAllAuthor = group.every((it) => Boolean(it.author))
      return !(hasAllXml && hasAllAuthor)
    })
    if (!missing.length) return

    const res = await fetchMapInfo(missing)
    if (!res || res.error) return

    for (const entry of res.data) {
      const mc = String(entry.id)
      // Apply to ALL items that match this mapcode (duplicates)
      const matches = state.items.filter((x) => String(x.mapcode).replace(/^@+/, '') === mc)
      if (!matches.length) continue
      for (const it of matches) {
        it.author = entry.author ?? null
        it.xml = entry.xml ?? null
        it.p = typeof entry.p === 'number' ? entry.p : null
        it.updatedAt = nowIso()
      }
    }

    persist()
    // Atualiza UI se o selecionado ganhou dados
    updateDetailsValues()
  }

  function basename(path: string): string {
    return path.split(/[\\/]+/).filter(Boolean).pop() ?? path
  }

  function scheduleAutoClipboardAdd(text: string): void {
    const t = text.trim()
    if (!t) return

    clipboardPendingText = t
    if (clipboardDebounceTimer) {
      window.clearTimeout(clipboardDebounceTimer)
      clipboardDebounceTimer = null
    }

    clipboardDebounceTimer = window.setTimeout(() => {
      clipboardDebounceTimer = null
      const next = clipboardPendingText
      clipboardPendingText = null
      if (!next) return
      if (clipboardLastProcessed === next) return
      clipboardLastProcessed = next
      addMapcodes(parseMapcodesFromText(next), 'auto-clipboard')
    }, 250)
  }

  function getSelected(): QueueItem | null {
    if (!state.selectedId) return null
    return state.items.find((i) => i.id === state.selectedId) ?? null
  }

  function getVisibleQueueItems(): QueueItem[] {
    return state.items.filter((item) => {
      if (state.settings.showIgnoredInQueue) return true
      return item.decision !== 'ignored' && !item.importedIgnored
    })
  }

  function indexOfSelected(): number {
    if (!state.selectedId) return -1
    return getVisibleQueueItems().findIndex((i) => i.id === state.selectedId)
  }

  function bumpUpdated(item: QueueItem): void {
    item.updatedAt = nowIso()
  }

  function updateSelected(mut: (item: QueueItem) => void, opts?: { rerenderQueue?: boolean }): void {
    const sel = getSelected()
    if (!sel) return
    mut(sel)
    bumpUpdated(sel)
    persist()
    if (opts?.rerenderQueue) renderQueue()
    updateDetailsValues()
    updateFinishReviewButtonState()
  }

  function selectRelative(delta: number): void {
    const visible = getVisibleQueueItems()
    if (!visible.length) return
    const idx = indexOfSelected()
    const base = idx >= 0 ? idx : 0
    const len = visible.length
    const raw = base + delta
    const wrapped = ((raw % len) + len) % len
    select(visible[wrapped]!.id)
  }

  function renderQueue(): void {
    const selectedId = state.selectedId
    const visibleItems = getVisibleQueueItems()

    // se o item selecionado ficou oculto, move seleção para o primeiro visível
    if (selectedId && !visibleItems.some((i) => i.id === selectedId)) {
      state.selectedId = visibleItems[0]?.id ?? null
      persist()
    }

    els.queue.innerHTML = visibleItems
      .map((item, idx) => {
        const active = item.id === selectedId ? 'active' : ''
        const decisionClass = item.decision ? `dec-${item.decision}` : ''
        const dotClass = item.status === 'reviewed' ? 'ok' : 'pending'
        const dotTitle = item.status === 'reviewed' ? 'reviewed' : 'pending'
        const titleParts = [
          `@${item.mapcode}`,
          item.decision ? `decision: ${DECISION_LABEL[item.decision]}` : 'decision: —',
          `status: ${dotTitle}`,
        ]
        return `
          <button class="queueItem ${active} ${decisionClass}" data-id="${item.id}" title="${titleParts.join(' | ')}">
            <span class="idx">${idx + 1}</span>
            <span class="mc">@${String(item.mapcode).replace(/^@+/, '')}</span>
            <span class="dot ${dotClass}" aria-label="${dotTitle}"></span>
          </button>
        `
      })
      .join('')

    for (const btn of Array.from(els.queue.querySelectorAll<HTMLButtonElement>('button.queueItem'))) {
      btn.addEventListener('click', () => select(btn.dataset.id ?? null))
    }
  }

  function renderDetails(): void {
    const sel = getSelected()
    if (!sel) {
      els.details.textContent = 'Select a mapcode from the queue.'
      els.details.classList.add('muted')
      detailsBoundId = null
      return
    }

    // evita recriar DOM durante digitação quando a seleção não mudou
    if (detailsBoundId === sel.id) {
      updateDetailsValues()
      return
    }

    detailsBoundId = sel.id
    els.details.classList.remove('muted')

    const sessionCategory = (state.session?.category ?? 'P3') as ReviewedCategoryCode
    const catMeta = REVIEW_CATEGORIES.find((c) => c.code === sessionCategory) ?? REVIEW_CATEGORIES[0]!
    const decisionOptionsHtml = [
      `<option value="">—</option>`,
      ...catMeta.decisions.map((d) => `<option value="${d}">${DECISION_LABEL[d]}</option>`),
    ].join('')

    els.details.innerHTML = `
      <div class="row" style="align-items: flex-start; gap: 12px; flex-wrap: wrap;">
        <div class="kv" style="flex: 1; min-width: 220px;">
          <div class="k">Mapcode</div>
          <div class="v mono">@<span id="d_mapcode"></span></div>
        </div>

        <div class="kv" style="flex: 1; min-width: 220px;">
          <div class="k">Submitter</div>
          <div class="v"><span id="d_submitter">—</span></div>
        </div>
      </div>

      <div class="kv">
        <div class="k">Author</div>
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div class="v"><span id="d_author">—</span></div>
          <button class="btn" id="copyXml">Copy XML</button>
        </div>
        <div class="status" id="d_xmlStatus"></div>
      </div>

      <div class="kv">
        <div class="k">Decision</div>
        <select id="decisionSelect">
          ${decisionOptionsHtml}
        </select>
      </div>

      <div class="kv">
        <div class="k">Comment</div>
        <textarea id="reviewInput" class="textarea" rows="10" maxlength="${REVIEW_MAX_CHARS}" placeholder="Write your review here..."></textarea>
        <div class="status" id="reviewCounter"></div>
      </div>
    `

    // bind listeners (uma vez por item selecionado)
    const reviewInput = els.details.querySelector<HTMLTextAreaElement>('#reviewInput')!
    const reviewCounter = els.details.querySelector<HTMLDivElement>('#reviewCounter')!
    const decisionSelect = els.details.querySelector<HTMLSelectElement>('#decisionSelect')!
    const copyXml = els.details.querySelector<HTMLButtonElement>('#copyXml')!

    const updateReviewCounter = (value: string) => {
      if (!reviewCounter) return
      reviewCounter.textContent = `${value.length} / ${REVIEW_MAX_CHARS}`
    }

    copyXml.addEventListener('click', async () => {
      const selNow = getSelected()
      const xml = selNow?.xml
      if (!xml) {
        setStatus('No XML available for this map yet.')
        return
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(xml)
        } else {
          await writeClipboardText(xml)
        }
        setStatus('XML copied to clipboard.')
      } catch (e) {
        setStatus(`Failed to copy XML: ${String(e)}`)
      }
    })

    decisionSelect.addEventListener('change', () => {
      const raw = decisionSelect.value
      const d = raw ? (raw as NonNullable<QueueItem['decision']>) : null
      updateSelected(
        (item) => {
          item.decision = d
          item.status = d ? 'reviewed' : 'pending'
        },
        { rerenderQueue: true },
      )
    })

    reviewInput.addEventListener('input', () => {
      let value = reviewInput.value
      if (value.length > REVIEW_MAX_CHARS) {
        value = value.slice(0, REVIEW_MAX_CHARS)
        reviewInput.value = value
      }
      updateReviewCounter(value)
      if (reviewSaveTimer) {
        window.clearTimeout(reviewSaveTimer)
        reviewSaveTimer = null
      }
      reviewSaveTimer = window.setTimeout(() => {
        reviewSaveTimer = null
        updateSelected((item) => {
          item.review = value
        })
      }, 200)
    })

    // inicializa valores
    updateDetailsValues()
  }

  function updateDetailsValues(): void {
    const sel = getSelected()
    if (!sel) return
    if (detailsBoundId !== sel.id) return

    const mapcode = els.details.querySelector<HTMLSpanElement>('#d_mapcode')
    const submitter = els.details.querySelector<HTMLSpanElement>('#d_submitter')
    const reviewInput = els.details.querySelector<HTMLTextAreaElement>('#reviewInput')
    const reviewCounter = els.details.querySelector<HTMLDivElement>('#reviewCounter')
    const decisionSelect = els.details.querySelector<HTMLSelectElement>('#decisionSelect')
    const author = els.details.querySelector<HTMLSpanElement>('#d_author')
    const copyXml = els.details.querySelector<HTMLButtonElement>('#copyXml')
    const xmlStatus = els.details.querySelector<HTMLDivElement>('#d_xmlStatus')

    if (mapcode) mapcode.textContent = String(sel.mapcode).replace(/^@+/, '')
    if (submitter) submitter.textContent = sel.submitter ?? '—'
    if (author) author.textContent = sel.author ?? '—'
    if (copyXml) copyXml.disabled = !sel.xml
    if (xmlStatus) xmlStatus.textContent = sel.xml ? `XML ready (p=${sel.p ?? '—'})` : 'Fetching XML…'
    if (decisionSelect && decisionSelect.value !== (sel.decision ?? '')) {
      decisionSelect.value = sel.decision ?? ''
    }

    // não sobrescreve enquanto o usuário está digitando
    if (reviewInput && document.activeElement !== reviewInput && reviewInput.value !== sel.review) {
      const next = String(sel.review ?? '')
      const clamped = next.length > REVIEW_MAX_CHARS ? next.slice(0, REVIEW_MAX_CHARS) : next
      reviewInput.value = clamped
      if (clamped !== next) {
        // garante que estado/export não exceda o limite
        updateSelected((item) => {
          item.review = clamped
        })
      }
    }

    if (reviewCounter && reviewInput) {
      reviewCounter.textContent = `${reviewInput.value.length} / ${REVIEW_MAX_CHARS}`
    }
  }

  function render(): void {
    document.body.classList.toggle('session-active', Boolean(state.session))
    setSessionHeaderMode(Boolean(state.session))
    if (state.session) updateFinishReviewButtonState()
    const sessionCategory = state.session?.category
    const catColor =
      (sessionCategory ? REVIEW_CATEGORIES.find((c) => c.code === sessionCategory)?.color : null) ?? '#ff6a7b'
    document.body.style.setProperty('--session-accent', catColor)
    els.showIgnored.checked = state.settings.showIgnoredInQueue
    els.queueCommandMode.value = state.settings.commandMode
    els.reviewHotkeys.checked = state.settings.reviewHotkeysEnabled
    els.commandMode.value = state.settings.commandMode
    els.dedupe.checked = state.settings.dedupe
    els.autoCapture.checked = state.settings.autoCaptureClipboard
    const reviewLabel = els.reviewHotkeys.closest('label')
    if (reviewLabel) reviewLabel.title = getReviewHotkeysTitle()
    renderQueue()
    renderDetails()
  }

  function updateSettings(next: Partial<AppState['settings']>): void {
    state.settings = { ...state.settings, ...next }
    persist()
    if (typeof next.commandMode === 'string') {
      syncNp()
    }
  }

  function normalizeHotkeyValue(value: string): string {
    return value.trim()
  }

  function formatHotkeyError(reason: string): string {
    return `Hotkeys: ${reason}`
  }

  function validateHotkeySet(values: string[]): string | null {
    const normalized = values.map((v) => v.trim()).filter(Boolean)
    if (normalized.length !== values.length) {
      return 'fill in all hotkey fields.'
    }
    return null
  }

  async function applyReviewHotkeysConfig(): Promise<void> {
    const hk = state.settings.reviewHotkeys
    await registerHotkeys({
      loadCurrent: hk.loadCurrent,
      prevMap: hk.prevMap,
      nextMap: hk.nextMap,
      replayCurrent: hk.replayCurrent,
    })
  }

  async function applyMassPermHotkeysConfig(enabled: boolean): Promise<void> {
    const hk = state.settings.massPermHotkeys
    await setMassPermHotkeysConfig({
      enabled,
      hotkeys: {
        play: hk.play,
        pause: hk.pause,
        next: hk.next,
        prev: hk.prev,
      },
    })
  }

  function getReviewHotkeysTitle(): string {
    const hk = state.settings.reviewHotkeys
    return `Global hotkeys: ${hk.loadCurrent} = load | ${hk.prevMap} = prev+load | ${hk.nextMap} = next+load | ${hk.replayCurrent} = replay`
  }

  function openHotkeysModal(kind: 'review' | 'mass_perm'): void {
    const isReview = kind === 'review'
    const title = isReview ? 'Review hotkeys' : 'Mass perm hotkeys'
    const reviewCurrent = state.settings.reviewHotkeys
    const massCurrent = state.settings.massPermHotkeys
    const prevReviewEnabled = state.settings.reviewHotkeysEnabled
    const prevMassPermEnabled = massPermHotkeysEnabled
    const groupFields = isReview
      ? [
          { id: 'loadCurrent', label: 'Load current', value: reviewCurrent.loadCurrent },
          { id: 'prevMap', label: 'Prev + load', value: reviewCurrent.prevMap },
          { id: 'nextMap', label: 'Next + load', value: reviewCurrent.nextMap },
          { id: 'replayCurrent', label: 'Replay current', value: reviewCurrent.replayCurrent },
        ]
      : [
          { id: 'play', label: 'Play / Resume', value: massCurrent.play },
          { id: 'pause', label: 'Pause', value: massCurrent.pause },
          { id: 'prev', label: 'Back', value: massCurrent.prev },
          { id: 'next', label: 'Next', value: massCurrent.next },
        ]

    const stateMap = new Map(groupFields.map((f) => [f.id, f.value]))
    let captureTarget: string | null = null

    els.hotkeysModal.style.display = 'grid'
    els.hotkeysModal.style.zIndex = '1200'
    els.hotkeysModal.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">${title}</div>
            <div class="wizardHint">Click “Change key” and press the next hotkey.</div>
          </div>
        </div>
        <div class="wizardBody">
          ${groupFields
            .map(
              (f) => `
                <div class="row" style="justify-content: space-between; align-items: center;">
                  <div class="field" style="flex: 1;">
                    <span>${f.label}</span>
                    <span class="mono" id="hk_val_${f.id}">${f.value}</span>
                  </div>
                  <button class="btn" id="hk_capture_${f.id}">Change key</button>
                </div>
              `,
            )
            .join('')}
          <div class="status" id="hkStatus"></div>
        </div>
        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            <button class="btn" id="hkCancel">Cancel</button>
          </div>
          <div class="wizardFooterRight">
            <button class="btn primary" id="hkSave">Save</button>
          </div>
        </div>
      </div>
    `

    const statusEl = els.hotkeysModal.querySelector<HTMLDivElement>('#hkStatus')!
    const cancelBtn = els.hotkeysModal.querySelector<HTMLButtonElement>('#hkCancel')!
    const saveBtn = els.hotkeysModal.querySelector<HTMLButtonElement>('#hkSave')!

    const updateLabel = (id: string) => {
      const el = els.hotkeysModal.querySelector<HTMLSpanElement>(`#hk_val_${id}`)
      if (el) el.textContent = stateMap.get(id) ?? ''
    }

    const setCaptureTarget = (id: string | null) => {
      captureTarget = id
      statusEl.textContent = id ? 'Press a key combination…' : ''
    }

    const toHotkeyString = (ev: KeyboardEvent): string | null => {
      const key = ev.key
      if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null
      const parts: string[] = []
      if (ev.ctrlKey) parts.push('Ctrl')
      if (ev.altKey) parts.push('Alt')
      if (ev.shiftKey) parts.push('Shift')
      if (ev.metaKey) parts.push('Meta')

      let base = key
      if (base === ' ') base = 'Space'
      if (base.length === 1) base = base.toUpperCase()
      parts.push(base)
      return parts.join('+')
    }

    const onKeydown = (ev: KeyboardEvent) => {
      if (!captureTarget) return
      ev.preventDefault()
      ev.stopPropagation()
      const hotkey = toHotkeyString(ev)
      if (!hotkey) return

      // Clear duplicates within the same group
      for (const [id, val] of stateMap.entries()) {
        if (id !== captureTarget && val.trim().toLowerCase() === hotkey.trim().toLowerCase()) {
          stateMap.set(id, '')
          updateLabel(id)
        }
      }
      stateMap.set(captureTarget, hotkey)
      updateLabel(captureTarget)
      setCaptureTarget(null)
    }

    for (const f of groupFields) {
      const btn = els.hotkeysModal.querySelector<HTMLButtonElement>(`#hk_capture_${f.id}`)!
      btn.addEventListener('click', () => setCaptureTarget(f.id))
      updateLabel(f.id)
    }

    const close = () => {
      els.hotkeysModal.style.display = 'none'
      els.hotkeysModal.innerHTML = ''
      document.removeEventListener('keydown', onKeydown, true)
      if (prevReviewEnabled !== state.settings.reviewHotkeysEnabled) {
        updateSettings({ reviewHotkeysEnabled: prevReviewEnabled })
        void setReviewHotkeysEnabled(prevReviewEnabled).catch(() => {
          // best effort
        })
        if (els.reviewHotkeys) els.reviewHotkeys.checked = prevReviewEnabled
      }
      if (prevMassPermEnabled !== massPermHotkeysEnabled) {
        massPermHotkeysEnabled = prevMassPermEnabled
        void applyMassPermHotkeysConfig(prevMassPermEnabled).catch(() => {
          // best effort
        })
        renderMassPerm()
        renderCustomCommand()
      }
    }

    cancelBtn.addEventListener('click', () => close())
    saveBtn.addEventListener('click', async () => {
      const next: Record<string, string> = {}
      for (const f of groupFields) {
        next[f.id] = normalizeHotkeyValue(stateMap.get(f.id) ?? '')
      }

      const values = groupFields.map((f) => next[f.id])
      const err = validateHotkeySet(values)
      if (err) {
        statusEl.textContent = formatHotkeyError(err)
        return
      }

      try {
        if (isReview) {
          const updated = {
            loadCurrent: next.loadCurrent,
            prevMap: next.prevMap,
            nextMap: next.nextMap,
            replayCurrent: next.replayCurrent,
          }
          await registerHotkeys(updated)
          updateSettings({ reviewHotkeys: updated })
          const reviewLabel = els.reviewHotkeys.closest('label')
          if (reviewLabel) reviewLabel.title = getReviewHotkeysTitle()
        } else {
          const updated = {
            play: next.play,
            pause: next.pause,
            next: next.next,
            prev: next.prev,
          }
          await setMassPermHotkeysConfig({ enabled: massPermHotkeysEnabled, hotkeys: updated })
          updateSettings({ massPermHotkeys: updated })
          if (els.massPerm.style.display === 'grid') {
            renderMassPerm()
          }
          if (els.customCommand.style.display === 'grid') {
            renderCustomCommand()
          }
        }
        close()
      } catch (e) {
        statusEl.textContent = formatHotkeyError(String(e))
      }
    })

    // Disable hotkeys while capturing to avoid interference
    if (state.settings.reviewHotkeysEnabled) {
      updateSettings({ reviewHotkeysEnabled: false })
      void setReviewHotkeysEnabled(false).catch(() => {
        // best effort
      })
      if (els.reviewHotkeys) els.reviewHotkeys.checked = false
    }
    if (massPermHotkeysEnabled) {
      massPermHotkeysEnabled = false
      void applyMassPermHotkeysConfig(false).catch(() => {
        // best effort
      })
      if (els.massPerm.style.display === 'grid') {
        renderMassPerm()
      }
      if (els.customCommand.style.display === 'grid') {
        renderCustomCommand()
      }
    }

    document.addEventListener('keydown', onKeydown, true)
    els.hotkeysModal.focus?.()
  }

  async function playSelected(sourceLabel: string): Promise<void> {
    const sel = getSelected()
    if (!sel) {
      setStatus('No mapcode selected.')
      return
    }
    try {
      const cmd = await sendNpToActiveWindow({ mapcode: sel.mapcode, commandMode: state.settings.commandMode })
      updateSelected((item) => {
        item.commandsUsed.push(state.settings.commandMode)
      })
      setStatus(`Sent (${sourceLabel}): ${cmd}`)
    } catch (e) {
      setStatus(`Failed to send (${sourceLabel}): ${String(e)}`)
    }
  }

  els.commandMode.addEventListener('change', () =>
    updateSettings({ commandMode: els.commandMode.value as AppState['settings']['commandMode'] }),
  )
  els.aboutBtn.addEventListener('click', () => openAboutModal())
  els.queueCommandMode.addEventListener('change', () =>
    updateSettings({ commandMode: els.queueCommandMode.value as AppState['settings']['commandMode'] }),
  )
  els.dedupe.addEventListener('change', () => updateSettings({ dedupe: els.dedupe.checked }))
  els.reviewHotkeys.addEventListener('change', () => {
    const enabled = els.reviewHotkeys.checked
    updateSettings({ reviewHotkeysEnabled: enabled })
    void setReviewHotkeysEnabled(enabled).catch(() => {
      // best effort
    })
  })
  els.reviewHotkeysConfig.addEventListener('click', () => {
    openHotkeysModal('review')
  })
  els.showIgnored.addEventListener('change', () => {
    updateSettings({ showIgnoredInQueue: els.showIgnored.checked })
    renderQueue()
  })

  // navegação rápida (local; hotkeys globais virão no Rust)
  window.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target as HTMLElement).closest?.('textarea,input,select')) return
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      selectRelative(1)
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      selectRelative(-1)
    }
  })

  els.addFromPaste.addEventListener('click', () => {
    const text = els.pasteInput.value
    const mapcodes = parseMapcodesFromText(text)
    addMapcodes(mapcodes, 'paste list')
    if (mapcodes.length) els.pasteInput.value = ''
  })

  els.importFile.addEventListener('click', async () => {
    try {
      const path = await openImportFileDialog()
      if (!path) return
      const text = await readTextFileFromPath(path)
      // tenta importar JSON (modelo da Session API); se falhar, cai pra texto
      const trimmed = text.trim()
      if (trimmed.startsWith('{')) {
        try {
          const obj = JSON.parse(trimmed) as any

          // 1) Export da própria app (continuação de review):
          // { schemaVersion, session, items: [...] }
          if (obj?.schemaVersion === 1 && Array.isArray(obj?.items)) {
            const sessionObj = obj?.session ?? null
            const category = String(sessionObj?.category ?? state.session?.category ?? 'P3')
            const importedReviewerUserId =
              typeof sessionObj?.reviewerUserId === 'string' ? sessionObj.reviewerUserId.trim() : null
            const currentReviewerUserId = (state.settings.authUserId ?? '').trim() || null

            state.session = {
              category,
              inputMethod: String(sessionObj?.inputMethod ?? 'session_json') as any,
              startedAt: String(sessionObj?.startedAt ?? nowIso()),
              threadId:
                typeof sessionObj?.threadId === 'string'
                  ? sessionObj.threadId
                  : typeof sessionObj?.threadId === 'number'
                    ? String(sessionObj.threadId)
                    : null,
              collectedAt: typeof sessionObj?.collectedAt === 'string' ? sessionObj.collectedAt : null,
              limitPerUser: typeof sessionObj?.limitPerUser === 'number' ? sessionObj.limitPerUser : null,
            }

            if (importedReviewerUserId && currentReviewerUserId && importedReviewerUserId !== currentReviewerUserId) {
              // we accept the file, but exports will always use the currently authenticated user
              setStatus('Imported session was created by a different user. Exports will use the currently authenticated userId.')
            }

            // opcional: reaplica settings básicas do arquivo
            if (obj?.settings && typeof obj.settings === 'object') {
              const s = obj.settings
              updateSettings({
                commandMode: (s.commandMode as any) ?? state.settings.commandMode,
                dedupe: typeof s.dedupe === 'boolean' ? s.dedupe : state.settings.dedupe,
                autoCaptureClipboard:
                  typeof s.autoCaptureClipboard === 'boolean' ? s.autoCaptureClipboard : state.settings.autoCaptureClipboard,
              })
            } else {
              persist()
            }

            const items = obj.items
              .filter((it: any) => typeof it?.mapcode === 'string')
              .map((it: any) => {
                return {
                  mapcode: String(it.mapcode),
                  author: typeof it.author === 'string' ? it.author : null,
                  xml: typeof it.xml === 'string' ? it.xml : null,
                  submitter: typeof it.submitter === 'string' ? it.submitter : null,
                  importedIgnored: typeof it.importedIgnored === 'boolean' ? it.importedIgnored : null,
                  importedReason: it.importedReason ?? null,
                  commandsUsed: Array.isArray(it.commandsUsed) ? it.commandsUsed : [],
                  review: typeof it.review === 'string' ? it.review : '',
                  decision: (it.decision as any) ?? null,
                  status: (it.status as any) ?? 'pending',
                  createdAt: typeof it.createdAt === 'string' ? it.createdAt : nowIso(),
                  updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : nowIso(),
                } satisfies Pick<QueueItem, 'mapcode'> & Partial<QueueItem>
              })

            // substitui a fila (continuação)
            state.items = []
            state.selectedId = null
            detailsBoundId = null
            persist()

            addItems(items, `session export: ${basename(path)}`)

            // abre a tela de review imediatamente
            setShellVisible(true)
            els.apiCategory.value = category as any
            els.apiCategory.disabled = true
            return
          }

          const maps = Array.isArray(obj?.maps) ? obj.maps : null
          if (maps) {
            const items = maps
              .filter((m: any) => typeof m?.mapCode === 'string')
              .map((m: any) => {
                const mapcode = String(m.mapCode)
                const ignored = Boolean(m.ignored)
                const reason = (m.reason ?? null) as any
                const reasonText = typeof reason === 'string' ? reason.trim() : ''
                return {
                  mapcode,
                  submitter: typeof m.submitter === 'string' ? m.submitter : null,
                  importedIgnored: ignored,
                  importedReason: reason ?? null,
                  review: ignored ? (reasonText ? reasonText : '') : '',
                  decision: ignored ? ('ignored' as const) : null,
                  status: ignored ? ('reviewed' as const) : ('pending' as const),
                } satisfies Pick<QueueItem, 'mapcode'> & Partial<QueueItem>
              })

            // atualiza metadata da sessão (best effort)
            state.session = {
              category: state.session?.category ?? String(obj?.category ?? 'P3'),
              inputMethod: 'session_json',
              startedAt: state.session?.startedAt ?? nowIso(),
              threadId:
                typeof obj?.threadId === 'string'
                  ? obj.threadId
                  : typeof obj?.threadId === 'number'
                    ? String(obj.threadId)
                    : null,
              collectedAt: typeof obj?.collectedAt === 'string' ? obj.collectedAt : null,
              limitPerUser: typeof obj?.limitPerUser === 'number' ? obj.limitPerUser : null,
            }
            persist()

            addItems(items, `session json: ${basename(path)}`)
            return
          }
        } catch {
          // fallback pra texto
        }
      }
      addMapcodes(parseMapcodesFromText(text), `file: ${basename(path)}`)
    } catch (e) {
      setStatus(`Failed to import file: ${String(e)}`)
    }
  })

  els.importFromApi.addEventListener('click', async () => {
    const categoryType = ((state.session?.category as ReviewedCategoryCode) || (els.apiCategory.value as ReviewedCategoryCode) || 'P3') as ReviewedCategoryCode
    setStatus(`Fetching session (${categoryType})...`)
    try {
      const res = await fetchSessionFromApi(categoryType)
      if (!res?.ok) {
        const err = res?.error?.error || 'unknown_error'
        if (err === 'no_active_session') {
          setStatus(`No active session for ${categoryType}.`)
        } else if (err === 'unauthorized') {
          setStatus('Session API: unauthorized (check SESSION_API_TOKEN).')
        } else if (err === 'missing_category') {
          setStatus('Session API: missing category.')
        } else {
          setStatus(`Session API error (${categoryType}): ${err}`)
        }
        return
      }

      const data = res.data
      if (!data) {
        setStatus(`Session API returned no data (${categoryType}).`)
        return
      }

      // grava metadados da sessão importada
      state.session = {
        category: String(data.category || categoryType),
        inputMethod: 'session_api',
        startedAt: state.session?.startedAt ?? nowIso(),
        threadId: String(data.threadId),
        collectedAt: data.collectedAt,
        limitPerUser: data.limitPerUser,
      }
      persist()

      if (!Array.isArray(data.maps) || data.maps.length === 0) {
        setStatus(`No maps in session (${data.category}). threadId=${data.threadId}`)
        return
      }

      const items = data.maps
        .filter((m) => typeof m?.mapCode === 'string')
        .map((m) => {
          const ignored = Boolean(m.ignored)
          const reason = (m.reason ?? null) as any
          const reasonText = typeof reason === 'string' ? reason.trim() : ''
          return {
            mapcode: m.mapCode,
            submitter: m.submitter ?? null,
            importedIgnored: ignored,
            importedReason: reason ?? null,
            review: ignored ? (reasonText ? reasonText : '') : '',
            decision: ignored ? ('ignored' as const) : null,
            status: ignored ? ('reviewed' as const) : ('pending' as const),
          } satisfies Pick<QueueItem, 'mapcode'> & Partial<QueueItem>
        })

      addItems(items, `api: ${data.category}`)
    } catch (e) {
      setStatus(`Failed to fetch session (${categoryType}): ${String(e)}`)
    }
  })

  els.openMassPerm.addEventListener('click', () => {
    openMassPerm()
  })

  type LauncherMode = 'session' | 'mass_perm' | 'custom_command'

  function renderWizard(
    step: 0 | 1 | 2 | 3,
    selectedCategory: ReviewedCategoryCode,
    selectedMethod: AppState['session'] extends any ? any : any,
    selectedMode: LauncherMode,
  ): void {
    const prevStep = Number.parseInt(els.wizard.dataset.step ?? '-1', 10)
    const prevScrollTop = els.wizard.querySelector<HTMLDivElement>('.wizardBody')?.scrollTop ?? 0

    const cat = REVIEW_CATEGORIES.find((c) => c.code === selectedCategory) ?? REVIEW_CATEGORIES[0]!

    const categoryTiles = REVIEW_CATEGORIES.map((c) => {
      const selected = c.code === selectedCategory ? 'selected' : ''
      const border = c.color ? `style="border-left: 4px solid ${c.color}"` : ''
      const img = c.picture ? `<img class="categoryIcon" src="${c.picture}" alt="${c.code}" />` : `<div class="categoryIcon"></div>`
      return `
        <button class="categoryTile ${selected}" data-cat="${c.code}" ${border}>
          ${img}
          <div class="categoryText">
            <div class="categoryName">${c.description}</div>
          </div>
        </button>
      `
    }).join('')

    const methodDefs: Array<{ id: AppState['session'] extends infer S ? (S extends { inputMethod: infer I } ? I : string) : string; title: string; desc: string }> = [
      { id: 'session_api', title: 'Discord Session (recommended)', desc: 'Fetch the active Discord session from your local API.' },
      { id: 'session_json', title: 'Session JSON file', desc: 'Import a JSON file with { category, maps[...] }.' },
      { id: 'file_text', title: 'Text/CSV file', desc: 'Import .txt/.csv with one mapcode per line.' },
      { id: 'clipboard', title: 'Clipboard', desc: 'Add from clipboard text.' },
      { id: 'textarea', title: 'Paste list', desc: 'Paste mapcodes into a textarea.' },
    ]

    const methodTiles = methodDefs
      .map((m) => {
        const selected = m.id === selectedMethod ? 'selected' : ''
        return `
          <button class="methodTile ${selected}" data-method="${m.id}">
            <div class="methodTitle">${m.title}</div>
            <div class="wizardHint">${m.desc}</div>
          </button>
        `
      })
      .join('')

    const launcherTiles = `
      <div class="methodGrid">
        <button class="methodTile ${selectedMode === 'session' ? 'selected' : ''}" data-launch="session">
          <div class="methodTitle">Start a new review session</div>
          <div class="wizardHint">Pick a category (P3…P24) and import maps for review.</div>
        </button>
        <button class="methodTile ${selectedMode === 'mass_perm' ? 'selected' : ''}" data-launch="mass_perm">
          <div class="methodTitle">Start a mass perm</div>
          <div class="wizardHint">Change category using <b>/p &lt;n&gt; @mapcode</b> at 0.25s intervals.</div>
        </button>
        <button class="methodTile ${selectedMode === 'custom_command' ? 'selected' : ''}" data-launch="custom_command">
          <div class="methodTitle">Start a custom command</div>
          <div class="wizardHint">Send <b>&lt;prefix&gt; @mapcode &lt;suffix&gt;</b> at fixed intervals.</div>
        </button>
      </div>
    `

    els.wizard.innerHTML = `
      <div class="wizardCard">
        <div class="wizardHeader">
          <div>
            <div class="wizardTitle">${step === 0 ? 'Choose a function' : 'New session setup'}</div>
            <div class="wizardHint">${
              step === 0
                ? 'Use the arrows to switch and press Start.'
                : step === 1
                  ? 'Choose the category you will review.'
                  : step === 2
                    ? 'Choose how you will import maps.'
                    : 'Paste the map list to import.'
            }</div>
          </div>
          <div class="wizardHint">${step === 0 ? '' : `Category: <b>${cat.description}</b>`}</div>
        </div>

        <div class="wizardBody">
          ${
            step === 0
              ? launcherTiles
              : step === 1
                ? `<div class="categoryGrid">${categoryTiles}</div>`
                : step === 2
                  ? `<div class="methodGrid">${methodTiles}</div>`
                  : `
                    <div class="kv">
                      <div class="k">Paste list</div>
                      <textarea id="wizPasteInput" class="textarea" rows="10" placeholder="One map per line (e.g. @6208666)"></textarea>
                      <div class="status" id="wizPasteStatus"></div>
                    </div>
                  `
          }
          ${
            step === 0
              ? `<div class="wizardHint">Tip: you can still open Mass perm later via the header button.</div>`
              : step === 3
                ? `<div class="wizardHint">This step is only needed for <b>Paste list</b>.</div>`
                : `<div class="wizardHint">
                    Decisions allowed for <b>${cat.code}</b>: ${cat.decisions.map((d) => DECISION_LABEL[d]).join(', ')}.
                  </div>`
          }
        </div>

        <div class="wizardFooter">
          <div class="wizardFooterLeft">
            ${step === 0 ? '' : `<button class="btn" id="wizCancel">Cancel</button>`}
            ${
              step === 0 && launcherAllowReturnToSession && state.session
                ? `<button class="btn" id="wizReturn">Return to current session</button>`
                : ''
            }
          </div>
          <div class="wizardFooterRight">
            ${
              step === 0
                ? `<button class="btn" id="wizPrev">◀</button><button class="btn" id="wizNextCarousel">▶</button>`
                : step === 2 || step === 3
                  ? `<button class="btn" id="wizBack">Back</button>`
                  : ''
            }
            <button class="btn primary" id="wizNext">${
              step === 0 ? 'Start' : step === 1 ? 'Next' : step === 2 ? 'Start session' : 'Done'
            }</button>
          </div>
        </div>
      </div>
    `

    // marca o step atual e restaura scroll quando só mudou seleção dentro do mesmo step
    els.wizard.dataset.step = String(step)
    if (prevStep === step && prevScrollTop > 0) {
      const body = els.wizard.querySelector<HTMLDivElement>('.wizardBody')
      if (body) body.scrollTop = prevScrollTop
    }

    // bind
    const cancel = els.wizard.querySelector<HTMLButtonElement>('#wizCancel')
    const next = els.wizard.querySelector<HTMLButtonElement>('#wizNext')!
    if (cancel) {
      cancel.addEventListener('click', () => {
        // Em categoria/import (wizard), cancelar volta para o Home (carrossel)
        openLauncher({ allowReturnToSession: Boolean(state.session) })
      })
    }

    if (step === 0) {
      const returnBtn = els.wizard.querySelector<HTMLButtonElement>('#wizReturn')
      if (returnBtn) {
        returnBtn.addEventListener('click', () => {
          els.wizard.style.display = 'none'
          launcherAllowReturnToSession = false
          setShellVisible(true)
          setStatus('Back to session.')
        })
      }

      const prevBtn = els.wizard.querySelector<HTMLButtonElement>('#wizPrev')!
      const nextBtn = els.wizard.querySelector<HTMLButtonElement>('#wizNextCarousel')!

      const toggleMode = (m?: LauncherMode, dir = 1) => {
        const modes: LauncherMode[] = ['session', 'mass_perm', 'custom_command']
        const idx = Math.max(0, modes.indexOf(selectedMode))
        const nextMode: LauncherMode = m ?? modes[(idx + dir + modes.length) % modes.length]!
        renderWizard(0, selectedCategory, selectedMethod, nextMode)
      }

      prevBtn.addEventListener('click', () => toggleMode(undefined, -1))
      nextBtn.addEventListener('click', () => toggleMode(undefined, 1))

      for (const btn of Array.from(els.wizard.querySelectorAll<HTMLButtonElement>('button[data-launch]'))) {
        btn.addEventListener('click', () => {
          const m = (btn.dataset.launch || selectedMode) as LauncherMode
          toggleMode(m)
        })
      }

      next.addEventListener('click', () => {
        // Se havia sessão ativa e o usuário decidiu iniciar outra função, limpa a sessão agora.
        if (state.session) {
          endCurrentSession()
        }

        if (selectedMode === 'mass_perm') {
          els.wizard.style.display = 'none'
          launcherAllowReturnToSession = false
          // se não existe sessão, continuamos com o shell oculto
          openMassPerm()
          return
        }
        if (selectedMode === 'custom_command') {
          els.wizard.style.display = 'none'
          launcherAllowReturnToSession = false
          openCustomCommand()
          return
        }
        renderWizard(1, selectedCategory, selectedMethod, selectedMode)
      })
      return
    }

    if (step === 2) {
      const back = els.wizard.querySelector<HTMLButtonElement>('#wizBack')!
      back.addEventListener('click', () => {
        renderWizard(1, selectedCategory, selectedMethod, selectedMode)
      })
    }

    if (step === 3) {
      const back = els.wizard.querySelector<HTMLButtonElement>('#wizBack')!
      back.addEventListener('click', () => {
        renderWizard(2, selectedCategory, selectedMethod, selectedMode)
      })

      const textarea = els.wizard.querySelector<HTMLTextAreaElement>('#wizPasteInput')!
      const statusEl = els.wizard.querySelector<HTMLDivElement>('#wizPasteStatus')!

      const setLocalStatus = (msg: string) => {
        statusEl.textContent = msg
      }

      next.addEventListener('click', () => {
        const mapcodes = parseMapcodesFromText(textarea.value)
        if (!mapcodes.length) {
          setLocalStatus('Nothing to import.')
          return
        }
        addMapcodes(mapcodes, 'paste list')
        els.wizard.style.display = 'none'
        launcherAllowReturnToSession = false
        setShellVisible(true)
      })
      return
    }

    if (step === 1) {
      for (const btn of Array.from(els.wizard.querySelectorAll<HTMLButtonElement>('button[data-cat]'))) {
        btn.addEventListener('click', () => {
          const code = (btn.dataset.cat || selectedCategory) as ReviewedCategoryCode
          renderWizard(1, code, selectedMethod, selectedMode)
        })
      }
      next.addEventListener('click', () => {
        renderWizard(2, selectedCategory, 'session_api', selectedMode)
      })
    } else {
      for (const btn of Array.from(els.wizard.querySelectorAll<HTMLButtonElement>('button[data-method]'))) {
        btn.addEventListener('click', () => {
          const m = (btn.dataset.method || selectedMethod) as any
          renderWizard(2, selectedCategory, m, selectedMode)
        })
      }
      next.addEventListener('click', async () => {
        // start session (wipe queue)
        state.items = []
        state.selectedId = null
        detailsBoundId = null
        state.session = {
          category: selectedCategory,
          inputMethod: selectedMethod,
          startedAt: nowIso(),
          threadId: null,
          collectedAt: null,
          limitPerUser: null,
        }
        persist()
        render()
        syncNp()
        // para "Paste list", não mostra o shell vazio antes de importar
        setShellVisible(selectedMethod !== 'textarea')

        // lock session category selector to match
        els.apiCategory.value = selectedCategory
        els.apiCategory.disabled = true

        // auto-run chosen method
        if (selectedMethod === 'textarea') {
          renderWizard(3, selectedCategory, selectedMethod, selectedMode)
          return
        }

        els.wizard.style.display = 'none'
        launcherAllowReturnToSession = false

        if (selectedMethod === 'session_api') {
          await (async () => els.importFromApi.click())()
        } else if (selectedMethod === 'clipboard') {
          await (async () => els.addFromClipboard.click())()
        } else if (selectedMethod === 'file_text' || selectedMethod === 'session_json') {
          await (async () => els.importFile.click())()
        }
      })
    }
  }

  function openLauncher(opts?: { allowReturnToSession?: boolean }): void {
    els.wizard.style.display = 'grid'
    els.massPerm.style.display = 'none'
    els.customCommand.style.display = 'none'
    launcherAllowReturnToSession = Boolean(opts?.allowReturnToSession && state.session)
    // Se não há sessão ativa, não mostrar a página vazia ao fundo
    setShellVisible(Boolean(state.session))
    renderWizard(0, 'P3', 'session_api', 'session')
  }

  els.newSession.addEventListener('click', () => {
    openLauncher()
  })

  els.homeBtn.addEventListener('click', () => {
    if (!state.session) {
      openLauncher()
      return
    }
    openConfirmLeave('home')
  })

  els.cancelSessionBtn.addEventListener('click', () => {
    if (!state.session) return
    openConfirmLeave('cancel')
  })

  els.exportSessionBtn.addEventListener('click', async () => {
    // backup (pode incluir XML para reabrir sem refetch)
    try {
      const path = await openExportSaveDialog(getDefaultBackupExportFileName())
      if (!path) return
      const payload = buildExportPayloadV1(state, undefined, { includeXml: true })
      const finalPath = await exportJsonToPath(path, payload)
      setStatus(`Backup saved: ${finalPath}`)
    } catch (e) {
      setStatus(`Failed to export JSON: ${String(e)}`)
    }
  })

  els.finishReviewBtn.addEventListener('click', () => {
    openConfirmFinishReview()
  })

  els.exportJson.addEventListener('click', async () => {
    try {
      const path = await openExportSaveDialog()
      if (!path) return
      const payload = buildExportPayloadV1(state, undefined, { includeXml: false })
      const finalPath = await exportJsonToPath(path, payload)
      setStatus(`Exported: ${finalPath}`)
    } catch (e) {
      setStatus(`Failed to export JSON: ${String(e)}`)
    }
  })

  els.addFromClipboard.addEventListener('click', async () => {
    try {
      const text = await readClipboardText()
      if (!text) {
        setStatus('Clipboard is empty (or has no text).')
        return
      }
      addMapcodes(parseMapcodesFromText(text), 'clipboard')
    } catch (e) {
      setStatus(`Failed to read clipboard: ${String(e)}`)
    }
  })

  els.autoCapture.addEventListener('change', async () => {
    const enabled = els.autoCapture.checked
    updateSettings({ autoCaptureClipboard: enabled })

    if (enabled) {
      try {
        if (!unlistenClipboard) {
          unlistenClipboard = await onClipboardChanged((text) => {
            scheduleAutoClipboardAdd(text)
          })
        }
        await startClipboardWatch()
        setStatus('Auto-capture enabled.')
      } catch (e) {
        setStatus(`Failed to start auto-capture: ${String(e)}`)
        els.autoCapture.checked = false
        updateSettings({ autoCaptureClipboard: false })
      }
    } else {
      try {
        await stopClipboardWatch()
        if (unlistenClipboard) {
          unlistenClipboard()
          unlistenClipboard = null
        }
        if (clipboardDebounceTimer) {
          window.clearTimeout(clipboardDebounceTimer)
          clipboardDebounceTimer = null
        }
        clipboardPendingText = null
        setStatus('Auto-capture disabled.')
      } catch (e) {
        setStatus(`Failed to stop auto-capture: ${String(e)}`)
      }
    }
  })

  // inicialização (autenticação antes de mostrar o Home)
  setShellVisible(false)
  renderAuth()
  void hydrateAppVersion()

  // hotkeys globais (best effort)
  void applyReviewHotkeysConfig().catch(() => {
    // best effort
  })
  // aplica estado salvo das hotkeys de review (best effort)
  void setReviewHotkeysEnabled(state.settings.reviewHotkeysEnabled).catch(() => {
    // best effort
  })

  // eventos de hotkeys globais (best effort)
  void onHotkeyPlayCurrent(() => void playSelected('hotkey: play current')).catch(() => {
    // best effort
  })
  void onHotkeyReplayCurrent(() => void playSelected('hotkey: replay current')).catch(() => {
    // best effort
  })
  void onHotkeyNavPlay((delta) => {
    selectRelative(delta)
    void playSelected(delta > 0 ? 'hotkey: next map' : 'hotkey: previous map')
  }).catch(() => {
    // best effort
  })
  void onHotkeysStatus((enabled) => {
    setStatus(`Global hotkeys: ${enabled ? 'enabled' : 'disabled'}.`)
  }).catch(() => {
    // best effort
  })

  // hotkeys globais do mass perm (best effort)
  void onHotkeyMassPermPlay(() => {
    if (!massPermHotkeysEnabled) return
    if (els.customCommand.style.display === 'grid') {
      const btn = els.customCommand.querySelector<HTMLButtonElement>('#ccPlay')
      btn?.click()
      return
    }
    if (els.massPerm.style.display === 'grid') {
      const btn = els.massPerm.querySelector<HTMLButtonElement>('#mpPlay')
      btn?.click()
    }
  }).catch(() => {
    // best effort
  })
  void onHotkeyMassPermPause(() => {
    if (!massPermHotkeysEnabled) return
    if (els.customCommand.style.display === 'grid') {
      const btn = els.customCommand.querySelector<HTMLButtonElement>('#ccPause')
      btn?.click()
      return
    }
    if (els.massPerm.style.display === 'grid') {
      const btn = els.massPerm.querySelector<HTMLButtonElement>('#mpPause')
      btn?.click()
    }
  }).catch(() => {
    // best effort
  })
  void onHotkeyMassPermNext(() => {
    if (!massPermHotkeysEnabled) return
    if (els.customCommand.style.display === 'grid') {
      const btn = els.customCommand.querySelector<HTMLButtonElement>('#ccNext')
      btn?.click()
      return
    }
    if (els.massPerm.style.display === 'grid') {
      const btn = els.massPerm.querySelector<HTMLButtonElement>('#mpNext')
      btn?.click()
    }
  }).catch(() => {
    // best effort
  })
  void onHotkeyMassPermPrev(() => {
    if (!massPermHotkeysEnabled) return
    if (els.customCommand.style.display === 'grid') {
      const btn = els.customCommand.querySelector<HTMLButtonElement>('#ccPrev')
      btn?.click()
      return
    }
    if (els.massPerm.style.display === 'grid') {
      const btn = els.massPerm.querySelector<HTMLButtonElement>('#mpPrev')
      btn?.click()
    }
  }).catch(() => {
    // best effort
  })

  void onMassPermHotkeysStatus((_enabled) => {
    // noop (UI state is source of truth right now)
  }).catch(() => {
    // best effort
  })

  if (state.settings.autoCaptureClipboard) {
    // liga no boot (best effort)
    Promise.resolve()
      .then(async () => {
        els.autoCapture.checked = true
        unlistenClipboard = await onClipboardChanged((text) => {
          scheduleAutoClipboardAdd(text)
        })
        await startClipboardWatch()
      })
      .catch(() => {
        // se falhar, simplesmente não habilita
        els.autoCapture.checked = false
        updateSettings({ autoCaptureClipboard: false })
      })
  }

  // OBS: após autenticar, `afterAuth()` decide se abre wizard/sessão
}

