# Maps Reviewer (Desktop)

A desktop app (Tauri) to review/decide maps from a `mapcode` queue, with global hotkeys to send `!np @mapcode` (or `/np`, `/npp`) into the active window, store review/decision, and **export JSON**.

## Requirements

- **Node.js** 24 LTS and **npm**
- **Rust** (stable toolchain)
- **Tauri v2** OS prerequisites (webview / native toolchain)

Tip: follow the official Tauri prerequisites guide for your OS: `https://tauri.app/start/prerequisites/`

## Run in development

In `maps-reviewer-desktop/`:

```bash
npm install
npm run dev
```

In another terminal (or via Tauri):

```bash
npx tauri dev
```

## Session API configuration

The app reads Session API settings from three places (priority order):


1. Runtime environment variables
2. `.env` file (sibling `xero3.0/.env`)
3. Build-time environment variables

Supported variables:

- `SESSION_API_BASE_URL` (full base URL)
- `SESSION_API_HOST` and `SESSION_API_PORT`
- `SESSION_API_TOKEN` (Bearer token)

Example (build-time for CI):

```bash
SESSION_API_BASE_URL=https://ikke-dev.com.br/ npx tauri build
```

## Finish review — forum discussions

When finishing a review, if any maps have the **will be discussed** decision, the confirmation modal lists them with checkboxes (select all or individual). On **Save & finish**, the app can create PERM forum threads on Discord via `POST /discussion` using your **Auth token** (`Authorization: Bearer <userToken>`).

- Requires a valid user token (Settings → Auth).
- Selected maps are created with `discType: PERM` and `notify: true`.
- Results (including `jumpUrl` links) appear in the post-finish summary modal.

## Export JSON

- Click **"Export JSON"** (top bar).
- Pick a location in the "Save As" dialog.
- The file is generated with a **stable schema**:
  - `schemaVersion` (currently `1`)
  - `appVersion`
  - `exportedAt` (ISO)
  - `settings`
  - `items[]` (with `mapcode`, `commandsUsed`, `review`, `decision`, `status`, timestamps, etc.)

## Global hotkeys

Shortcuts are registered at the OS level and work in **any app** (e.g. the game window). They do **not** require Discord to be focused — the app types the load command into whichever window is active.

Enable **Hotkeys** in the Queue panel (review session) or in Mass perm / Custom command. Use **Config hotkeys** to change bindings.

### Review session

| Action | Default key |
|--------|-------------|
| **Previous map** | `PageUp` |
| **Next map** | `PageDown` |
| **Play current map** | `Insert` |

**Previous map** / **Next map** select the adjacent map in the queue and send the load command. **Play current map** re-sends the command for the selected map.

### Mass perm / Custom command

| Action | Default key |
|--------|-------------|
| **Play / Pause / Resume** | `Ctrl+P` |
| **Play current map** | `Insert` |
| **Previous map** | `PageUp` |
| **Next map** | `PageDown` |

Mass perm hotkeys are active only while the Mass perm or Custom command screen is open and **no review session** is running (review hotkeys take priority).

## macOS permissions (important)

This app uses:

- **Global hotkeys** (shortcuts work outside the app)
- **Keyboard injection** to type the command into the **active window** and press Enter

On macOS, for typing into the active window to work, you must allow **Accessibility**:

1. Open **System Settings** → **Privacy & Security**
2. Go to **Accessibility**
3. Enable **Maps Reviewer** (or the binary you are running)

If you run via `npx tauri dev`, you may also need to allow the process launching the app (depends on macOS version).

## Build an executable to share

In `maps-reviewer-desktop/`:

```bash
npm install
npx tauri build
```

Artifacts are located at `maps-reviewer-desktop/src-tauri/target/release/bundle/`, for example:

- **Windows**: `.msi` (or `.exe` depending on target)
- **macOS**: `.app` / `.dmg`
- **Linux**: `.deb` / `.AppImage` / etc.

### Notes

- **Windows**: if Tauri complains about WebView2, install **Microsoft Edge WebView2 Runtime**.
- **macOS**: global hotkeys + "typing into the active window" require Accessibility permissions (above).

## GitHub Releases (CI)

Push a **semver** tag to trigger `.github/workflows/tauri-release.yml` (e.g. `1.0.13` or `1.0.13-beta`). The workflow syncs the app version from the tag, builds for Linux/macOS/Windows, and publishes a GitHub Release with updater artifacts (`latest.json`, `.sig`).

Valid tag examples: `1.0.13`, `v1.0.13`, `1.0.13-beta`, `v1.0.13-rc.1`.  
Invalid: `1.0.13b` (use `1.0.13-beta` — prerelease must be separated with `-`).

Releases require a **classic PAT** saved as repository secret `RELEASE_TOKEN` (scope `repo`). The workflow no longer relies on `GITHUB_TOKEN` for publishing.

### Configure `RELEASE_TOKEN`

1. GitHub profile → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. **Generate new token (classic)** with scope **`repo`**
3. If the org uses SSO (e.g. `ra-ikke`): on the tokens page click **Configure SSO** → **Authorize** for the organization
4. Repo **Settings → Secrets and variables → Actions** → secret name **`RELEASE_TOKEN`** (exact name)

Use a **classic** token. Fine-grained tokens often fail with Tauri/org repos.

### CI troubleshooting

| Error | Fix |
| --- | --- |
| `RELEASE_TOKEN is missing` | Create the secret in the **repository** (not only org-level), name exactly `RELEASE_TOKEN`. |
| `RELEASE_TOKEN is invalid or expired` | Regenerate the PAT and update the secret. |
| `RELEASE_TOKEN cannot create releases` | Authorize SSO for the org; confirm your user has write access to the repo; use classic PAT with `repo` scope. |
| `Resource not accessible by integration` | The publish step was still using `GITHUB_TOKEN` — pull the latest workflow (uses `RELEASE_TOKEN` + `softprops/action-gh-release`). |
| `package > version must be a semver string` | Tag is not valid semver (e.g. `1.0.13b`). Re-tag as `1.0.13-beta` or push a fixed `sync-version-from-tag.mjs` and re-run the workflow. |

The `Couldn't parse --config flag as inline JSON` message is harmless — the CLI falls back to the config file path.
