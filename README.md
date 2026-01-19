# Maps Reviewer (Desktop)

A desktop app (Tauri) to review/decide maps from a `mapcode` queue, with global hotkeys to send `!np @mapcode` (or `/np`, `/npp`) into the active window, store review/decision, and **export JSON**.

## Requirements

- **Node.js** (LTS) and **npm**
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

## Export JSON

- Click **“Export JSON”** (top bar).
- Pick a location in the “Save As” dialog.
- The file is generated with a **stable schema**:
  - `schemaVersion` (currently `1`)
  - `appVersion`
  - `exportedAt` (ISO)
  - `settings`
  - `items[]` (with `mapcode`, `commandsUsed`, `review`, `decision`, `status`, timestamps, etc.)

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
- **macOS**: global hotkeys + “typing into the active window” require Accessibility permissions (above).

