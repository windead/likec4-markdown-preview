import { fromWorkspace } from '@likec4/language-services/node'
const root = process.argv[2]
const t0 = performance.now()
const l = await fromWorkspace(root, { printErrors: true })
console.log('init ms', Math.round(performance.now() - t0), 'projects', l.projects())
for (const p of l.projects()) {
  const t1 = performance.now()
  const m = await l.layoutedModel(p)
  console.log(p, 'layout ms', Math.round(performance.now() - t1), [...m.views()].map(v => `${v.id}:${v.$view._type}`).join(' '))
}
console.log('errors', l.getErrors().length)
await l.dispose()
