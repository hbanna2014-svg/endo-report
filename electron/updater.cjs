/**
 * updater.cjs — checks GitHub Releases for a newer build and stages it locally.
 *
 * Deliberately conservative:
 *   • it never replaces or deletes anything by itself;
 *   • the patient database lives outside the application folder, so installing a
 *     new version cannot touch it;
 *   • before any schema migration the database is copied (see lifecycle.cjs);
 *   • downloads are verified (size, and SHA-256 when the release publishes a
 *     checksums file) before the user is invited to run them.
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const USER_AGENT = 'EndoReport-Updater'

/* -------------------------------------------------------------------------- */
/* Version helpers                                                             */
/* -------------------------------------------------------------------------- */

function parseVersion(v) {
  const cleaned = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
  const parts = cleaned.split('.').map((n) => Number.parseInt(n, 10))
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return null
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/* -------------------------------------------------------------------------- */
/* Release lookup                                                              */
/* -------------------------------------------------------------------------- */

async function githubJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    })
    if (res.status === 404) return { __notFound: true }
    if (!res.ok) throw new Error(`GitHub responded ${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @returns {Promise<{ok:boolean, current:string, latest?:string, hasUpdate?:boolean,
 *   notes?:string, publishedAt?:string, htmlUrl?:string, assets?:Array, error?:string}>}
 */
async function checkLatest({ owner, repo, currentVersion, includePrerelease = false }) {
  const base = `https://api.github.com/repos/${owner}/${repo}/releases`
  try {
    let release
    if (includePrerelease) {
      const list = await githubJson(`${base}?per_page=10`)
      if (Array.isArray(list)) release = list[0]
    } else {
      release = await githubJson(`${base}/latest`)
      if (release && release.__notFound) {
        const list = await githubJson(`${base}?per_page=5`)
        if (Array.isArray(list) && list.length) release = list[0]
      }
    }
    if (!release || release.__notFound) {
      return { ok: false, current: currentVersion, error: 'No published release was found for this repository yet.' }
    }

    const assets = (release.assets || []).map((a) => ({
      name: a.name,
      size: a.size,
      contentType: a.content_type,
      downloadUrl: a.browser_download_url,
      updatedAt: a.updated_at,
    }))

    return {
      ok: true,
      current: currentVersion,
      latest: release.tag_name || release.name,
      hasUpdate: compareVersions(release.tag_name, currentVersion) > 0,
      notes: release.body || '',
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      prerelease: !!release.prerelease,
      htmlUrl: release.html_url,
      assets,
      checkedAt: new Date().toISOString(),
    }
  } catch (err) {
    return {
      ok: false,
      current: currentVersion,
      error:
        err.name === 'AbortError'
          ? 'The update check timed out. Check the internet connection and try again.'
          : `Could not reach GitHub: ${err.message}`,
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

function updatesDir(dataDir) {
  const dir = path.join(dataDir, 'updates')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function sha256File(file, onProgress) {
  const hash = crypto.createHash('sha256')
  const total = fs.statSync(file).size
  let read = 0
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => {
      hash.update(chunk)
      read += chunk.length
      onProgress?.(read, total)
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

/** Downloads `checksums.txt` from the release, if the project publishes one. */
async function fetchChecksums(asset) {
  if (!asset?.downloadUrl) return null
  try {
    const res = await fetch(asset.downloadUrl, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const text = await res.text()
    const map = {}
    for (const line of text.split(/\r?\n/)) {
      const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())
      if (m) map[m[2].trim()] = m[1].toLowerCase()
    }
    return map
  } catch {
    return null
  }
}

/**
 * Streams a release asset to `<dataDir>/updates/`.
 * onProgress receives {received, total, percent}.
 */
async function download(asset, dataDir, onProgress) {
  if (!asset?.downloadUrl) throw new Error('No download URL was supplied.')
  const dir = updatesDir(dataDir)
  const safeName = path.basename(asset.name || 'endorreport-update.bin').replace(/[^A-Za-z0-9._-]/g, '_')
  const target = path.join(dir, safeName)

  const res = await fetch(asset.downloadUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
    redirect: 'follow',
  })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status} ${res.statusText}).`)

  const total = Number(res.headers.get('content-length')) || asset.size || 0
  let received = 0
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    received += chunk.length
    onProgress?.({
      received,
      total,
      percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
    })
  })

  await pipeline(body, fs.createWriteStream(target))

  const stat = await fsp.stat(target)
  if (asset.size && stat.size !== asset.size) {
    throw new Error(`The download is incomplete (${stat.size} of ${asset.size} bytes). Try again.`)
  }

  // Verify against the published checksum when one is available.
  let expected = null
  if (Array.isArray(asset.checksumAssets) && asset.checksumAssets.length) {
    const map = await fetchChecksums(asset.checksumAssets[0])
    expected = map?.[asset.name] || null
  } else if (asset.expectedSha256) {
    expected = String(asset.expectedSha256).toLowerCase()
  }

  let actual = null
  if (expected) actual = await sha256File(target)

  return {
    filePath: target,
    bytes: stat.size,
    sha256: actual,
    verified: expected ? actual === expected : null,
    expectedSha256: expected,
    // An unverified download is still staged, but the UI says so plainly.
    verifyNote: expected
      ? actual === expected
        ? 'SHA-256 matches the published checksum.'
        : 'SHA-256 does NOT match — do not run this file.'
      : 'No checksum was published for this file; only the download size was verified.',
  }
}

async function checksumAssetsFor(checkResult, assetName) {
  if (!checkResult?.assets) return []
  return checkResult.assets.filter((a) => /^checksums.*\.(txt|sha256)$/i.test(a.name) && a.name !== assetName)
}

module.exports = {
  parseVersion,
  compareVersions,
  checkLatest,
  download,
  checksumAssetsFor,
  sha256File,
  updatesDir,
}
