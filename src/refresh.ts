/**
 * Decides when to run `markdown.preview.refresh`. That command force-reloads every open
 * Markdown preview, so it only runs when an affected project is referenced by an open document
 * and a Markdown preview is visible; multiple changes in a short window are merged.
 */
export interface RefreshHost {
  /** Documents (URI strings) referencing a project key. */
  documentsReferencing(projectKeys: ReadonlyArray<string>): string[]
  /** True when at least one Markdown preview is open. */
  hasOpenPreview(): boolean
  /** Whether the document is still open (or shown in a preview). */
  isDocumentOpen(docUri: string): boolean
  refresh(reason: string): void
}

export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly keys = new Set<string>()
  private reasons: string[] = []

  constructor(private readonly host: RefreshHost, private readonly delayMs = 5) {}

  /** Called when the snapshots of these project keys changed. */
  projectsChanged(projectKeys: ReadonlyArray<string>, reason: string) {
    for (const k of projectKeys) this.keys.add(k)
    this.reasons.push(reason)
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  /** Unconditional refresh request (settings / project set changed). */
  refreshAll(reason: string) {
    this.keys.add('*')
    this.reasons.push(reason)
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = undefined
    const keys = [...this.keys]
    const reasons = this.reasons
    this.keys.clear()
    this.reasons = []
    if (keys.length === 0 || !this.host.hasOpenPreview()) return
    if (!keys.includes('*')) {
      const docs = this.host.documentsReferencing(keys).filter(d => this.host.isDocumentOpen(d))
      if (docs.length === 0) return
    }
    this.host.refresh([...new Set(reasons)].join('; '))
  }

  dispose() {
    clearTimeout(this.timer)
  }
}
