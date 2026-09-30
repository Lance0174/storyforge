/**
 * Cloudflare Worker 入口：静态资产托管 + AI 反向代理 + SPA 兜底。
 *
 * 应用把 base 硬编码为 /storyforge/（vite.config.ts、main.tsx、PWA scope），
 * 这里在 Worker 层把请求里的 /storyforge 前缀剥掉再取资产，dist 保持 Vite 原样输出，无需改构建。
 *
 * 反代路由与 vite.config.ts 的 dev proxy 一一对应：设置页「切换到本地代理」
 * 会把 baseUrl 存成 /xxx-proxy/... 相对路径，生产环境由本 Worker 接管这些请求，
 * 解决 DeepSeek / Kimi / 豆包等不发 CORS 头的服务商无法浏览器直连的问题。
 */

const BASE = '/storyforge'

const PROXY_ROUTES: Record<string, string> = {
  'deepseek-proxy': 'https://api.deepseek.com',
  'openai-proxy': 'https://api.openai.com',
  'kimi-proxy': 'https://api.moonshot.cn',
  'claude-proxy': 'https://api.anthropic.com',
  'nvidia-proxy': 'https://integrate.api.nvidia.com',
  'gemini-proxy': 'https://generativelanguage.googleapis.com',
  'doubao-proxy': 'https://ark.cn-beijing.volces.com',
  'agnes-proxy': 'https://apihub.agnes-ai.com',
  'longcat-proxy': 'https://api.longcat.chat',
  // opencode 在 vite dev proxy 里带 rewrite：/opencode-proxy/* → opencode.ai/zen/go/*
  'opencode-proxy': 'https://opencode.ai/zen/go',
  'siliconflow-proxy': 'https://api.siliconflow.cn',
  'qwen-proxy': 'https://dashscope.aliyuncs.com',
  'glm-proxy': 'https://open.bigmodel.cn',
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-max-age': '86400',
  }
}

async function handleProxy(request: Request, url: URL, route: string): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const target = PROXY_ROUTES[route]
  if (!target) return new Response('Not Found', { status: 404 })

  // /xxx-proxy/v1/chat/completions → https://target/v1/chat/completions
  const rest = url.pathname.slice(route.length + 1) || '/'
  const upstream = target + rest + url.search

  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) {
    if (name === 'host' || name === 'content-length' || name === 'connection' ||
        name.startsWith('cf-') || name.startsWith('x-forwarded-')) {
      headers.delete(name)
    }
  }

  return fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    // @ts-expect-error CF Workers 的 RequestInit 允许流式 body
    duplex: 'half',
  })
}

interface R2ObjectLike {
  body: ReadableStream
  size: number
  httpEtag?: string
  httpMetadata?: { contentType?: string } | null
}

interface Env {
  ASSETS: { fetch(request: RequestInfo | URL): Promise<Response> }
  // 可选：超大文件（>25 MiB 无法进静态资产）由 R2 提供，键为去掉 base 后的资产路径
  BUCKET?: { get(key: string): Promise<R2ObjectLike | null> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // 1) AI 反代路由优先
    const proxyMatch = path.match(/^\/([a-z0-9]+-proxy)(\/|$)/)
    if (proxyMatch) return handleProxy(request, url, proxyMatch[1])

    // 2) 根路径与未带前缀的深层链接都归到 /storyforge/ 下
    if (path === '/') return Response.redirect(url.origin + BASE + '/', 302)
    if (!path.startsWith(BASE)) {
      return Response.redirect(url.origin + BASE + path + url.search, 302)
    }

    // 3) 剥掉 /storyforge 前缀后从静态资产取文件
    const assetPath = path === BASE ? '/' : path.slice(BASE.length)
    const assetUrl = new URL(assetPath, url.origin)
    assetUrl.search = url.search
    let res = await env.ASSETS.fetch(new Request(assetUrl, request))

    // 4) 资产未命中时查 R2（超过 25 MiB 无法进静态资产的大文件，如社区原型数据）
    if (res.status === 404 && env.BUCKET) {
      const obj = await env.BUCKET.get(assetUrl.pathname.slice(1))
      if (obj) {
        const headers = new Headers()
        headers.set('content-type', obj.httpMetadata?.contentType ?? 'application/octet-stream')
        headers.set('content-length', String(obj.size))
        headers.set('cache-control', 'public, max-age=300')
        if (obj.httpEtag) headers.set('etag', obj.httpEtag)
        return new Response(request.method === 'HEAD' ? null : obj.body, {
          status: 200,
          headers,
        })
      }
    }

    // 5) 仍未命中且最后一段无扩展名 → SPA 兜底到入口 index.html（BrowserRouter 深层路由刷新）
    if (res.status === 404) {
      const last = assetUrl.pathname.split('/').pop() ?? ''
      if (!last.includes('.')) {
        res = await env.ASSETS.fetch(new URL('/index.html', url.origin).toString())
      }
    }
    return res
  },
}
