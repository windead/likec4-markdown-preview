/**
 * Build-time replacement for `jiti`, which @likec4/config 1.61 uses to evaluate
 * likec4.config.{js,mjs,cjs,ts,mts,cts}. Those configs are not supported; the
 * extension resolves JSON configs only (see src/projects.ts).
 */
export const SCRIPT_CONFIG_UNSUPPORTED = 'likec4.config.js/ts is not supported by Markdown Preview for LikeC4; use likec4.config.json instead.'

export function createJiti(): never {
  throw new Error(SCRIPT_CONFIG_UNSUPPORTED)
}
