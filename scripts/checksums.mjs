/**
 * checksums.mjs — writes a checksums.txt next to the built installers.
 *
 *   node scripts/checksums.mjs release
 *
 * The updater inside the app reads this file from the GitHub release and
 * verifies the downloaded installer with SHA-256 before offering to run it.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = path.resolve(process.argv[2] || 'release')

if (!fs.existsSync(dir)) {
  console.error(`Folder not found: ${dir}`)
  process.exit(1)
}

const wanted = /\.(exe|zip|msi|dmg|AppImage)$/i
const files = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isFile() && wanted.test(d.name))
  .map((d) => d.name)
  .sort()

if (!files.length) {
  console.error(`No installer artefacts found in ${dir}. Run "npm run dist" first.`)
  process.exit(1)
}

const lines = []
for (const name of files) {
  const full = path.join(dir, name)
  const hash = crypto.createHash('sha256')
  const buf = fs.readFileSync(full)
  hash.update(buf)
  const digest = hash.digest('hex')
  const mb = (buf.length / 1048576).toFixed(1)
  lines.push(`${digest}  ${name}`)
  console.log(`${digest}  ${name}  (${mb} MB)`)
}

const out = path.join(dir, 'checksums.txt')
fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
console.log(`\nWrote ${out}`)
console.log('Upload checksums.txt to the same GitHub release as the installers.')
