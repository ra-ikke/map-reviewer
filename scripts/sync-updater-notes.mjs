/**
 * Ensures latest.json `notes` matches the GitHub Release body.
 * Tauri updater reads notes from latest.json (not the Release page),
 * and tauri-action only fills notes from its `releaseBody` input.
 *
 * Usage (CI):
 *   PAT=... GITHUB_REPOSITORY=owner/repo RELEASE_ID=123 node scripts/sync-updater-notes.mjs
 *
 * Usage (local/tag):
 *   PAT=... GITHUB_REPOSITORY=owner/repo TAG=1.0.16 node scripts/sync-updater-notes.mjs
 */
const pat = (process.env.PAT ?? process.env.RELEASE_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim()
const repo = (process.env.GITHUB_REPOSITORY ?? '').trim()
const releaseId = (process.env.RELEASE_ID ?? '').trim()
const tag = (process.env.TAG ?? '').trim()

if (!pat || !repo) {
  console.error('::error::Missing PAT/RELEASE_TOKEN and GITHUB_REPOSITORY.')
  process.exit(1)
}
if (!releaseId && !tag) {
  console.error('::error::Provide RELEASE_ID or TAG.')
  process.exit(1)
}

const api = async (method, path, body, accept = 'application/vnd.github+json') => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`)
  }
  return { res, json, text }
}

const releasePath = releaseId
  ? `/repos/${repo}/releases/${releaseId}`
  : `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`

const { json: release } = await api('GET', releasePath)
const notes = String(release.body ?? '').trim()
if (!notes) {
  console.log('Release body is empty; nothing to sync into latest.json.')
  process.exit(0)
}

const assets = Array.isArray(release.assets) ? release.assets : []
const latestAsset = assets.find((a) => a.name === 'latest.json')
if (!latestAsset) {
  console.log('latest.json asset not found on release; skip.')
  process.exit(0)
}

const downloadRes = await fetch(latestAsset.url, {
  headers: {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/octet-stream',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  redirect: 'follow',
})
if (!downloadRes.ok) {
  throw new Error(`Failed to download latest.json (${downloadRes.status})`)
}
const current = JSON.parse(await downloadRes.text())
const currentNotes = String(current.notes ?? '').trim()
if (currentNotes === notes) {
  console.log('latest.json notes already match the release body.')
  process.exit(0)
}

const next = { ...current, notes }
const blob = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8')

await api('DELETE', `/repos/${repo}/releases/assets/${latestAsset.id}`)

const uploadUrl = new URL(String(release.upload_url).replace(/\{.*\}$/, ''))
uploadUrl.searchParams.set('name', 'latest.json')

const uploadRes = await fetch(uploadUrl.toString(), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(blob.length),
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: blob,
})
if (!uploadRes.ok) {
  throw new Error(`Failed to upload latest.json (${uploadRes.status}): ${(await uploadRes.text()).slice(0, 500)}`)
}

console.log(`Synced latest.json notes from release ${release.tag_name} (${notes.length} chars).`)
