/**
 * 部署 Cloudflare Workers 前修剪 dist：
 * Workers 静态资产单文件上限 25 MiB，超限文件（目前是社区原型
 * tidewake-town 的 release.storyforge-product.json，约 58.5 MiB）会被
 * wrangler 整体拒绝部署。这里删除超限文件，并同步移除 catalog.json
 * 里指向它们的条目，让社区原型画廊显示为空列表而不是加载失败的坏条目。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LIMIT = 24 * 1024 * 1024

const removed = new Set()

// 先记下超限文件再删除，避免边遍历边删导致后续 stat 报错
const oversized = []
function sizedWalk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      sizedWalk(full)
    } else if (st.size > LIMIT) {
      oversized.push([full, st.size])
    }
  }
}

sizedWalk(DIST)
const statSyncCache = new Map(oversized)
for (const full of statSyncCache.keys()) {
  const rel = '/' + relative(DIST, full).replaceAll('\\', '/')
  rmSync(full)
  removed.add(rel)
  console.log(`removed ${rel} (${(statSyncCache.get(full) / 1048576).toFixed(1)} MiB)`)
}

if (removed.size === 0) {
  console.log('no oversized assets found')
} else {
  // 清理 catalog.json 中指向已删除文件的条目
  const catalogPath = join(DIST, 'prototypes', 'catalog.json')
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'))
    const before = catalog.prototypes?.length ?? 0
    catalog.prototypes = (catalog.prototypes ?? []).filter(
      (p) => !removed.has(p.releasePath),
    )
    if (catalog.prototypes.length !== before) {
      writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
      console.log(`catalog.json: ${before} -> ${catalog.prototypes.length} prototypes`)
    }
  } catch {
    console.log('no catalog.json to clean (skipped)')
  }
  console.log(`done: ${removed.size} oversized file(s) removed`)
}
