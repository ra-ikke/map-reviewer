const pat = (process.env.PAT ?? '').trim()
const repo = (process.env.GITHUB_REPOSITORY ?? '').trim()
const releaseId = (process.env.RELEASE_ID ?? '').trim()

if (!pat || !repo || !releaseId) {
  console.error('::error::Missing PAT, GITHUB_REPOSITORY, or RELEASE_ID.')
  process.exit(1)
}

const res = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ draft: false }),
})

if (!res.ok) {
  console.error(`::error::Failed to publish release (HTTP ${res.status}).`)
  console.error(await res.text())
  process.exit(1)
}

console.log('Release published.')
