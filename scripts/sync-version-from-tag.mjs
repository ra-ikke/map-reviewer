import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

// Semver 2.0 (Tauri `package.version` must match this)
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const PRERELEASE_SHORTHAND = {
  a: 'alpha',
  b: 'beta',
  rc: 'rc',
}

function normalizeReleaseVersion(rawTag) {
  const trimmed = String(rawTag ?? '').trim()
  if (!trimmed) {
    throw new Error('Missing release tag (expected e.g. 1.0.13 or v1.0.13-beta).')
  }

  let version = trimmed.replace(/^v/i, '').trim()

  // 1.0.13b → 1.0.13-beta (common mistake; invalid semver without hyphen)
  const gluedPrerelease = version.match(/^(\d+\.\d+\.\d+)([a-zA-Z][0-9a-zA-Z.-]*)$/)
  if (gluedPrerelease) {
    const [, base, suffix] = gluedPrerelease
    const lower = suffix.toLowerCase()
    let pre = suffix
    for (const [key, value] of Object.entries(PRERELEASE_SHORTHAND)) {
      if (lower === key || lower.startsWith(key)) {
        pre = lower === key ? value : `${value}${suffix.slice(key.length)}`
        break
      }
    }
    const normalized = `${base}-${pre}`
    console.warn(`Normalized tag "${trimmed}" to semver "${normalized}"`)
    version = normalized
  }

  if (!SEMVER_RE.test(version)) {
    throw new Error(
      `Invalid release tag "${trimmed}" (parsed as "${version}"). ` +
        'Use semver: 1.0.13 or 1.0.13-beta — not 1.0.13b (prerelease needs a hyphen).',
    )
  }

  return version
}

const rawTag = String(process.argv[2] ?? '').trim()
const version = normalizeReleaseVersion(rawTag)

function updateJsonVersion(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw)
  data.version = version
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function updateCargoTomlVersion(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const current = raw.match(/^version\s*=\s*"([^"]*)"/m)?.[1]
  if (current === version) {
    return
  }
  const next = raw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
  if (next === raw) {
    throw new Error(`Could not update version in ${filePath}`)
  }
  fs.writeFileSync(filePath, next, 'utf8')
}

updateJsonVersion(path.join(root, 'package.json'))
updateJsonVersion(path.join(root, 'src-tauri', 'tauri.conf.json'))
updateJsonVersion(path.join(root, 'src-tauri', 'tauri.updater.conf.json'))
updateCargoTomlVersion(path.join(root, 'src-tauri', 'Cargo.toml'))

const modelPath = path.join(root, 'src', 'app', 'model.ts')
const modelRaw = fs.readFileSync(modelPath, 'utf8')
const nextModel = modelRaw.replace(
  /export const APP_VERSION = '([^']*)';/,
  `export const APP_VERSION = '${version}';`,
)
fs.writeFileSync(modelPath, nextModel, 'utf8')

console.log(`Synced app version to ${version}`)
