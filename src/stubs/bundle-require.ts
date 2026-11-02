// Build-time replacement for `bundle-require`: JS/TS LikeC4 configs are not executed.
export const SCRIPT_CONFIG_UNSUPPORTED = 'likec4.config.js/ts is not supported by Markdown Preview for LikeC4; use likec4.config.json instead.'

export async function bundleRequire(): Promise<never> {
  throw new Error(SCRIPT_CONFIG_UNSUPPORTED)
}
