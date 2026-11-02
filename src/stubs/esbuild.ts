// Build-time replacement for `esbuild` (only used by @likec4/config to format bundle errors).
export function formatMessagesSync(messages: Array<{ text?: string }>): string[] {
  return messages.map(m => String(m?.text ?? ''))
}
