/* 카드뉴스 슬라이드 → HTML 생성기.
   node promo/render.js  →  promo/html/<slug>-<n>.html
   이후 헤드리스 크롬으로 1080x1350 PNG로 캡처한다(promo/build.sh). */
const fs = require("fs");
const path = require("path");
const SETS = require("./slides.js");

const OUT = path.join(__dirname, "html");
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nl = (s) => esc(s).replace(/\n/g, "<br/>");

const CSS = `
@font-face{font-family:Pretendard;font-weight:600;font-display:block;src:url("../fonts/Pretendard-SemiBold.woff2") format("woff2")}
@font-face{font-family:Pretendard;font-weight:700;font-display:block;src:url("../fonts/Pretendard-Bold.woff2") format("woff2")}
@font-face{font-family:Pretendard;font-weight:800;font-display:block;src:url("../fonts/Pretendard-ExtraBold.woff2") format("woff2")}
*{margin:0;padding:0;box-sizing:border-box}
:root{--brand:#1BB055;--brandDark:#17924A;--brandLt:#E8F8EE;--ink:#222222;--gray:#7A8698}
html,body{width:1080px;height:1350px}
body{font-family:Pretendard,"Malgun Gothic","맑은 고딕",sans-serif;color:var(--ink);
  -webkit-font-smoothing:antialiased;letter-spacing:-0.02em;overflow:hidden}
.slide{width:1080px;height:1350px;padding:96px 88px;display:flex;flex-direction:column;position:relative;background:#fff}
.slide.dark{background:linear-gradient(160deg,#3FC85D 0%,#1BB055 45%,#17924A 100%);color:#fff}

/* --- 커버 --- */
.cover-main{margin:auto 0}
.kicker{display:inline-block;background:#fff;color:var(--brand);
  font-size:32px;font-weight:800;padding:16px 30px;border-radius:999px;margin-bottom:56px}
.cover-title{font-size:96px;font-weight:800;line-height:1.22;letter-spacing:-0.035em}
.cover-hl{margin-top:52px;background:rgba(255,255,255,.16);border:3px solid rgba(255,255,255,.45);
  border-radius:36px;padding:44px 48px;font-size:60px;font-weight:800;line-height:1.35}
.cover-foot{display:flex;align-items:center;justify-content:space-between;
  font-size:30px;font-weight:600;color:rgba(255,255,255,.85)}
.swipe{font-size:34px;font-weight:800;color:#fff}

/* --- 본문 공통 --- */
.num{display:inline-grid;place-items:center;align-self:flex-start;width:88px;height:88px;border-radius:26px;
  background:var(--brandLt);color:var(--brand);font-size:38px;font-weight:800;margin-bottom:44px}
.head{font-size:68px;font-weight:800;line-height:1.28;letter-spacing:-0.035em;margin-bottom:56px}
.body{font-size:52px;font-weight:700;line-height:1.55;letter-spacing:-0.03em}
.note{margin-top:44px;background:var(--brandLt);border-radius:30px;padding:40px 44px;
  font-size:36px;font-weight:600;line-height:1.6;color:#1F5B36}

/* --- 리스트 --- */
.items{display:flex;flex-direction:column;gap:30px}
.item{display:flex;gap:26px;align-items:flex-start}
.check{flex:0 0 auto;width:46px;height:46px;border-radius:14px;background:var(--brand);color:#fff;
  display:grid;place-items:center;font-size:26px;font-weight:800;margin-top:8px}
.item-t{font-size:42px;font-weight:700;line-height:1.5;letter-spacing:-0.03em}
.warn{margin-top:60px;background:#FFF4E5;border-left:10px solid #F5A524;border-radius:0 24px 24px 0;
  padding:34px 38px;font-size:34px;font-weight:700;line-height:1.5;color:#8A5A00}

/* --- 숫자/표 --- */
.rows{display:flex;flex-direction:column;gap:0}
.row{display:flex;justify-content:space-between;align-items:center;gap:24px;
  padding:38px 0;border-bottom:3px solid #EEF1F6}
.row-k{font-size:42px;font-weight:600;color:var(--gray);letter-spacing:-0.03em}
.row-v{font-size:46px;font-weight:800;color:var(--ink);text-align:right;white-space:nowrap}
.big{margin-top:52px;background:var(--brand);color:#fff;border-radius:36px;padding:56px 48px;
  text-align:center;font-size:72px;font-weight:800;letter-spacing:-0.04em}
.src{margin-top:36px;font-size:30px;font-weight:600;color:var(--gray)}

/* --- CTA --- */
.cta-title{font-size:88px;font-weight:800;line-height:1.25;letter-spacing:-0.04em}
.cta-body{margin-top:44px;font-size:44px;font-weight:600;line-height:1.6;color:rgba(255,255,255,.9)}
.cta-app{margin-top:auto;background:#fff;border-radius:40px;padding:52px 48px;text-align:center}
.cta-app .name{font-size:64px;font-weight:800;color:var(--brand);letter-spacing:-0.04em}
.cta-app .tag{margin-top:14px;font-size:34px;font-weight:600;color:var(--gray)}
.cta-foot{margin-top:40px;text-align:center;font-size:34px;font-weight:700;color:rgba(255,255,255,.9)}

/* --- 하단 브랜드 바 --- */
.brandbar{margin-top:auto;padding-top:44px;display:flex;align-items:center;justify-content:space-between;
  border-top:3px solid #EEF1F6}
.brandbar .logo{font-size:32px;font-weight:800;color:var(--brand)}
.brandbar .pg{font-size:30px;font-weight:700;color:#B9C2CF}
.pushed{margin-top:auto}
`;

