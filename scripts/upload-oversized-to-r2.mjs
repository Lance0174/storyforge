/**
 * 把 public/ 下超过 24 MiB 的源文件上传到 R2 bucket storyforge-prototypes，
 * 键 = public 相对路径（= 应用请求的资产路径去掉 /storyforge 前缀）。
 * 这些文件因超过 Workers 静态资产单文件 25 MiB 上限而无法进 dist，
 * 由 worker.ts 在资产未命中时从 R2 流式提供。
 *
 * 前置：npx wrangler login && npx wrangler r2 bucket create storyforge-prototypes
 * 运行：npm run upload:r2（上游更新超限文件后重跑即可）
 */
import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'

const BUCKET = 'storyforge-prototypes'
const PUBLIC = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LIMIT = 24 * 1024 * 1024

const MIME = {
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.cbz': 'application/vnd.comicbook+zip',
  '.zip': 'application/zip',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (st.size > LIMIT) out.push([full, st.size])
  }
  return out
}

const files = walk(PUBLIC)
if (files.length === 0) {
  console.log('no oversized files under public/')
  process.exit(0)
}

let failed = 0
for (const [full, size] of files) {
  const key = relative(PUBLIC, full).replaceAll('\\', '/')
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  console.log(`put ${BUCKET}/${key} (${(size / 1048576).toFixed(1)} MiB)`)
  const r = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
      '--file', full, '--content-type', MIME[ext] ?? 'application/octet-stream'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (r.status !== 0) failed++
}

if (failed > 0) {
  console.error(`\n${failed} upload(s) failed — 检查 wrangler 登录状态与 bucket 是否已创建`)
  process.exit(1)
}
console.log('\nall oversized files uploaded to R2')
