import { fromWorkspace } from '@likec4/language-services/node'
import { LikeC4Model } from '@likec4/core/model'
const l = await fromWorkspace('fixtures', { printErrors: false })
const m = await l.layoutedModel('shop')
const d = JSON.parse(JSON.stringify(m.$data))
console.log('keys', Object.keys(d), 'views type', Array.isArray(d.views) ? 'array' : typeof d.views, Object.keys(d.views))
const trimmed = { ...d, views: { checkout: d.views.checkout } }
const tm = LikeC4Model.create(trimmed)
const v = tm.findView('checkout')
console.log('trimmed views', [...tm.views()].map(v => v.id), 'isLayouted', v?.isLayouted(), 'nodes', v?.$layouted?.nodes.length, 'seq', !!v?.$layouted?.sequenceLayout)
console.log('bytes full', JSON.stringify(d).length, 'trimmed', JSON.stringify(trimmed).length)
await l.dispose()