const bar = (i, total) =>
  `<div class="brandbar"><div class="logo">알바 메이트</div><div class="pg">${i + 1} / ${total}</div></div>`;

function slideHtml(s, i, total) {
  if (s.type === "cover")
    return `<div class="slide dark">
      <div class="cover-main">
        <div class="kicker">${esc(s.kicker)}</div>
        <div class="cover-title">${nl(s.title)}</div>
        <div class="cover-hl">${nl(s.highlight)}</div>
      </div>
      <div class="cover-foot"><span>${esc(s.foot)}</span><span class="swipe">밀어서 보기 →</span></div>
    </div>`;

  if (s.type === "point")
    return `<div class="slide">
      <div class="num">${esc(s.n)}</div>
      <div class="head">${nl(s.head)}</div>
      <div class="body">${nl(s.body)}</div>
      ${s.note ? `<div class="note">${nl(s.note)}</div>` : ""}
      ${bar(i, total)}
    </div>`;

  if (s.type === "list")
    return `<div class="slide">
      <div class="num">${esc(s.n)}</div>
      <div class="head">${nl(s.head)}</div>
      <div class="items">${s.items
        .map((t) => `<div class="item"><div class="check">✓</div><div class="item-t">${esc(t)}</div></div>`)
        .join("")}</div>
      ${s.warn ? `<div class="warn">${nl(s.warn)}</div>` : ""}
      ${bar(i, total)}
    </div>`;

  if (s.type === "calc")
    return `<div class="slide">
      <div class="num">${esc(s.n)}</div>
      <div class="head">${nl(s.head)}</div>
      <div class="rows">${s.rows
        .map(([k, v]) => `<div class="row"><div class="row-k">${esc(k)}</div><div class="row-v">${esc(v)}</div></div>`)
        .join("")}</div>
      ${s.big ? `<div class="big">${nl(s.big)}</div>` : ""}
      ${s.note ? `<div class="src">${esc(s.note)}</div>` : ""}
      ${bar(i, total)}
    </div>`;

  if (s.type === "cta")
    return `<div class="slide dark">
      <div class="cta-title">${nl(s.title)}</div>
      <div class="cta-body">${nl(s.body)}</div>
      <div class="cta-app"><div class="name">${esc(s.app)}</div><div class="tag">알바 초보를 위한 안내서</div></div>
      <div class="cta-foot">${esc(s.foot)}</div>
    </div>`;

  throw new Error("unknown slide type: " + s.type);
}

let n = 0;
for (const set of SETS) {
  set.slides.forEach((s, i) => {
    const html = `<meta charset="utf-8"><style>${CSS}</style>${slideHtml(s, i, set.slides.length)}`;
    fs.writeFileSync(path.join(OUT, `${set.slug}-${String(i + 1).padStart(2, "0")}.html`), html);
    n++;
  });
  fs.writeFileSync(path.join(OUT, `..`, `caption-${set.slug}.txt`), set.caption + "\n");
}
console.log(`generated ${n} slides (${SETS.length} sets)`);
