/**
 * 部署 Cloudflare Workers 前修剪 dist：
 * Workers 静态资产单文件上限 25 MiB，超限文件（目前是社区原型
 * tidewake-town 的 release.storyforge-product.json，约 58.5 MiB）会被
 * wrangler 整体拒绝部署。这里把它们从 dist 移除，改由 R2 提供
 * （worker.ts 会在资产未命中时查 BUCKET）。
 *
 * 配套：先运行 `npm run upload:r2` 把 public/ 下的超限源文件上传到
 * R2 bucket storyforge-prototypes（键 = public 相对路径 = 资产路径）。
 */
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PUBLIC = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LIMIT = 24 * 1024 * 1024

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
for (const [full, size] of oversized) {
  const rel = '/' + relative(DIST, full).replaceAll('\\', '/')
  rmSync(full)
  console.log(`removed ${rel} (${(size / 1048576).toFixed(1)} MiB) — 将由 R2 提供`)
  if (!existsSync(join(PUBLIC, rel))) {
    console.log(`  警告：public/${rel.slice(1)} 不存在，npm run upload:r2 不会覆盖该路径，请确认来源`)
  }
}

if (oversized.length === 0) {
  console.log('no oversized assets found')
} else {
  console.log(`done: ${oversized.length} oversized file(s) removed from dist`)
  console.log('确保已上传：npm run upload:r2')
}
