import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * Validates that the extension version follows Strategy B:
 * `<LikeC4_MAJOR>.<LikeC4_MINOR>.<LikeC4_PATCH * 100 + EXT_REV>`
 * and that all `@likec4/*` dependencies and `description` stay in sync.
 */
export function verifyVersion(pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const extVersion = pkg.version
  const extMatch = SEMVER_RE.exec(extVersion ?? '')
  if (!extMatch) {
    throw new Error(`Invalid extension version "${extVersion}": expected strict MAJOR.MINOR.PATCH`)
  }
  const [, extMaj, extMin, extPat] = extMatch.map(Number)

  const likec4Entries = Object.entries(pkg.dependencies ?? {}).filter(([name]) => name.startsWith('@likec4/'))
  if (likec4Entries.length === 0) {
    throw new Error('No @likec4/* dependencies found in package.json')
  }

  const versions = new Set()
  for (const [name, ver] of likec4Entries) {
    if (!SEMVER_RE.test(ver)) {
      throw new Error(`Dependency ${name} must use an exact MAJOR.MINOR.PATCH version, got "${ver}"`)
    }
    versions.add(ver)
  }
  if (versions.size !== 1) {
    throw new Error(`All @likec4/* dependencies must share the same version, got: ${[...versions].join(', ')}`)
  }

  const [likec4Version] = versions
  const [, lMaj, lMin, lPat] = SEMVER_RE.exec(likec4Version).map(Number)

  const expectedMinPatch = lPat * 100
  const expectedMaxPatch = expectedMinPatch + 99
  if (extMaj !== lMaj || extMin !== lMin || extPat < expectedMinPatch || extPat > expectedMaxPatch) {
    throw new Error(
      `Extension version "${extVersion}" does not match bundled LikeC4 "${likec4Version}". ` +
      `Expected ${lMaj}.${lMin}.${expectedMinPatch}..${expectedMaxPatch} (LikeC4_PATCH * 100 + EXT_REV).`,
    )
  }

  const expectedDescToken = `LikeC4 ${likec4Version}`
  if (!String(pkg.description ?? '').includes(expectedDescToken)) {
    throw new Error(
      `package.json description must mention "${expectedDescToken}" so users can see the bundled LikeC4 version.`,
    )
  }

  return {
    extVersion,
    likec4Version,
    extRevision: extPat - expectedMinPatch,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = verifyVersion()
  console.log(
    `Version check passed: extension ${info.extVersion} -> LikeC4 ${info.likec4Version} (ext revision ${info.extRevision})`,
  )
}
