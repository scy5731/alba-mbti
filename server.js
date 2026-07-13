"use strict";
// 알바 메이트 — 정적 앱 + 이메일 계정(회원가입/로그인) + 포트원(PortOne) 결제 검증.
// 저장소: DATABASE_URL 있으면 PostgreSQL(영구), 없으면 파일 JSON(로컬 개발).
// 인증: scrypt 해시 + HMAC 서명 httpOnly 쿠키. (외부 인증 라이브러리 없음)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

const PORT = process.env.PORT || 3000;
// 알바 MBTI 결과 열람 = 1회 결제(평생 이용). 가이드는 전부 무료.
const PRICE = 3900;
// 결제: 포트원(PortOne) V2. PG 가입비·연회비가 면제되고 포트원 이용료도
// 월 순거래액 5천만원 미만은 무료라 고정비가 들지 않는다(토스 직연동 대체).
const PORTONE_STORE_ID = process.env.PORTONE_STORE_ID || "";
const PORTONE_CHANNEL_KEY = process.env.PORTONE_CHANNEL_KEY || "";
const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET || "";
// 결제창 없이 프리미엄을 부여하는 모의 결제. 로컬 개발에서만 명시적으로 켠다.
const MOCK_PAYMENT = process.env.ALLOW_MOCK_PAYMENT === "1";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DATABASE_URL = process.env.DATABASE_URL || "";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "users.json");

/* ============================================================
   저장소 추상화 — Postgres(영구) 또는 파일(JSON). 모두 async 인터페이스.
   user 내부형: { id, email, passHash, nickname, result }
   ============================================================ */
function makePgStore(url) {
  const { Pool } = require("pg");
  const wantSsl = !/localhost|127\.0\.0\.1/.test(url) && process.env.PGSSL !== "off";
  let pool = new Pool({ connectionString: url, ssl: wantSsl ? { rejectUnauthorized: false } : false });
  const map = (r) => (r ? { id: r.id, email: r.email, passHash: r.pass_hash, nickname: r.nickname, result: r.result || null, premium: !!r.premium } : null);
  const DDL = `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        nickname TEXT NOT NULL,
        result JSONB,
        premium BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
  const MIG = "ALTER TABLE users ADD COLUMN IF NOT EXISTS premium BOOLEAN DEFAULT false";
  const PAY_DDL = `CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id TEXT,
        payment_key TEXT UNIQUE,
        amount INTEGER,
        user_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
  return {
    kind: "postgres",
    async init() {
      const run = async () => { await pool.query(DDL); await pool.query(MIG); await pool.query(PAY_DDL); };
      try { await run(); }
      catch (e) {
        // Render 내부 연결 등 SSL 미지원 엔드포인트면 SSL 없이 재시도
        if (wantSsl && /SSL|does not support/i.test(String(e && e.message))) {
          await pool.end().catch(() => {});
          pool = new Pool({ connectionString: url, ssl: false });
          await run();
        } else throw e;
      }
    },
    async findByEmail(e) { const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [e]); return map(rows[0]); },
    async findById(id) { const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [id]); return map(rows[0]); },
    async create({ email, passHash, nickname }) {
      const { rows } = await pool.query("INSERT INTO users(email,pass_hash,nickname) VALUES($1,$2,$3) RETURNING *", [email, passHash, nickname]);
      return map(rows[0]);
    },
    async updateNickname(id, nickname) { const { rows } = await pool.query("UPDATE users SET nickname=$1 WHERE id=$2 RETURNING *", [nickname, id]); return map(rows[0]); },
    async updateResult(id, result) { const { rows } = await pool.query("UPDATE users SET result=$1 WHERE id=$2 RETURNING *", [result ? JSON.stringify(result) : null, id]); return map(rows[0]); },
    async setPremium(id, val) { const { rows } = await pool.query("UPDATE users SET premium=$1 WHERE id=$2 RETURNING *", [!!val, id]); return map(rows[0]); },
    async recordPayment(p) { await pool.query("INSERT INTO payments(order_id,payment_key,amount,user_id) VALUES($1,$2,$3,$4) ON CONFLICT (payment_key) DO NOTHING", [p.orderId, p.paymentKey, p.amount, p.userId]); },
    async getPayment(pk) { const { rows } = await pool.query("SELECT * FROM payments WHERE payment_key=$1", [pk]); return rows[0] || null; },
    async remove(id) { await pool.query("DELETE FROM users WHERE id=$1", [id]); },
    async count() { const { rows } = await pool.query("SELECT count(*)::int AS n FROM users"); return rows[0].n; },
  };
}

