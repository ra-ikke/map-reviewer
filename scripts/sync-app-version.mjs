import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.updater.conf.json')
const modelPath = path.join(root, 'src', 'app', 'model.ts')

const configRaw = fs.readFileSync(tauriConfigPath, 'utf8')
const config = JSON.parse(configRaw)
const version = String(config?.version || '').trim()

if (!version) {
  throw new Error('Missing version in tauri.updater.conf.json')
}

const modelRaw = fs.readFileSync(modelPath, 'utf8')
const nextModel = modelRaw.replace(
  /export const APP_VERSION = '([^']*)';/,
  `export const APP_VERSION = '${version}';`,
)

if (nextModel !== modelRaw) {
  fs.writeFileSync(modelPath, nextModel, 'utf8')
}
