import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

const rawTag = String(process.argv[2] ?? '').trim()
const version = rawTag.replace(/^v/i, '').trim()

if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Invalid release tag version: "${rawTag}"`)
}

function updateJsonVersion(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw)
  data.version = version
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

updateJsonVersion(path.join(root, 'package.json'))
updateJsonVersion(path.join(root, 'src-tauri', 'tauri.conf.json'))
updateJsonVersion(path.join(root, 'src-tauri', 'tauri.updater.conf.json'))

const modelPath = path.join(root, 'src', 'app', 'model.ts')
const modelRaw = fs.readFileSync(modelPath, 'utf8')
const nextModel = modelRaw.replace(
  /export const APP_VERSION = '([^']*)';/,
  `export const APP_VERSION = '${version}';`,
)
fs.writeFileSync(modelPath, nextModel, 'utf8')

console.log(`Synced app version to ${version}`)