function makeFileStore(dbPath) {
  let db;
  const load = () => { try { db = JSON.parse(fs.readFileSync(dbPath, "utf8")); } catch (e) { db = { users: [], nextId: 1 }; } if (!db.payments) db.payments = []; };
  const save = () => { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const tmp = dbPath + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, dbPath); };
  const clone = (u) => (u ? JSON.parse(JSON.stringify(u)) : null);
  load();
  return {
    kind: "file",
    async init() {},
    async findByEmail(e) { return clone(db.users.find((u) => u.email === e)); },
    async findById(id) { return clone(db.users.find((u) => u.id === id)); },
    async create({ email, passHash, nickname }) { const u = { id: db.nextId++, email, passHash, nickname, result: null, premium: false, createdAt: Date.now() }; db.users.push(u); save(); return clone(u); },
    async updateNickname(id, nickname) { const u = db.users.find((x) => x.id === id); if (!u) return null; u.nickname = nickname; save(); return clone(u); },
    async updateResult(id, result) { const u = db.users.find((x) => x.id === id); if (!u) return null; u.result = result || null; save(); return clone(u); },
    async setPremium(id, val) { const u = db.users.find((x) => x.id === id); if (!u) return null; u.premium = !!val; save(); return clone(u); },
    async recordPayment(p) { if (!db.payments.some((x) => x.paymentKey === p.paymentKey)) { db.payments.push({ ...p, at: Date.now() }); save(); } },
    async getPayment(pk) { return db.payments.find((x) => x.paymentKey === pk) || null; },
    async remove(id) { db.users = db.users.filter((x) => x.id !== id); save(); },
    async count() { return db.users.length; },
  };
}

const store = DATABASE_URL ? makePgStore(DATABASE_URL) : makeFileStore(DB_PATH);

const app = express();
app.set("trust proxy", 1);      // Render 등 프록시 뒤에서 req.secure 정상 동작
app.use(express.json());
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); res.status(500).json({ ok: false, error: "서버 오류가 발생했어요." }); });
const publicUser = (u) => ({ id: u.id, email: u.email, nickname: u.nickname, result: u.result || null, premium: !!u.premium });

/* ---------- 비밀번호 해시 (scrypt) ---------- */
function hashPw(pw) { const salt = crypto.randomBytes(16).toString("hex"); return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex"); }
function verifyPw(pw, stored) {
  try { const [salt, hash] = String(stored).split(":"); const h = crypto.scryptSync(pw, salt, 64); return crypto.timingSafeEqual(Buffer.from(hash, "hex"), h); }
  catch (e) { return false; }
}

/* ---------- 세션: HMAC 서명 토큰 + httpOnly 쿠키 ---------- */
const COOKIE = "sess";
const MAXAGE = 30 * 24 * 3600; // 초(30일)
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(b).digest("base64url");
  return b + "." + mac;
}
function verifyToken(token) {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const b = token.slice(0, i), mac = token.slice(i + 1);
  const exp = crypto.createHmac("sha256", SESSION_SECRET).update(b).digest("base64url");
  const mb = Buffer.from(mac), eb = Buffer.from(exp);
  if (mb.length !== eb.length || !crypto.timingSafeEqual(mb, eb)) return null;
  try { const p = JSON.parse(Buffer.from(b, "base64url").toString()); if (p.exp && Date.now() > p.exp) return null; return p; }
  catch (e) { return null; }
}
function getCookie(req, name) { const h = req.headers.cookie || ""; const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; }
function setSession(req, res, uid) {
  const token = sign({ uid, exp: Date.now() + MAXAGE * 1000 });
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${MAXAGE}; SameSite=Lax${req.secure ? "; Secure" : ""}`);
}
function clearSession(res) { res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`); }
async function currentUser(req) { const p = verifyToken(getCookie(req, COOKIE)); return p ? await store.findById(p.uid) : null; }
const requireAuth = ah(async (req, res, next) => { const u = await currentUser(req); if (!u) return res.status(401).json({ ok: false, error: "로그인이 필요해요." }); req.user = u; next(); });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ============================================================ 인증 라우트 ============================================================ */
app.post("/api/auth/signup", ah(async (req, res) => {
  let { email, password, nickname } = req.body || {};
  email = String(email || "").trim().toLowerCase();
  nickname = String(nickname || "").trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "이메일 형식이 올바르지 않아요." });
  if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: "비밀번호는 6자 이상이어야 해요." });
  if (await store.findByEmail(email)) return res.status(409).json({ ok: false, error: "이미 가입된 이메일이에요." });
  if (!nickname) nickname = email.split("@")[0];
  if (nickname.length > 20) nickname = nickname.slice(0, 20);
  const user = await store.create({ email, passHash: hashPw(password), nickname });
  setSession(req, res, user.id);
  res.json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/login", ah(async (req, res) => {
  let { email, password } = req.body || {};
  email = String(email || "").trim().toLowerCase();
  const user = await store.findByEmail(email);
  if (!user || !verifyPw(password || "", user.passHash)) return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 맞지 않아요." });
  setSession(req, res, user.id);
  res.json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/logout", (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get("/api/auth/me", ah(async (req, res) => { const u = await currentUser(req); res.json({ ok: true, user: u ? publicUser(u) : null }); }));

