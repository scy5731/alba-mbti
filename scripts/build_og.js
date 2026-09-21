/* 유형별 OG 카드(1200×630) 16장을 만들어 public/og/ 에 저장한다.
   카톡·페북에 albamates.com/r/{CODE} 링크를 붙였을 때 내 유형 카드가 뜨게 하는 용도.

   유형 데이터(PERSONAS)를 여기 복사해두면 index.html 과 어긋난다. 그래서 앱을 헤드리스
   크롬에 띄워 그 안의 PERSONAS 를 그대로 읽어 그린다 — 원본은 언제나 index.html 하나다.

   사용법:  node server.js            (다른 창에서, 기본 3000 포트)
            node scripts/build_og.js  [http://localhost:3000]
   크롬 경로가 다르면 CHROME 환경변수로 지정한다. */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const APP = process.argv[2] || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "public", "og");
const PORT = 9444;
const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 페이지 안에서 실행되는 그리기 코드. PERSONAS·AXIS_LABEL 은 앱의 것을 쓴다. */
const DRAW = `(() => {
  const W = 1200, H = 630;
  const font = (w, s) => w + " " + s + "px Pretendard, -apple-system, 'Malgun Gothic', sans-serif";
  window.__ogCard = async (code) => {
    const p = PERSONAS[code];
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    try { await document.fonts.ready; } catch (e) {}

    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#22C063");
    grad.addColorStop(1, "#138640");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(300, 315, 40, 300, 315, 420);
    glow.addColorStop(0, "rgba(255,255,255,.18)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);

    g.textAlign = "center";
    g.font = font(400, 170);
    g.fillText(p.emoji, 300, 375);

    g.textAlign = "left";
    g.fillStyle = "rgba(255,255,255,.8)";
    g.font = font(700, 32);
    g.fillText("알바 MBTI", 520, 185);

    g.fillStyle = "#fff";
    g.font = font(800, 116);
    try { g.letterSpacing = "8px"; } catch (e) {}
    g.fillText(code, 520, 300);
    try { g.letterSpacing = "0px"; } catch (e) {}

    g.font = font(800, 54);
    g.fillText(p.nick, 520, 375);

    g.fillStyle = "rgba(255,255,255,.82)";
    g.font = font(500, 32);
    g.fillText(p.tag, 520, 430);

    // 4축 라벨 줄 — 이 유형이 어떤 극성인지 한눈에
    g.fillStyle = "rgba(255,255,255,.95)";
    g.font = font(700, 28);
    g.fillText(code.split("").map((ch) => ch + " " + AXIS_LABEL[ch]).join("   ·   "), 520, 500);

    g.fillStyle = "rgba(255,255,255,.75)";
    g.font = font(600, 30);
    g.fillText("28문항으로 찾는 나에게 맞는 알바 · albamates.com", 520, 560);

    return cv.toDataURL("image/jpeg", 0.92);   // PNG 는 장당 900KB 라 링크 미리보기엔 과하다
  };
  return "ready";
})()`;

(async () => {
  if (!CHROME) { console.error("크롬을 찾지 못했어요. CHROME 환경변수로 경로를 지정하세요."); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(os.tmpdir(), "alba-og-profile");
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore" });

  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch (e) {}
    await sleep(500);
  }
  if (!target) { chrome.kill(); throw new Error("크롬 디버거에 붙지 못했어요"); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("페이지 오류: " + JSON.stringify(r.exceptionDetails.exception).slice(0, 300));
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: APP + "/?ogbuild=" + Date.now() });
  await sleep(4000);
  // 서비스워커가 옛 앱셸을 내주면 유형 데이터도 옛것이 된다.
  await ev(`(async () => { const rs = await navigator.serviceWorker.getRegistrations();
    for (const r of rs) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return 1; })()`);
  await send("Page.navigate", { url: APP + "/?ogbuild2=" + Date.now() });
  await sleep(4000);

  await ev(DRAW);
  const codes = await ev(`Object.keys(PERSONAS)`);
  if (!codes || codes.length !== 16) throw new Error(`PERSONAS 를 못 읽었어요 (${codes && codes.length}개)`);

  for (const code of codes) {
    const url = await ev(`__ogCard(${JSON.stringify(code)})`);
    const buf = Buffer.from(url.split("base64,")[1], "base64");
    fs.writeFileSync(path.join(OUT, code + ".jpg"), buf);
    console.log(` ${code}.jpg  ${(buf.length / 1024).toFixed(0)}KB`);
  }
  // 서버가 OG 제목·설명에 쓸 이름표. PERSONAS 원본은 index.html 하나뿐이므로 여기서 떨군다.
  const labels = await ev(`Object.fromEntries(Object.entries(PERSONAS).map(([k, v]) => [k, { nick: v.nick, tag: v.tag }]))`);
  fs.writeFileSync(path.join(OUT, "personas.json"), JSON.stringify(labels, null, 2));
  console.log(" personas.json");
  console.log(`\n완료 — ${codes.length}장 + 이름표를 public/og/ 에 저장했어요.`);
  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
