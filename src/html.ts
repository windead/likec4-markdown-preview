/** Serializes a value as JSON safe to embed inside <script type="application/json">. */
export function jsonForScript(value: unknown): string {
  return escapeJsonForScript(JSON.stringify(value))
}

/** Escapes characters that could terminate or confuse an inline script block. */
export function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Escapes text for use inside a double- or single-quoted HTML attribute or element content. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
