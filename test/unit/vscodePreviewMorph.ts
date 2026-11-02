/*
 * Test helper reproducing how the VS Code Markdown preview applies content updates.
 *
 * `areNodesEqual` and the morphdom options below are adapted from
 * microsoft/vscode extensions/markdown-language-features/preview-src/index.ts (1.144.0).
 *
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import morphdom from 'morphdom'

export function areNodesEqual(a: Element, b: Element): boolean {
  const skippedAttrs = ['open']
  if (a.isEqualNode(b)) return true
  if (a.tagName !== b.tagName || a.textContent !== b.textContent) return false
  const aAttrs = [...a.attributes].filter(attr => !skippedAttrs.includes(attr.name))
  const bAttrs = [...b.attributes].filter(attr => !skippedAttrs.includes(attr.name))
  if (aAttrs.length !== bAttrs.length) return false
  for (let i = 0; i < aAttrs.length; ++i) {
    const aAttr = aAttrs[i]!
    const bAttr = bAttrs[i]!
    if (aAttr.name !== bAttr.name) return false
    if (aAttr.value !== bAttr.value && aAttr.name !== 'data-line') return false
  }
  const aChildren = Array.from(a.children)
  const bChildren = Array.from(b.children)
  return aChildren.length === bChildren.length && aChildren.every((x, i) => areNodesEqual(x, bChildren[i]!))
}

/** Re-creates <script> elements keeping only some attributes, like the preview's `domEval`. */
export function domEval(doc: Document, el: Element): void {
  const preserved = ['type', 'src', 'nonce', 'noModule', 'async']
  const scripts = el.tagName === 'SCRIPT' ? [el] : Array.from(el.getElementsByTagName('script'))
  for (const node of scripts) {
    const tag = doc.createElement('script')
    tag.text = node.textContent ?? ''
    for (const key of preserved) {
      const val = node.getAttribute(key)
      if (val) tag.setAttribute(key, val)
    }
    node.insertAdjacentElement('afterend', tag)
    node.remove()
  }
}

/** Applies `newBodyHtml` to `.markdown-body` the way the preview does for same-document updates. */
export function updateContent(doc: Document, newBodyHtml: string): void {
  const root = doc.querySelector('.markdown-body')!
  const parsed = new doc.defaultView!.DOMParser().parseFromString(`<div class="markdown-body">${newBodyHtml}</div>`, 'text/html')
  const newRoot = parsed.querySelector('.markdown-body')!
  morphdom(root, newRoot, {
    childrenOnly: true,
    onBeforeElUpdated: (fromEl: Element, toEl: Element) => {
      if (areNodesEqual(fromEl, toEl)) {
        const fromLines = fromEl.querySelectorAll('[data-line]')
        const toLines = toEl.querySelectorAll('[data-line]')
        for (let i = 0; i < fromLines.length; ++i) {
          const t = toLines[i]
          if (t) fromLines[i]!.setAttribute('data-line', t.getAttribute('data-line')!)
        }
        return false
      }
      return true
    },
    addChild: (parentNode: Node, childNode: Node) => {
      parentNode.appendChild(childNode)
      if (childNode instanceof doc.defaultView!.HTMLElement) domEval(doc, childNode)
    },
  } as any)
  doc.defaultView!.dispatchEvent(new doc.defaultView!.CustomEvent('vscode.markdown.updateContent'))
}

/** Initial load: the preview appends parsed content and runs domEval on each element. */
export function initialLoad(doc: Document, bodyHtml: string): void {
  const parsed = new doc.defaultView!.DOMParser().parseFromString(bodyHtml, 'text/html')
  const root = doc.querySelector('.markdown-body')!
  const els = [...parsed.body.children]
  root.append(...els)
  for (const el of els) domEval(doc, el)
}
