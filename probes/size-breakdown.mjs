import * as esbuild from 'esbuild'
for (const [entry, platform] of [['probes/ext/src/extension.ts','node'],['probes/ext/src/preview.tsx','browser']]) {
  const r = await esbuild.build({ entryPoints:[entry], bundle:true, platform, format: platform==='node'?'cjs':'iife', write:false, metafile:true, minify:true, external:['vscode'], jsx:'automatic', logLevel:'silent',
    mainFields: platform==='node'?['module','main']:undefined, conditions: platform==='node'?['node','import']:undefined,
    define: platform==='node'?{'import.meta.url':'__u'}:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.MODE':'"production"'}, loader:{'.css':'text'} })
  const by = {}
  for (const [k,v] of Object.entries(r.metafile.outputs)) for (const [i,b] of Object.entries(v.inputs)) { const m=i.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); const key=m?m[1]:'(src)'; by[key]=(by[key]||0)+b.bytesInOutput }
  console.log('==', entry); Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,14).forEach(([k,v])=>console.log(String(Math.round(v/1024)).padStart(6),'KB',k))
}
