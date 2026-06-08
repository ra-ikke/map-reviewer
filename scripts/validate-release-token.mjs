const pat = (process.env.PAT ?? '').trim()
const repo = (process.env.GITHUB_REPOSITORY ?? '').trim()
const runId = (process.env.GITHUB_RUN_ID ?? '').trim()

if (!pat) {
  console.error('::error::RELEASE_TOKEN is missing.')
  console.error('Add a classic PAT (scope: repo) as repository secret RELEASE_TOKEN.')
  process.exit(1)
}

if (!repo) {
  console.error('::error::GITHUB_REPOSITORY is not set.')
  process.exit(1)
}

console.log(`RELEASE_TOKEN is configured (${pat.length} characters).`)

async function github(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
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

  return { status: res.status, json, text }
}

const user = await github('GET', '/user')
console.log(`GET /user => HTTP ${user.status}`)

if (user.status !== 200) {
  console.error('::error::RELEASE_TOKEN is invalid or expired.')
  if (user.text) console.error(user.text)
  process.exit(1)
}

const login = user.json?.login ?? 'unknown'
console.log(`Authenticated as: ${login}`)

const probeTag = `__probe_${runId || Date.now()}`
const release = await github('POST', `/repos/${repo}/releases`, {
  tag_name: probeTag,
  name: 'probe',
  body: 'probe',
  draft: true,
})

console.log(`POST /releases => HTTP ${release.status}`)

if (release.status !== 201) {
  console.error(`::error::RELEASE_TOKEN cannot create releases in ${repo}.`)
  if (release.text) console.error(release.text)
  console.error('')
  console.error('Common fixes:')
  console.error("  - Use a classic PAT with 'repo' scope (fine-grained tokens often fail here).")
  console.error('  - If the org uses SSO: https://github.com/settings/tokens > Configure SSO > Authorize.')
  console.error(`  - Confirm ${login} has write access to ${repo}.`)
  process.exit(1)
}

const releaseId = release.json?.id
if (releaseId) {
  await github('DELETE', `/repos/${repo}/releases/${releaseId}`)
}

console.log('Release write access confirmed.')