app.patch("/api/auth/profile", requireAuth, ah(async (req, res) => {
  let { nickname } = req.body || {};
  nickname = String(nickname || "").trim();
  if (!nickname) return res.status(400).json({ ok: false, error: "닉네임을 입력해 주세요." });
  if (nickname.length > 20) nickname = nickname.slice(0, 20);
  const u = await store.updateNickname(req.user.id, nickname);
  res.json({ ok: true, user: publicUser(u) });
}));

// 알바 MBTI 결과를 계정에 저장(기기 간 동기화)
app.put("/api/me/result", requireAuth, ah(async (req, res) => {
  const { result } = req.body || {};
  const u = await store.updateResult(req.user.id, result && result.code ? result : null);
  res.json({ ok: true, user: publicUser(u) });
}));

app.delete("/api/auth/account", requireAuth, ah(async (req, res) => {
  await store.remove(req.user.id);
  clearSession(res);
  res.json({ ok: true });
}));

// 모의 결제 — 결제창 없이 프리미엄을 바로 부여한다(로컬 개발 전용).
// ALLOW_MOCK_PAYMENT=1 을 명시적으로 켠 경우에만 열린다. 키를 깜빡한 배포에서
// 이 경로가 조용히 살아나 무료로 프리미엄이 풀리는 사고를 막기 위함.
// 포트원 '테스트 채널'로 검증할 때는 이 경로가 아니라 실제 결제 플로우를 그대로 탄다.
app.post("/api/me/premium", requireAuth, ah(async (req, res) => {
  if (!MOCK_PAYMENT) return res.status(400).json({ ok: false, error: "결제를 통해서만 이용할 수 있어요." });
  const u = await store.setPremium(req.user.id, true);
  res.json({ ok: true, user: publicUser(u) });
}));

/* ============================================================ 결제 (포트원 V2) ==========================
   플로우: 프론트 PortOne.requestPayment() → 결제창 → paymentId 확보
        → POST /api/confirm { paymentId }
        → 서버가 포트원 API 로 결제 건을 '직접 조회'해 status·금액을 재검증(위변조 방지)
        → 검증되면 계정에 premium 부여 (= 알바 MBTI 결과 평생 열람)
   토스 직연동에서 포트원으로 교체: PG 가입비·연회비 면제 + 포트원 이용료 무료 구간
   (월 순거래액 5천만원 미만) 이라 고정비가 들지 않는다.
   ======================================================================================================= */
app.get("/api/config", (req, res) =>
  res.json({ storeId: PORTONE_STORE_ID, channelKey: PORTONE_CHANNEL_KEY, price: PRICE }));

app.post("/api/confirm", async (req, res) => {
  const { paymentId } = req.body || {};
  if (!PORTONE_API_SECRET) return res.status(400).json({ ok: false, error: "서버에 PORTONE_API_SECRET 이 설정되지 않았어요." });
  if (!paymentId) return res.status(400).json({ ok: false, error: "잘못된 결제 요청이에요." });
  try {
    const r = await fetch("https://api.portone.io/payments/" + encodeURIComponent(paymentId), {
      headers: { Authorization: "PortOne " + PORTONE_API_SECRET },
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) return res.status(r.status).json({ ok: false, error: data.message || "결제 조회에 실패했어요.", code: data.type });
    // 프론트가 보낸 금액은 신뢰하지 않는다. 서버가 조회한 값으로만 판단.
    if (data.status !== "PAID") return res.status(400).json({ ok: false, error: "결제가 완료되지 않았어요.", status: data.status });

    const total = Number(data.amount && data.amount.total);

    if (total !== PRICE) return res.status(400).json({ ok: false, error: "결제 금액이 올바르지 않아요." });

    const u = await currentUser(req);
    // 멱등: 같은 paymentId 는 한 번만 기록(중복 승인 방지)
    const already = await store.getPayment(paymentId);

    if (!already) await store.recordPayment({ orderId: paymentId, paymentKey: paymentId, amount: total, userId: u ? u.id : null });
    if (u) await store.setPremium(u.id, true);   // 결제 성공 → 계정에 귀속
    return res.json({ ok: true, premium: true, paidAt: data.paidAt, totalAmount: total });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "결제 서버 연결에 실패했어요." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

store.init()
  .then(async () => {
    const n = await store.count().catch(() => "?");
    const pay = PORTONE_API_SECRET ? "포트원 ON" : (MOCK_PAYMENT ? "모의결제(개발)" : "OFF · 결제 불가(키 미설정)");
    app.listen(PORT, () => console.log(`알바 메이트 실행: http://localhost:${PORT} · 저장소 ${store.kind} · 계정 ${n}명 · 결제 ${pay}`));
  })
  .catch((e) => { console.error("저장소 초기화 실패:", e); process.exit(1); });
