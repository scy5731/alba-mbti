/* 알바 MBTI 서비스워커 — 앱셸 캐싱 + 설치형(PWA) 지원.
   결제(POST /api/*)와 토스/CDN(교차출처)은 절대 가로채지 않음. */
const CACHE = "alba-mate-v3";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // 결제 등 POST는 네트워크 그대로
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // CDN·토스 SDK는 건드리지 않음
  if (url.pathname.startsWith("/api/")) return;      // API 응답은 캐시 금지

  // HTML 내비게이션: 네트워크 우선(항상 최신), 오프라인이면 캐시된 앱셸
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/").then((m) => m || caches.match("/index.html")))
    );
    return;
  }

  // 그 외 정적 자원(아이콘·manifest 등): 캐시 우선, 없으면 네트워크 후 저장
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    }))
  );
});
