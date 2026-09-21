/* 알바 MBTI 서비스워커 — 앱셸 캐싱 + 설치형(PWA) 지원.
   API(POST /api/*)와 CDN(교차출처)은 절대 가로채지 않음. */
const CACHE = "alba-mate-v10";   // 런칭 배포 — 버전을 올려야 기존 방문자가 옛 앱셸을 안 물고 있다
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
  if (req.method !== "GET") return;                 // 로그인 등 POST는 네트워크 그대로
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // CDN 스크립트는 건드리지 않음
  if (url.pathname.startsWith("/api/")) return;      // API 응답은 캐시 금지

  // HTML 내비게이션: 캐시된 앱셸을 '즉시' 내주고, 최신본은 뒤에서 받아 캐시만 갱신한다
  // (stale-while-revalidate). 네트워크 우선으로 두면 서버가 잠들어 깨어나는 동안
  // 호스팅 업체의 대기 화면을 몇십 초씩 보게 된다 — 그 사이에도 우리 앱이 뜨게 하려는 것.
  // 최신 HTML 은 다음 실행부터 반영된다.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("/").then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); }
            return res;
          })
          .catch(() => cached || caches.match("/index.html"));
        return cached || fresh;
      })
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
