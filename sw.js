/* ============================================================
   sw.js — Service Worker（离线外壳）
   策略：
     · 导航请求（mode === 'navigate'）→ 网络优先，失败回退缓存
       （内容更新永远能第一时间看到，缓存只在断网时兜底）
     · 同源静态资源（/assets/、/images/、/src/）→ 缓存优先
     · 跨域请求（第三方脚本 / 字体 CDN 等）→ 完全不接管、不缓存
   升级：改动资源后把 VERSION 加一，activate 会清掉旧缓存。
   ============================================================ */

const VERSION = 'v1'
const CACHE = `hkathy-shell-${VERSION}`

/* 应用外壳：安装时预缓存 */
const SHELL = ['/', '/manifest.webmanifest', '/images/avatar.webp']

/* 走缓存优先的同源静态资源前缀 */
const STATIC_PREFIXES = ['/assets/', '/images/', '/src/']

/* ---------------- 安装：预缓存外壳 ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 逐个 add：单个资源缺失（404/离线）不连累整个 SW 安装失败
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  )
})

/* ---------------- 激活：清理旧版本缓存 ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

/* ---------------- 请求拦截 ---------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // 跨域（第三方脚本 / 字体 CDN 等）一律不接管，避免缓存第三方内容
  if (url.origin !== self.location.origin) return

  /* 导航请求：网络优先 → 失败回退缓存的外壳 */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 只把外壳存到 '/'，SPA 各路径都复用它
          if (response && response.ok) {
            const copy = response.clone()
            caches
              .open(CACHE)
              .then((cache) => cache.put('/', copy))
              .catch(() => null)
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match('/')),
        ),
    )
    return
  }

  /* 同源静态资源：缓存优先 */
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches
              .open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => null)
          }
          return response
        })
      }),
    )
  }
})
