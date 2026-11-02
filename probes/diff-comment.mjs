import { fromSources } from '@likec4/language-services/node'
import { readFileSync } from 'node:fs'
const src = readFileSync('fixtures/shop/model.c4', 'utf8')
const cfg = readFileSync('fixtures/shop/likec4.config.json', 'utf8')
const a = await fromSources({ 'likec4.config.json': cfg, 'model.c4': src }, { printErrors: false })
const b = await fromSources({ 'likec4.config.json': cfg, 'model.c4': '// c\n' + src }, { printErrors: false })
const da = (await a.layoutedModel()).$data, db = (await b.layoutedModel()).$data
const diffs = []
function walk(x, y, p) {
  if (JSON.stringify(x) === JSON.stringify(y)) return
  if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); return }
  diffs.push(p + ' : ' + JSON.stringify(x)?.slice(0, 60) + ' -> ' + JSON.stringify(y)?.slice(0, 60))
}
walk(da, db, '$')
console.log(diffs.length); console.log(diffs.slice(0, 15).join('\n'))
const keys = new Set(diffs.map(d => d.split(' : ')[0].split('.').slice(-1)[0])); console.log([...keys])
