"use strict";
// 알바 메이트 — 정적 앱 + 이메일 계정(회원가입/로그인).
// 알바 MBTI 결과·가이드·유형 정보까지 전부 무료. (결제는 추후 도입)
// 저장소: DATABASE_URL 있으면 PostgreSQL(영구), 없으면 파일 JSON(로컬 개발).
// 인증: scrypt 해시 + HMAC 서명 httpOnly 쿠키. (외부 인증 라이브러리 없음)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

const PORT = process.env.PORT || 3000;
// 관리자 계정. 이 이메일로 로그인했을 때만 관리자 화면과 /api/admin/* 이 열린다.
// 비워두면 관리자 기능은 완전히 닫힌다(운영에 깜빡하고 열어두는 사고 방지).
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DATABASE_URL = process.env.DATABASE_URL || "";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "users.json");
// 어떤 커밋이 떠 있는지 밖에서 확인할 수 있게 /api/health 에 실어 보낸다.
// Render 가 배포마다 RENDER_GIT_COMMIT 을 자동 주입한다(로컬은 "dev").
const COMMIT = String(process.env.RENDER_GIT_COMMIT || "").trim().slice(0, 7) || "dev";

/* ---------- 나이스페이 (NICEPAY API V2 · 서버승인 모델) ----------
   키가 없으면 결제 기능 전체가 꺼진 채로 뜬다(앱은 지금처럼 전면 무료로 동작).
   clientId 접두사: S2_=샌드박스(테스트), R2_=실 운영(진짜 카드가 승인된다). */
const NICEPAY_CLIENT_KEY = String(process.env.NICEPAY_CLIENT_KEY || "").trim();
const NICEPAY_SECRET_KEY = String(process.env.NICEPAY_SECRET_KEY || "").trim();
const PAY_ON = !!(NICEPAY_CLIENT_KEY && NICEPAY_SECRET_KEY);
const NICEPAY_API = "https://api.nicepay.co.kr";
// returnUrl 은 나이스페이가 브라우저를 돌려보낼 절대 URL이라 도메인이 필요하다.
// 미설정이면 요청 헤더에서 유추한다(로컬 개발용). 운영에선 반드시 박아둘 것.
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

/* 상품표 — 금액의 유일한 출처. 프론트가 보내는 금액은 절대 쓰지 않는다.
   (나이스페이 문서: "금액 변조 검증 미처리로 인한 모든 책임은 가맹점에 있습니다.") */
const PRODUCTS = {
  premium_report: {
    name: "알바 메이트 프리미엄 상세 리포트",
    // 실키로 테스트하는 동안엔 100원으로 두고, 정식 판매가는 이 환경변수로 올린다.
    amount: parseInt(process.env.PRICE_PREMIUM_REPORT || "100", 10),
  },
};

/* ============================================================
   저장소 추상화 — Postgres(영구) 또는 파일(JSON). 모두 async 인터페이스.
   user 내부형: { id, email, passHash, nickname, result }
   ============================================================ */
function makePgStore(url) {
  const { Pool } = require("pg");
  const wantSsl = !/localhost|127\.0\.0\.1/.test(url) && process.env.PGSSL !== "off";
  let pool = new Pool({ connectionString: url, ssl: wantSsl ? { rejectUnauthorized: false } : false });
  const map = (r) => (r ? {
    id: r.id, email: r.email, passHash: r.pass_hash, nickname: r.nickname,
    avatar: r.avatar || null, result: r.result || null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
  } : null);
  const DDL = `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar TEXT,
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
  // 이미 만들어진 테이블에는 avatar 가 없다 — 기동할 때 붙인다.
  const MIG = "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT";
  // 커뮤니티. 사용자가 지워지면 그 사람의 글·댓글·좋아요도 함께 지운다(ON DELETE CASCADE).
  const COMMUNITY_DDL = [
    `CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        anon BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      )`,
    `CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        anon BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      )`,
    `CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (post_id, user_id)
      )`,
    `CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        reason TEXT,
        resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      )`,
    `CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id)`,
  ];
  // 결제. 사용자가 탈퇴해도 결제 기록은 남아야 한다(정산·환불 대사용) — CASCADE 가 아니라 SET NULL.
  const PAYMENT_DDL = [
    `CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        product TEXT,
        amount INTEGER,
        status TEXT,
        tid TEXT,
        fail_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        paid_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ
      )`,
    // 옛 토스 시절 payments(order_id, payment_key, amount, user_id, created_at)가 남아 있는 DB에서는
    // 위 CREATE 가 통째로 무시된다 — 빠진 컬럼을 여기서 채워야 한다(그냥 두면 기동이 죽는다).
    // 옛 행은 product·status 가 NULL 이라 hasPaid/markPaid 의 조건에 걸리지 않는다(= 무시된다).
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS product TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS tid TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS fail_reason TEXT`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    // 같은 주문이 두 번 들어오는 걸 DB 차원에서 막는다(옛 테이블엔 이 제약이 없었다).
    // 옛 토스 테이블은 order_id 가 아니라 payment_key 에만 유니크가 걸려 있어서, 결제를 재시도한 주문은
    // 같은 order_id 로 행이 두 개 남아 있을 수 있다. 그런 DB 에 통짜 유니크를 걸면 인덱스 생성이 23505 로
    // 터지고 init 이 죽어(=배포 불가) 버리므로, 새 코드가 쓴 행(product NOT NULL)에만 건다.
    // 새 주문번호는 항상 product 를 채우므로 중복 방지 효과는 그대로다.
    `CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_uidx ON payments (order_id) WHERE product IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, product, status)`,
  ];
  return {
    kind: "postgres",
    async init() {
      const run = async () => {
        await pool.query(DDL);
        await pool.query(MIG);
        for (const q of COMMUNITY_DDL) await pool.query(q);
        for (const q of PAYMENT_DDL) await pool.query(q);
      };
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
    async updateProfile(id, { nickname, avatar }) {
      const { rows } = await pool.query(
        "UPDATE users SET nickname=COALESCE($1,nickname), avatar=COALESCE($2,avatar) WHERE id=$3 RETURNING *",
        [nickname ?? null, avatar ?? null, id]);
      return map(rows[0]);
    },
    async updatePassword(id, passHash) { const { rows } = await pool.query("UPDATE users SET pass_hash=$1 WHERE id=$2 RETURNING *", [passHash, id]); return map(rows[0]); },
    async updateResult(id, result) { const { rows } = await pool.query("UPDATE users SET result=$1 WHERE id=$2 RETURNING *", [result ? JSON.stringify(result) : null, id]); return map(rows[0]); },
    async remove(id) { await pool.query("DELETE FROM users WHERE id=$1", [id]); },
    async count() { const { rows } = await pool.query("SELECT count(*)::int AS n FROM users"); return rows[0].n; },

    /* ---- 관리자 조회 ---- */
    async listUsers({ q = "", limit = 50, offset = 0 } = {}) {
      const like = "%" + q.toLowerCase() + "%";
      const where = q ? "WHERE lower(email) LIKE $1 OR lower(nickname) LIKE $1" : "";
      const params = q ? [like, limit, offset] : [limit, offset];
      const { rows } = await pool.query(
        `SELECT id, email, nickname, result, created_at FROM users ${where}
         ORDER BY created_at DESC NULLS LAST, id DESC LIMIT $${q ? 2 : 1} OFFSET $${q ? 3 : 2}`, params);
      const { rows: c } = await pool.query(`SELECT count(*)::int AS n FROM users ${where}`, q ? [like] : []);
      return {
        total: c[0].n,
        users: rows.map((r) => ({
          id: r.id, email: r.email, nickname: r.nickname,
          mbti: r.result && r.result.code ? r.result.code : null,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
        })),
      };
    },
    async stats() {
      const { rows: t } = await pool.query("SELECT count(*)::int AS n FROM users");
      const { rows: w } = await pool.query("SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '7 days'");
      const { rows: d } = await pool.query("SELECT count(*)::int AS n FROM users WHERE created_at > now() - interval '1 day'");
      const { rows: m } = await pool.query(
        "SELECT result->>'code' AS code, count(*)::int AS n FROM users WHERE result->>'code' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC");
      return { total: t[0].n, last7d: w[0].n, last24h: d[0].n, mbti: m.map((r) => ({ code: r.code, n: r.n })) };
    },

    /* ============================ 커뮤니티 ============================ */
    async listPosts({ category = "", limit = 20, offset = 0, userId = null } = {}) {
      const where = category ? "WHERE p.category = $1" : "";
      const a = category ? [category] : [];
      const { rows } = await pool.query(
        `SELECT p.*, u.nickname, u.avatar,
                (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comments,
                (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS likes,
                EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $${a.length + 3}) AS liked
         FROM posts p JOIN users u ON u.id = p.user_id
         ${where} ORDER BY p.created_at DESC LIMIT $${a.length + 1} OFFSET $${a.length + 2}`,
        [...a, limit, offset, userId || 0]);
      const { rows: c } = await pool.query(`SELECT count(*)::int AS n FROM posts p ${where}`, a);
      return { total: c[0].n, posts: rows.map(mapPost) };
    },
    async getPost(id, userId = null) {
      const { rows } = await pool.query(
        `SELECT p.*, u.nickname, u.avatar,
                (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS comments,
                (SELECT count(*)::int FROM likes l WHERE l.post_id = p.id) AS likes,
                EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked
         FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, [id, userId || 0]);
      return rows[0] ? mapPost(rows[0]) : null;
    },
    async createPost({ userId, category, title, body, anon }) {
      const { rows } = await pool.query(
        "INSERT INTO posts(user_id,category,title,body,anon) VALUES($1,$2,$3,$4,$5) RETURNING id", [userId, category, title, body, !!anon]);
      return this.getPost(rows[0].id, userId);
    },
    async updatePost(id, { title, body, category }) {
      const { rows } = await pool.query(
        "UPDATE posts SET title=$1, body=$2, category=$3, updated_at=now() WHERE id=$4 RETURNING id", [title, body, category, id]);
      return rows[0] ? this.getPost(id) : null;
    },
    async removePost(id) { await pool.query("DELETE FROM posts WHERE id=$1", [id]); },
    async toggleLike(postId, userId) {
      const { rowCount } = await pool.query("DELETE FROM likes WHERE post_id=$1 AND user_id=$2", [postId, userId]);
      if (!rowCount) await pool.query("INSERT INTO likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [postId, userId]);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM likes WHERE post_id=$1", [postId]);
      return { liked: !rowCount, likes: rows[0].n };
    },
    async listComments(postId) {
      const { rows } = await pool.query(
        `SELECT c.*, u.nickname, u.avatar FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.post_id = $1 ORDER BY c.created_at ASC`, [postId]);
      return rows.map(mapComment);
    },
    async createComment({ postId, userId, body, anon }) {
      const { rows } = await pool.query(
        "INSERT INTO comments(post_id,user_id,body,anon) VALUES($1,$2,$3,$4) RETURNING id", [postId, userId, body, !!anon]);
      const { rows: r } = await pool.query(
        `SELECT c.*, u.nickname, u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1`, [rows[0].id]);
      return mapComment(r[0]);
    },
    async getComment(id) {
      const { rows } = await pool.query(`SELECT c.*, u.nickname, u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1`, [id]);
      return rows[0] ? mapComment(rows[0]) : null;
    },
    async removeComment(id) { await pool.query("DELETE FROM comments WHERE id=$1", [id]); },
    async createReport({ userId, targetType, targetId, reason }) {
      await pool.query(
        "INSERT INTO reports(user_id,target_type,target_id,reason) VALUES($1,$2,$3,$4)", [userId, targetType, targetId, reason]);
    },
    async listReports() {
      const { rows } = await pool.query(
        `SELECT r.*, u.nickname AS reporter FROM reports r LEFT JOIN users u ON u.id = r.user_id
         WHERE NOT r.resolved ORDER BY r.created_at DESC LIMIT 100`);
      return rows.map((r) => ({
        id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason,
        reporter: r.reporter, createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
      }));
    },
    async resolveReport(id) { await pool.query("UPDATE reports SET resolved=true WHERE id=$1", [id]); },

    /* ============================ 결제 ============================ */
    async createPayment({ orderId, userId, product, amount }) {
      const { rows } = await pool.query(
        "INSERT INTO payments(order_id,user_id,product,amount,status) VALUES($1,$2,$3,$4,'pending') RETURNING *", [orderId, userId, product, amount]);
      return mapPayment(rows[0]);
    },
    async findPayment(orderId) { const { rows } = await pool.query("SELECT * FROM payments WHERE order_id=$1", [orderId]); return rows[0] ? mapPayment(rows[0]) : null; },
    // pending 일 때만 paid 로 넘긴다. 같은 주문이 두 번 승인되면 두 번째는 rowCount=0 이 되어 걸러진다.
    async markPaid(orderId, tid) {
      const { rows } = await pool.query(
        "UPDATE payments SET status='paid', tid=$2, paid_at=now() WHERE order_id=$1 AND status='pending' RETURNING *", [orderId, tid]);
      return rows[0] ? mapPayment(rows[0]) : null;
    },
    async markFailed(orderId, reason, tid = null) {
      await pool.query("UPDATE payments SET status='failed', fail_reason=$2, tid=COALESCE($3,tid) WHERE order_id=$1 AND status='pending'", [orderId, String(reason || "").slice(0, 200), tid]);
    },
    async markCancelled(orderId) {
      const { rows } = await pool.query("UPDATE payments SET status='cancelled', cancelled_at=now() WHERE order_id=$1 AND status='paid' RETURNING *", [orderId]);
      return rows[0] ? mapPayment(rows[0]) : null;
    },
    async hasPaid(userId, product) {
      const { rows } = await pool.query("SELECT 1 FROM payments WHERE user_id=$1 AND product=$2 AND status='paid' LIMIT 1", [userId, product]);
      return rows.length > 0;
    },
    async listPayments({ limit = 50, offset = 0 } = {}) {
      const { rows } = await pool.query(
        `SELECT p.*, u.email, u.nickname FROM payments p LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      const { rows: c } = await pool.query("SELECT count(*)::int AS n FROM payments");
      const { rows: s } = await pool.query("SELECT COALESCE(sum(amount),0)::int AS n FROM payments WHERE status='paid'");
      return { total: c[0].n, paidSum: s[0].n, payments: rows.map((r) => ({ ...mapPayment(r), email: r.email, nickname: r.nickname })) };
    },
  };
}

const mapPayment = (r) => ({
  id: r.id, orderId: r.order_id, userId: r.user_id, product: r.product,
  amount: r.amount, status: r.status, tid: r.tid || null, failReason: r.fail_reason || null,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : (r.createdAt || null),
  paidAt: r.paid_at ? new Date(r.paid_at).getTime() : (r.paidAt || null),
  cancelledAt: r.cancelled_at ? new Date(r.cancelled_at).getTime() : (r.cancelledAt || null),
});

/* 게시글/댓글 행 → API 표현. 익명 글이면 작성자 정보를 여기서 지운다(응답에 아예 싣지 않는다). */
const mapPost = (r) => ({
  id: r.id, category: r.category, title: r.title, body: r.body, anon: !!r.anon,
  userId: r.user_id,
  author: r.anon ? null : { nickname: r.nickname, avatar: r.avatar || null },
  comments: r.comments || 0, likes: r.likes || 0, liked: !!r.liked,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : (r.createdAt || null),
  updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : (r.updatedAt || null),
});
const mapComment = (r) => ({
  id: r.id, postId: r.post_id, body: r.body, anon: !!r.anon,
  userId: r.user_id,
  author: r.anon ? null : { nickname: r.nickname, avatar: r.avatar || null },
  createdAt: r.created_at ? new Date(r.created_at).getTime() : (r.createdAt || null),
});

function makeFileStore(dbPath) {
  let db;
  const load = () => {
    try { db = JSON.parse(fs.readFileSync(dbPath, "utf8")); } catch (e) { db = { users: [], nextId: 1 }; }
    // 커뮤니티 테이블(파일 저장소 판) — 없으면 만들어 준다.
    db.posts = db.posts || [];
    db.comments = db.comments || [];
    db.likes = db.likes || [];        // { postId, userId }
    db.reports = db.reports || [];
    db.payments = db.payments || [];
    db.nextPostId = db.nextPostId || 1;
    db.nextCommentId = db.nextCommentId || 1;
    db.nextReportId = db.nextReportId || 1;
    db.nextPaymentId = db.nextPaymentId || 1;
  };
  const save = () => { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); const tmp = dbPath + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, dbPath); };
  const clone = (u) => (u ? JSON.parse(JSON.stringify(u)) : null);
  load();
  return {
    kind: "file",
    async init() {},
    async findByEmail(e) { return clone(db.users.find((u) => u.email === e)); },
    async findById(id) { return clone(db.users.find((u) => u.id === id)); },
    async create({ email, passHash, nickname }) { const u = { id: db.nextId++, email, passHash, nickname, avatar: null, result: null, createdAt: Date.now() }; db.users.push(u); save(); return clone(u); },
    async updateProfile(id, { nickname, avatar }) {
      const u = db.users.find((x) => x.id === id); if (!u) return null;
      if (nickname != null) u.nickname = nickname;
      if (avatar != null) u.avatar = avatar;
      save(); return clone(u);
    },
    async updatePassword(id, passHash) { const u = db.users.find((x) => x.id === id); if (!u) return null; u.passHash = passHash; save(); return clone(u); },
    async updateResult(id, result) { const u = db.users.find((x) => x.id === id); if (!u) return null; u.result = result || null; save(); return clone(u); },
    async remove(id) {
      db.users = db.users.filter((x) => x.id !== id);
      // Postgres 의 ON DELETE CASCADE 와 같은 정리를 손으로 해준다.
      const gone = new Set(db.posts.filter((p) => p.userId === id).map((p) => p.id));
      db.posts = db.posts.filter((p) => p.userId !== id);
      db.comments = db.comments.filter((c) => c.userId !== id && !gone.has(c.postId));
      db.likes = db.likes.filter((l) => l.userId !== id && !gone.has(l.postId));
      // 결제 기록은 지우지 않는다(Postgres 의 ON DELETE SET NULL 과 같은 처리).
      db.payments.forEach((p) => { if (p.userId === id) p.userId = null; });
      save();
    },
    async count() { return db.users.length; },

    /* ============================ 커뮤니티 ============================ */
    async listPosts({ category = "", limit = 20, offset = 0, userId = null } = {}) {
      const hit = db.posts.filter((p) => !category || p.category === category);
      const sorted = [...hit].sort((a, b) => b.createdAt - a.createdAt);
      return { total: hit.length, posts: sorted.slice(offset, offset + limit).map((p) => this._post(p, userId)) };
    },
    _post(p, userId) {
      const u = db.users.find((x) => x.id === p.userId);
      return mapPost({
        ...p, user_id: p.userId, created_at: null, createdAt: p.createdAt, updatedAt: p.updatedAt || null,
        nickname: u ? u.nickname : "(탈퇴한 사용자)", avatar: u ? u.avatar : null,
        comments: db.comments.filter((c) => c.postId === p.id).length,
        likes: db.likes.filter((l) => l.postId === p.id).length,
        liked: !!userId && db.likes.some((l) => l.postId === p.id && l.userId === userId),
      });
    },
    async getPost(id, userId = null) { const p = db.posts.find((x) => x.id === id); return p ? this._post(p, userId) : null; },
    async createPost({ userId, category, title, body, anon }) {
      const p = { id: db.nextPostId++, userId, category, title, body, anon: !!anon, createdAt: Date.now(), updatedAt: null };
      db.posts.push(p); save();
      return this._post(p, userId);
    },
    async updatePost(id, { title, body, category }) {
      const p = db.posts.find((x) => x.id === id); if (!p) return null;
      p.title = title; p.body = body; p.category = category; p.updatedAt = Date.now();
      save(); return this._post(p, p.userId);
    },
    async removePost(id) {
      db.posts = db.posts.filter((p) => p.id !== id);
      db.comments = db.comments.filter((c) => c.postId !== id);
      db.likes = db.likes.filter((l) => l.postId !== id);
      save();
    },
    async toggleLike(postId, userId) {
      const i = db.likes.findIndex((l) => l.postId === postId && l.userId === userId);
      if (i >= 0) db.likes.splice(i, 1); else db.likes.push({ postId, userId });
      save();
      return { liked: i < 0, likes: db.likes.filter((l) => l.postId === postId).length };
    },
    _comment(c) {
      const u = db.users.find((x) => x.id === c.userId);
      return mapComment({ ...c, post_id: c.postId, user_id: c.userId, createdAt: c.createdAt,
        nickname: u ? u.nickname : "(탈퇴한 사용자)", avatar: u ? u.avatar : null });
    },
    async listComments(postId) {
      return db.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt).map((c) => this._comment(c));
    },
    async createComment({ postId, userId, body, anon }) {
      const c = { id: db.nextCommentId++, postId, userId, body, anon: !!anon, createdAt: Date.now() };
      db.comments.push(c); save();
      return this._comment(c);
    },
    async getComment(id) { const c = db.comments.find((x) => x.id === id); return c ? this._comment(c) : null; },
    async removeComment(id) { db.comments = db.comments.filter((c) => c.id !== id); save(); },
    async createReport({ userId, targetType, targetId, reason }) {
      db.reports.push({ id: db.nextReportId++, userId, targetType, targetId, reason, resolved: false, createdAt: Date.now() });
      save();
    },
    async listReports() {
      return db.reports.filter((r) => !r.resolved).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((r) => {
        const u = db.users.find((x) => x.id === r.userId);
        return { ...r, reporter: u ? u.nickname : null };
      });
    },
    async resolveReport(id) { const r = db.reports.find((x) => x.id === id); if (r) { r.resolved = true; save(); } },

    /* ============================ 결제 ============================ */
    async createPayment({ orderId, userId, product, amount }) {
      const p = { id: db.nextPaymentId++, orderId, userId, product, amount, status: "pending", tid: null, failReason: null, createdAt: Date.now(), paidAt: null, cancelledAt: null };
      db.payments.push(p); save();
      return { ...p };
    },
    async findPayment(orderId) { const p = db.payments.find((x) => x.orderId === orderId); return p ? { ...p } : null; },
    async markPaid(orderId, tid) {
      const p = db.payments.find((x) => x.orderId === orderId);
      if (!p || p.status !== "pending") return null;   // 중복 승인 차단
      p.status = "paid"; p.tid = tid; p.paidAt = Date.now(); save();
      return { ...p };
    },
    async markFailed(orderId, reason, tid = null) {
      const p = db.payments.find((x) => x.orderId === orderId);
      if (!p || p.status !== "pending") return;
      p.status = "failed"; p.failReason = String(reason || "").slice(0, 200); if (tid) p.tid = tid;
      save();
    },
    async markCancelled(orderId) {
      const p = db.payments.find((x) => x.orderId === orderId);
      if (!p || p.status !== "paid") return null;
      p.status = "cancelled"; p.cancelledAt = Date.now(); save();
      return { ...p };
    },
    async hasPaid(userId, product) {
      return db.payments.some((p) => p.userId === userId && p.product === product && p.status === "paid");
    },
    async listPayments({ limit = 50, offset = 0 } = {}) {
      const sorted = [...db.payments].sort((a, b) => b.createdAt - a.createdAt);
      return {
        total: db.payments.length,
        paidSum: db.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
        payments: sorted.slice(offset, offset + limit).map((p) => {
          const u = db.users.find((x) => x.id === p.userId);
          return { ...p, email: u ? u.email : null, nickname: u ? u.nickname : null };
        }),
      };
    },

    /* ---- 관리자 조회 ---- */
    async listUsers({ q = "", limit = 50, offset = 0 } = {}) {
      const k = q.toLowerCase();
      const hit = db.users.filter((u) =>
        !k || u.email.toLowerCase().includes(k) || String(u.nickname || "").toLowerCase().includes(k));
      const sorted = [...hit].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.id - a.id);
      return {
        total: hit.length,
        users: sorted.slice(offset, offset + limit).map((u) => ({
          id: u.id, email: u.email, nickname: u.nickname,
          mbti: u.result && u.result.code ? u.result.code : null,
          createdAt: u.createdAt || null,
        })),
      };
    },
    async stats() {
      const now = Date.now(), DAY = 86400000;
      const mbti = {};
      db.users.forEach((u) => { const c = u.result && u.result.code; if (c) mbti[c] = (mbti[c] || 0) + 1; });
      return {
        total: db.users.length,
        last7d: db.users.filter((u) => u.createdAt && now - u.createdAt < 7 * DAY).length,
        last24h: db.users.filter((u) => u.createdAt && now - u.createdAt < DAY).length,
        mbti: Object.entries(mbti).map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n),
      };
    },
  };
}

const store = DATABASE_URL ? makePgStore(DATABASE_URL) : makeFileStore(DB_PATH);

/* 저장소 상태 — 앱은 저장소가 죽어도 뜬다(아래 기동부 참고).
   2026-08 에 Render 무료 Postgres 가 30일 만료로 사라졌을 때, 기동 중 process.exit(1) 로
   죽는 바람에 포트가 아예 안 열려서 사이트가 "무응답"으로만 보였다. 원인이 밖에서
   전혀 안 보였던 게 진짜 문제였다. 그래서 상태를 들고 있다가 /api/health 로 노출한다. */
const dbState = { ready: false, error: null };

const app = express();
app.set("trust proxy", 1);      // Render 등 프록시 뒤에서 req.secure 정상 동작
app.use(express.json());
// 저장소가 아직 안 붙었으면 500(원인 불명) 대신 503 으로 이유를 분명히 말해준다.
const ah = (fn) => (req, res, next) => {
  if (!dbState.ready) return res.status(503).json({ ok: false, error: "데이터베이스에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요." });
  return Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); res.status(500).json({ ok: false, error: "서버 오류가 발생했어요." }); });
};
const isAdmin = (u) => !!(u && ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL);
const publicUser = (u) => ({
  id: u.id, email: u.email, nickname: u.nickname,
  avatar: u.avatar || null, result: u.result || null,
  createdAt: u.createdAt || null, admin: isAdmin(u),
});

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
// 관리자 여부는 세션 사용자의 이메일로 서버가 판단한다. 프론트가 보내는 값은 신뢰하지 않는다.
// 관리자가 아니면 404 로 답한다 — 관리자 API 의 존재 자체를 알려주지 않는다.
const requireAdmin = ah(async (req, res, next) => {
  const u = await currentUser(req);
  if (!isAdmin(u)) return res.status(404).json({ ok: false, error: "찾을 수 없어요." });
  req.user = u;
  next();
});

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

app.get("/api/auth/me", ah(async (req, res) => {
  const u = await currentUser(req);
  res.json({ ok: true, user: u ? { ...publicUser(u), entitlements: await entitlementsOf(u.id) } : null });
}));

// 아바타는 이모지 한 글자만 받는다(임의 문자열·이미지 URL 저장 방지).
const AVATARS = ["🙂", "😎", "🐣", "🐱", "🐶", "🦊", "🐻", "🦁", "🐼", "🐨", "🐸", "🦄", "⚡", "🌱", "🍀", "🔥"];

app.patch("/api/auth/profile", requireAuth, ah(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.nickname !== undefined) {
    let nickname = String(body.nickname || "").trim();
    if (!nickname) return res.status(400).json({ ok: false, error: "닉네임을 입력해 주세요." });
    patch.nickname = nickname.slice(0, 20);
  }
  if (body.avatar !== undefined) {
    const a = String(body.avatar || "");
    if (!AVATARS.includes(a)) return res.status(400).json({ ok: false, error: "사용할 수 없는 아바타예요." });
    patch.avatar = a;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: "바꿀 내용이 없어요." });
  const u = await store.updateProfile(req.user.id, patch);
  res.json({ ok: true, user: publicUser(u) });
}));

// 비밀번호 변경 — 현재 비밀번호를 반드시 다시 확인한다(세션 탈취 시 잠금 방지).
app.patch("/api/auth/password", requireAuth, ah(async (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPw(String(current || ""), req.user.passHash)) {
    return res.status(401).json({ ok: false, error: "현재 비밀번호가 맞지 않아요." });
  }
  if (!next || String(next).length < 6) return res.status(400).json({ ok: false, error: "새 비밀번호는 6자 이상이어야 해요." });
  if (String(next) === String(current)) return res.status(400).json({ ok: false, error: "지금과 다른 비밀번호를 입력해 주세요." });
  await store.updatePassword(req.user.id, hashPw(String(next)));
  res.json({ ok: true });
}));

// 알바 MBTI 결과를 계정에 저장(기기 간 동기화). result 가 없으면 저장된 결과를 지운다.
app.put("/api/me/result", requireAuth, ah(async (req, res) => {
  const { result } = req.body || {};
  const u = await store.updateResult(req.user.id, result && result.code ? result : null);
  res.json({ ok: true, user: publicUser(u) });
}));

// 내 데이터 내려받기 — 계정에 저장된 내 정보 전부(비밀번호 해시는 제외).
app.get("/api/me/export", requireAuth, ah(async (req, res) => {
  const u = req.user;
  res.setHeader("Content-Disposition", 'attachment; filename="alba-mate-my-data.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    account: { id: u.id, email: u.email, nickname: u.nickname, avatar: u.avatar || null, joinedAt: u.createdAt ? new Date(u.createdAt).toISOString() : null },
    albaMbti: u.result || null,
  });
}));

app.delete("/api/auth/account", requireAuth, ah(async (req, res) => {
  await store.remove(req.user.id);
  clearSession(res);
  res.json({ ok: true });
}));

/* ============================================================ 커뮤니티 ============================================================
   글·댓글은 로그인해야 쓸 수 있고, 수정·삭제는 글쓴이 본인 또는 관리자만 가능하다.
   익명 글은 응답에서 작성자 정보를 아예 빼고 내려보낸다(프론트에서 숨기는 게 아니다).
   ================================================================================================================================ */
const CATEGORIES = ["question", "review", "tip", "free"];
const TITLE_MAX = 60, BODY_MAX = 4000, COMMENT_MAX = 1000;

// 글쓴이 본인 또는 관리자만 수정·삭제할 수 있다. 익명 글이어도 서버는 소유자를 알고 있다.
const canEdit = (user, ownerId) => user.id === ownerId || isAdmin(user);

// 응답에서 소유자 ID 를 빼고 내려보낸다. userId 를 그대로 실어 보내면 익명 글이라도
// 같은 userId 를 가진 다른 글(실명 글)과 대조해 작성자를 알아낼 수 있다.
// 프론트가 필요한 건 "내가 수정/삭제할 수 있는가"뿐이므로 그 플래그만 준다.
const viewPost = (p, user) => p && ({ ...p, userId: undefined, mine: !!user && p.userId === user.id, canEdit: !!user && canEdit(user, p.userId) });
const viewComment = (c, user) => c && ({ ...c, userId: undefined, mine: !!user && c.userId === user.id, canEdit: !!user && canEdit(user, c.userId) });

app.get("/api/posts", ah(async (req, res) => {
  const me = await currentUser(req);
  const category = CATEGORIES.includes(String(req.query.category)) ? String(req.query.category) : "";
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { total, posts } = await store.listPosts({ category, limit, offset, userId: me ? me.id : null });
  res.json({ ok: true, total, posts: posts.map((p) => viewPost(p, me)) });
}));

app.get("/api/posts/:id", ah(async (req, res) => {
  const me = await currentUser(req);
  const post = await store.getPost(parseInt(req.params.id, 10), me ? me.id : null);
  if (!post) return res.status(404).json({ ok: false, error: "없는 글이에요." });
  const comments = await store.listComments(post.id);
  res.json({ ok: true, post: viewPost(post, me), comments: comments.map((c) => viewComment(c, me)) });
}));

app.post("/api/posts", requireAuth, ah(async (req, res) => {
  const { category, title, body, anon } = req.body || {};
  if (!CATEGORIES.includes(String(category))) return res.status(400).json({ ok: false, error: "카테고리를 골라 주세요." });
  const t = String(title || "").trim(), b = String(body || "").trim();
  if (!t) return res.status(400).json({ ok: false, error: "제목을 입력해 주세요." });
  if (!b) return res.status(400).json({ ok: false, error: "내용을 입력해 주세요." });
  if (t.length > TITLE_MAX || b.length > BODY_MAX) return res.status(400).json({ ok: false, error: "글이 너무 길어요." });
  const post = await store.createPost({ userId: req.user.id, category: String(category), title: t, body: b, anon: !!anon });
  res.json({ ok: true, post: viewPost(post, req.user) });
}));

app.patch("/api/posts/:id", requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = await store.getPost(id);
  if (!post) return res.status(404).json({ ok: false, error: "없는 글이에요." });
  if (!canEdit(req.user, post.userId)) return res.status(403).json({ ok: false, error: "내 글만 수정할 수 있어요." });
  const t = String(req.body.title ?? post.title).trim(), b = String(req.body.body ?? post.body).trim();
  const c = CATEGORIES.includes(String(req.body.category)) ? String(req.body.category) : post.category;
  if (!t || !b) return res.status(400).json({ ok: false, error: "제목과 내용을 입력해 주세요." });
  if (t.length > TITLE_MAX || b.length > BODY_MAX) return res.status(400).json({ ok: false, error: "글이 너무 길어요." });
  res.json({ ok: true, post: viewPost(await store.updatePost(id, { title: t, body: b, category: c }), req.user) });
}));

app.delete("/api/posts/:id", requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = await store.getPost(id);
  if (!post) return res.status(404).json({ ok: false, error: "없는 글이에요." });
  if (!canEdit(req.user, post.userId)) return res.status(403).json({ ok: false, error: "내 글만 지울 수 있어요." });
  await store.removePost(id);
  res.json({ ok: true });
}));

app.post("/api/posts/:id/like", requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await store.getPost(id))) return res.status(404).json({ ok: false, error: "없는 글이에요." });
  res.json({ ok: true, ...(await store.toggleLike(id, req.user.id)) });
}));

app.post("/api/posts/:id/comments", requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await store.getPost(id))) return res.status(404).json({ ok: false, error: "없는 글이에요." });
  const b = String((req.body || {}).body || "").trim();
  if (!b) return res.status(400).json({ ok: false, error: "댓글을 입력해 주세요." });
  if (b.length > COMMENT_MAX) return res.status(400).json({ ok: false, error: "댓글이 너무 길어요." });
  const comment = await store.createComment({ postId: id, userId: req.user.id, body: b, anon: !!(req.body || {}).anon });
  res.json({ ok: true, comment: viewComment(comment, req.user) });
}));

app.delete("/api/comments/:id", requireAuth, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = await store.getComment(id);
  if (!c) return res.status(404).json({ ok: false, error: "없는 댓글이에요." });
  if (!canEdit(req.user, c.userId)) return res.status(403).json({ ok: false, error: "내 댓글만 지울 수 있어요." });
  await store.removeComment(id);
  res.json({ ok: true });
}));

app.post("/api/reports", requireAuth, ah(async (req, res) => {
  const { targetType, targetId, reason } = req.body || {};
  if (!["post", "comment"].includes(String(targetType))) return res.status(400).json({ ok: false, error: "잘못된 신고예요." });
  const id = parseInt(targetId, 10);
  const target = String(targetType) === "post" ? await store.getPost(id) : await store.getComment(id);
  if (!target) return res.status(404).json({ ok: false, error: "없는 대상이에요." });
  await store.createReport({ userId: req.user.id, targetType: String(targetType), targetId: id, reason: String(reason || "").slice(0, 200) });
  res.json({ ok: true });
}));

/* ============================================================ 관리자 (ADMIN_EMAIL 계정만) ============================================================ */
app.get("/api/admin/reports", requireAdmin, ah(async (req, res) => {
  const reports = await store.listReports();
  // 신고 대상의 내용을 함께 실어 준다 — 관리자가 화면을 옮겨 다니지 않고 바로 판단할 수 있게.
  const withTarget = await Promise.all(reports.map(async (r) => ({
    ...r,
    target: viewPost(r.targetType === "post" ? await store.getPost(r.targetId) : await store.getComment(r.targetId), req.user),
  })));
  res.json({ ok: true, reports: withTarget });
}));

app.post("/api/admin/reports/:id/resolve", requireAdmin, ah(async (req, res) => {
  await store.resolveReport(parseInt(req.params.id, 10));
  res.json({ ok: true });
}));

app.get("/api/admin/stats", requireAdmin, ah(async (req, res) => {
  res.json({ ok: true, stats: await store.stats(), storage: store.kind });
}));

app.get("/api/admin/users", requireAdmin, ah(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json({ ok: true, ...(await store.listUsers({ q, limit, offset })) });
}));

app.delete("/api/admin/users/:id", requireAdmin, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // 관리자가 자기 계정을 지우면 관리자 화면에 다시 들어올 수 없다.
  if (id === req.user.id) return res.status(400).json({ ok: false, error: "관리자 본인 계정은 여기서 지울 수 없어요." });
  const target = await store.findById(id);
  if (!target) return res.status(404).json({ ok: false, error: "없는 계정이에요." });
  await store.remove(id);
  res.json({ ok: true });
}));

/* ============================================================
   결제 — 나이스페이 NICEPAY API V2 · 서버승인 모델
   흐름: prepare(주문 생성) → 브라우저 결제창 → /api/pay/return 으로 POST
        → 서명·금액 검증 → 승인 API 호출 → paid 기록
   ============================================================ */

// Basic 인증 = base64(clientId:secretKey)
const nicepayAuth = () => "Basic " + Buffer.from(`${NICEPAY_CLIENT_KEY}:${NICEPAY_SECRET_KEY}`).toString("base64");

async function nicepayPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: nicepayAuth() },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`나이스페이 응답 파싱 실패 (HTTP ${r.status}): ${text.slice(0, 200)}`); }
}

// 문자열 비교를 항상 같은 시간에 끝내 서명 추측을 막는다.
function safeEq(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const baseUrl = (req) => PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;

// 결제 설정 — 프론트가 결제창을 띄우는 데 필요한 값. secretKey 는 절대 나가지 않는다.
app.get("/api/pay/config", (req, res) => {
  if (!PAY_ON) return res.json({ ok: true, enabled: false });
  res.json({
    ok: true, enabled: true, clientId: NICEPAY_CLIENT_KEY,
    sandbox: NICEPAY_CLIENT_KEY.startsWith("S"),
    products: Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, { name: v.name, amount: v.amount }])),
  });
});

app.post("/api/pay/prepare", requireAuth, ah(async (req, res) => {
  if (!PAY_ON) return res.status(503).json({ ok: false, error: "결제가 준비 중이에요." });
  const key = String((req.body || {}).product || "");
  const product = PRODUCTS[key];
  if (!product) return res.status(400).json({ ok: false, error: "없는 상품이에요." });
  if (await store.hasPaid(req.user.id, key)) return res.status(409).json({ ok: false, error: "이미 구매한 상품이에요." });

  // 주문번호는 서버가 만든다. 프론트가 정하게 두면 남의 주문을 덮어쓸 수 있다.
  const orderId = `${key}_${req.user.id}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  await store.createPayment({ orderId, userId: req.user.id, product: key, amount: product.amount });
  res.json({
    ok: true, clientId: NICEPAY_CLIENT_KEY, orderId,
    amount: product.amount, goodsName: product.name,
    returnUrl: `${baseUrl(req)}/api/pay/return`,
  });
}));

// 나이스페이가 인증 결과를 여기로 POST 한다(JSON 아님 — form urlencoded).
// 브라우저가 실려오는 리다이렉트라 응답은 화면(HTML)이어야 한다 → 결과를 쿼리로 붙여 앱으로 되돌린다.
app.post("/api/pay/return", express.urlencoded({ extended: false }), ah(async (req, res) => {
  const b = req.body || {};
  const { authResultCode, authResultMsg, authToken, tid, orderId, amount, signature } = b;
  const done = (q) => res.redirect(303, "/?" + new URLSearchParams(q).toString());

  const pay = orderId ? await store.findPayment(String(orderId)) : null;
  if (!pay) { console.error("[pay] 알 수 없는 주문:", orderId); return done({ pay: "fail", reason: "주문을 찾을 수 없어요." }); }
  if (pay.status !== "pending") { console.error("[pay] 이미 처리된 주문:", orderId, pay.status); return done({ pay: pay.status === "paid" ? "ok" : "fail", reason: "이미 처리된 주문이에요." }); }

  const fail = async (reason) => { await store.markFailed(pay.orderId, reason, tid || null); return done({ pay: "fail", reason }); };

  // 1) 인증 자체가 실패(사용자 취소·카드사 거절 등)면 승인 API 를 부르지 않는다.
  if (authResultCode !== "0000") return fail(authResultMsg || "결제가 취소되었어요.");

  // 2) 위변조 검증 — signature = hex(sha256(authToken + clientId + amount + secretKey))
  const expect = sha256hex(String(authToken) + NICEPAY_CLIENT_KEY + String(amount) + NICEPAY_SECRET_KEY);
  if (!safeEq(signature, expect)) { console.error("[pay] 서명 불일치:", orderId); return fail("결제 정보 검증에 실패했어요."); }

  // 3) 금액 검증 — 신뢰 기준은 상품표에서 만든 DB 의 금액이다.
  if (parseInt(amount, 10) !== pay.amount) { console.error("[pay] 금액 변조:", orderId, amount, "≠", pay.amount); return fail("결제 금액이 올바르지 않아요."); }

  // 4) 최종 승인. 여기서 실제로 돈이 빠진다.
  let r;
  try { r = await nicepayPost(`${NICEPAY_API}/v1/payments/${encodeURIComponent(tid)}`, { amount: pay.amount }); }
  catch (e) { console.error("[pay] 승인 호출 실패:", e); return fail("결제 승인 중 오류가 발생했어요."); }

  if (r.resultCode !== "0000" || r.status !== "paid") {
    console.error("[pay] 승인 거절:", orderId, r.resultCode, r.resultMsg);
    return fail(r.resultMsg || "결제 승인이 거절되었어요.");
  }

  // 5) 승인 성공. markPaid 는 pending 일 때만 통과하므로 중복 승인이 들어와도 한 번만 기록된다.
  const saved = await store.markPaid(pay.orderId, r.tid || tid);
  if (!saved) console.error("[pay] 승인은 났는데 기록이 중복:", orderId);
  console.log("[pay] 결제 완료:", orderId, r.amount + "원", r.tid);
  done({ pay: "ok" });
}));

/* ============================ 프리미엄 리포트 ============================
   파는 물건은 전부 여기 있다 — 축 상세 해설 · 근무 환경 태그 · 추천 TOP3(매칭 근거) ·
   신중히 볼 알바. 프론트 번들에 두면 개발자도구로 그냥 읽혀서 페이월이 무의미해지므로,
   내용도 계산도 서버에만 두고 구매자에게만 /api/me/report 로 내려준다.
   프론트에는 유형의 설명(이름·이모지·한줄)만 남아 있고, 그건 유형 탭에서 원래 무료다. */

// 8개 축 극성별 상세 해설.
const PREMIUM_AXIS_DESC = {
  E: "손님·동료와 부딪히는 상황에서 오히려 에너지를 얻어요. 응대가 많은 자리일수록 지루하지 않고, 매장 분위기를 살리는 역할도 자연스럽게 해내요.",
  I: "북적임보다 혼자만의 리듬으로 일할 때 능률이 올라요. 과한 감정노동은 금세 지치니, 응대 강도가 낮고 조용한 자리가 편해요.",
  D: "가만히 대기하는 것보다 계속 움직이는 근무에서 활력이 나요. 체력을 쓰는 일도 오히려 개운하게 느끼고, 정적인 대기는 답답해해요.",
  C: "정신없이 뛰는 것보다 앉거나 한자리에서 차분히 처리하는 일이 잘 맞아요. 무리한 육체노동은 피하고, 꼼꼼함이 필요한 일에서 강점을 보여요.",
  F: "고정된 요일보다 상황에 맞춰 유연하게 일하는 걸 선호해요. 단기·하루 알바로 여러 경험을 빠르게 쌓는 것도 잘 맞아요.",
  S: "한 곳을 정해 오래 다니며 신뢰를 쌓는 데서 안정감을 느껴요. 자주 바뀌는 환경보다 예측 가능한 루틴에서 실력이 붙어요.",
  P: "같은 시간이면 확실한 벌이가 중요해요. 시급·동선·효율을 꼼꼼히 따져 실속 있게 일하는 걸 선호해요.",
  G: "당장의 시급보다 뭘 배우고 남기는지를 더 봐요. 경험·커리어에 도움이 되는 일이면 조금 힘들어도 기꺼이 도전해요.",
};

// 축 극성별 선호 근무 환경 태그.
const ENV_TAG = {
  E: "👥 손님·동료 응대가 있는 곳", I: "🎧 혼자 집중할 수 있는 곳",
  D: "🏃 몸을 움직이는 활동적인 곳", C: "🪑 앉거나 한자리서 차분한 곳",
  F: "📅 유연·단기 스케줄", S: "📌 고정·장기 스케줄",
  P: "💰 시급·효율이 좋은 곳", G: "🌱 배울 게 있는 곳",
};

/* 유형별 매칭 점수표. 이 숫자들이 추천의 근거라 프론트에 두지 않는다.
   프론트 TYPES 의 설명 필드와 id 로 짝지어진다 — 유형을 추가하면 양쪽 다 넣어야 한다. */
const TYPE_SCORES = {
  cafe: { pay:3, physical:2, social:4, learn:3, flex:false },
  cvs: { pay:2, physical:2, social:2, learn:3, flex:false },
  hall: { pay:3, physical:4, social:4, learn:3, flex:false },
  kitchen: { pay:3, physical:4, social:1, learn:4, flex:false },
  logi: { pay:5, physical:5, social:1, learn:2, flex:true },
  delivery: { pay:4, physical:3, social:1, learn:2, flex:true },
  study: { pay:2, physical:1, social:1, learn:1, flex:false },
  event: { pay:4, physical:3, social:4, learn:2, flex:true },
  bakery: { pay:2, physical:3, social:3, learn:3, flex:false },
  mart: { pay:2, physical:3, social:3, learn:2, flex:false },
  pcbang: { pay:2, physical:2, social:2, learn:1, flex:false },
  tutor: { pay:4, physical:1, social:3, learn:4, flex:false },
  cs: { pay:3, physical:1, social:3, learn:3, flex:false },
  beauty: { pay:2, physical:2, social:4, learn:3, flex:false },
  gym: { pay:2, physical:1, social:3, learn:2, flex:false },
  fastfood: { pay:3, physical:3, social:4, learn:3, flex:false },
  chicken: { pay:3, physical:3, social:2, learn:3, flex:false },
  dessert: { pay:2, physical:2, social:4, learn:3, flex:false },
  bar: { pay:4, physical:3, social:4, learn:3, flex:false },
  bookstore: { pay:2, physical:2, social:2, learn:2, flex:false },
  flower: { pay:2, physical:2, social:3, learn:3, flex:false },
  kiosk: { pay:2, physical:2, social:1, learn:2, flex:false },
  movie: { pay:3, physical:2, social:3, learn:2, flex:false },
  karaoke: { pay:2, physical:2, social:2, learn:1, flex:false },
  amusement: { pay:3, physical:3, social:4, learn:2, flex:false },
  golf: { pay:5, physical:4, social:3, learn:4, flex:false },
  lifeguard: { pay:4, physical:3, social:2, learn:3, flex:true },
  gas: { pay:3, physical:2, social:3, learn:2, flex:false },
  hotel: { pay:3, physical:2, social:4, learn:3, flex:false },
  clean: { pay:2, physical:3, social:1, learn:1, flex:false },
  petcafe: { pay:2, physical:2, social:3, learn:3, flex:false },
  carwash: { pay:2, physical:4, social:1, learn:1, flex:false },
  datawork: { pay:2, physical:1, social:1, learn:2, flex:true },
  factory: { pay:3, physical:4, social:1, learn:2, flex:false },
  sorting: { pay:3, physical:3, social:1, learn:1, flex:true },
  moving: { pay:5, physical:5, social:1, learn:1, flex:true },
  courier: { pay:4, physical:4, social:1, learn:1, flex:true },
  valet: { pay:3, physical:2, social:3, learn:2, flex:false },
  afterschool: { pay:4, physical:1, social:3, learn:4, flex:false },
  flyer: { pay:2, physical:3, social:2, learn:1, flex:true },
  promoter: { pay:3, physical:2, social:4, learn:2, flex:true },
  wedding: { pay:3, physical:4, social:3, learn:2, flex:true },
  babysit: { pay:4, physical:2, social:3, learn:3, flex:false },
};

function typeScore(code, t) {
  let s = 0;
  s += code[0] === "E" ? t.social : (6 - t.social);
  s += code[1] === "D" ? t.physical : (6 - t.physical);
  s += code[2] === "F" ? (t.flex ? 3 : 0) : (t.flex ? 0 : 2);
  s += code[3] === "P" ? t.pay : t.learn;
  return s;
}

// 43종 전체를 점수순으로. 앞에서 3개가 추천, 맨 뒤가 "신중히 볼 알바".
function rankTypes(code) {
  const ranked = Object.entries(TYPE_SCORES)
    .map(([id, t]) => ({ id, t, s: typeScore(code, t) }))
    .sort((a, b) => b.s - a.s);
  const max = ranked[0].s || 1;
  return ranked.map((r) => ({ ...r, pct: Math.min(98, 60 + Math.round((r.s / max) * 38)) }));
}

// 코드 vs 유형 — 축별로 잘 맞는 이유를 문장으로 생성(강한 것 순으로 최대 3개).
function matchReasons(code, t) {
  const r = [];
  if (code[0] === "E" && t.social >= 4) r.push("손님·동료 응대가 많아 응대형인 당신에게 활력이 돼요");
  if (code[0] === "I" && t.social <= 2) r.push("혼자 조용히 할 수 있어 독립형인 당신에게 편해요");
  if (code[1] === "D" && t.physical >= 4) r.push("계속 몸을 움직여 활동형인 당신에게 시간이 잘 가요");
  if (code[1] === "C" && t.physical <= 2) r.push("체력 부담이 적어 차분형인 당신에게 잘 맞아요");
  if (code[2] === "F" && t.flex) r.push("단기·유연 근무라 유연형인 당신과 궁합이 좋아요");
  if (code[2] === "S" && !t.flex) r.push("꾸준히 다니기 좋아 성실형인 당신에게 안정적이에요");
  if (code[3] === "P" && t.pay >= 3) r.push("시급이 괜찮아 실속형인 당신에게 매력적이에요");
  if (code[3] === "G" && t.learn >= 4) r.push("배울 게 많아 성장형인 당신에게 도움이 돼요");
  return r.slice(0, 3);
}

const CODE_RE = /^[EI][DC][FS][PG]$/;

/* 프리미엄 리포트 본문. 산 사람만 받는다 — 페이월의 실제 경계선은 여기다.
   code 는 사용자 본인의 결과라 그대로 믿어도 되지만, 형식은 검사한다(없는 축 조회 방지). */
app.get("/api/me/report", requireAuth, ah(async (req, res) => {
  if (PAY_ON && !(await store.hasPaid(req.user.id, "premium_report"))) {
    return res.status(402).json({ ok: false, error: "구매가 필요한 콘텐츠예요." });
  }
  const code = String(req.query.code || "").toUpperCase();
  if (!CODE_RE.test(code)) return res.status(400).json({ ok: false, error: "결과 코드가 올바르지 않아요." });
  const ranked = rankTypes(code);
  const worst = ranked[ranked.length - 1];
  // 내 축 4개만 내려준다 — 안 산 극성까지 줄 이유가 없다.
  const axis = {};
  for (const ch of code) axis[ch] = PREMIUM_AXIS_DESC[ch];
  res.json({
    ok: true,
    axis,
    envTags: code.split("").map((ch) => ENV_TAG[ch]),
    top: ranked.slice(0, 3).map((r) => ({ id: r.id, pct: r.pct, reasons: matchReasons(code, r.t) })),
    worst: { id: worst.id, pct: worst.pct },
  });
}));

// 내가 산 것 — 프론트의 페이월 판단 기준.
app.get("/api/me/entitlements", requireAuth, ah(async (req, res) => {
  res.json({ ok: true, entitlements: await entitlementsOf(req.user.id) });
}));

async function entitlementsOf(userId) {
  const out = {};
  for (const key of Object.keys(PRODUCTS)) out[key] = PAY_ON ? await store.hasPaid(userId, key) : true;
  return out;
}

/* ---- 관리자: 결제 내역 조회 · 환불 ---- */
app.get("/api/admin/payments", requireAdmin, ah(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json({ ok: true, ...(await store.listPayments({ limit, offset })) });
}));

app.post("/api/admin/payments/:orderId/cancel", requireAdmin, ah(async (req, res) => {
  if (!PAY_ON) return res.status(503).json({ ok: false, error: "결제가 꺼져 있어요." });
  const pay = await store.findPayment(String(req.params.orderId));
  if (!pay) return res.status(404).json({ ok: false, error: "없는 주문이에요." });
  if (pay.status !== "paid") return res.status(400).json({ ok: false, error: `취소할 수 없는 상태예요(${pay.status}).` });

  const reason = String((req.body || {}).reason || "관리자 환불").slice(0, 100);
  // 취소 요청의 orderId 는 원주문과 별개의 고유값이어야 한다(같은 값으로는 재호출이 막힌다).
  const r = await nicepayPost(`${NICEPAY_API}/v1/payments/${encodeURIComponent(pay.tid)}/cancel`, {
    reason, orderId: `${pay.orderId}_c${Date.now()}`.slice(-64),
  });
  if (r.resultCode !== "0000") {
    console.error("[pay] 취소 실패:", pay.orderId, r.resultCode, r.resultMsg);
    return res.status(502).json({ ok: false, error: r.resultMsg || "취소에 실패했어요." });
  }
  await store.markCancelled(pay.orderId);
  console.log("[pay] 환불 완료:", pay.orderId, r.status);
  res.json({ ok: true, status: r.status });
}));

/* ============================================================
   우리 동네 일할 곳 찾기 — 카카오 로컬 API 프록시
   왜 프록시인가: REST API 키는 프론트에 나가면 그대로 도용당한다(쿼터가 남의 것이 됨).
   브라우저는 좌표만 보내고, 키는 이 서버에서만 쓴다.
   지도 그리기용 JavaScript 키는 성격이 달라서(도메인 잠금) 프론트로 내려보내도 된다.
   ============================================================ */
const KAKAO_REST_KEY = String(process.env.KAKAO_REST_KEY || "").trim();
const KAKAO_JS_KEY = String(process.env.KAKAO_JS_KEY || "").trim();
const PLACES_ON = !!KAKAO_REST_KEY;
const KAKAO_LOCAL = "https://dapi.kakao.com/v2/local";

/* 유형 → 카카오 검색 조건.
   code = 카테고리 그룹 코드(정확도 높음), q = 키워드 검색(카테고리가 없는 업종).
   값이 없는 유형은 "지도에서 찾는 알바"가 아니다(배달·재택·행사처럼 앱/공고로 지원).
   그런 유형은 프론트가 섹션을 숨기고 공고 링크만 보여준다. */
const PLACE_QUERY = {
  cafe: { code: "CE7" }, hall: { code: "FD6" }, kitchen: { code: "FD6" },
  fastfood: { q: "패스트푸드" }, chicken: { q: "치킨" }, dessert: { q: "아이스크림" },
  bakery: { q: "베이커리" }, bar: { q: "호프" },
  cvs: { code: "CS2" }, mart: { code: "MT1" }, beauty: { q: "화장품" },
  bookstore: { q: "서점" }, flower: { q: "꽃집" }, kiosk: { q: "무인매장" },
  pcbang: { q: "PC방" }, study: { q: "스터디카페" }, gym: { q: "헬스장" },
  movie: { q: "영화관" }, karaoke: { q: "노래방" }, amusement: { q: "놀이공원" },
  golf: { q: "골프장" }, lifeguard: { q: "수영장" },
  gas: { code: "OL7" }, hotel: { code: "AD5" }, petcafe: { q: "애견카페" },
  carwash: { q: "세차장" }, clean: { q: "빌딩관리" },
  logi: { q: "물류센터" }, factory: { q: "공장" }, sorting: { q: "택배터미널" },
  moving: { q: "이삿짐센터" }, courier: { q: "택배" },
  tutor: { code: "AC5" }, afterschool: { q: "지역아동센터" },
  wedding: { q: "웨딩홀" },
  // 지도에 찍을 게 없는 유형: cs, datawork, delivery, valet, event, flyer, promoter, babysit
};

/* 같은 동네에서 같은 유형을 계속 눌러도 카카오를 다시 때리지 않는다(무료 쿼터 보호).
   좌표는 소수 3자리(약 100m)로 뭉개서 캐시 키를 만든다. */
const placeCache = new Map();
const PLACE_TTL = 10 * 60 * 1000;
function cacheGet(k) {
  const hit = placeCache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > PLACE_TTL) { placeCache.delete(k); return null; }
  return hit.data;
}
function cacheSet(k, data) {
  if (placeCache.size > 500) placeCache.clear(); // 단순 상한 — LRU까지는 필요 없다
  placeCache.set(k, { at: Date.now(), data });
}

async function kakaoGet(pathname, params) {
  const url = `${KAKAO_LOCAL}${pathname}?` + new URLSearchParams(params).toString();
  const r = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`카카오 응답 파싱 실패 (HTTP ${r.status}): ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`카카오 오류 (HTTP ${r.status}): ${json.msg || text.slice(0, 200)}`);
  return json;
}

// 좌표 유효성 — 대한민국 범위를 크게 벗어나면 거른다(오타·장난 요청 차단).
function readCoord(req) {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}

// 지도 SDK 로딩에 필요한 값. REST 키는 여기에 절대 싣지 않는다.
app.get("/api/places/config", (req, res) => {
  res.json({
    ok: true,
    enabled: PLACES_ON,
    jsKey: KAKAO_JS_KEY || null,           // 없으면 프론트가 목록만 보여준다(지도 없이)
    types: Object.keys(PLACE_QUERY),        // 어떤 유형에 "주변 찾기"를 띄울지 프론트가 판단
  });
});

// 좌표 → 동네 이름. "우리 동네"를 말로 보여주고, 공고 검색 링크에도 쓴다.
app.get("/api/places/region", ah(async (req, res) => {
  if (!PLACES_ON) return res.status(503).json({ ok: false, error: "장소 검색이 꺼져 있어요." });
  const c = readCoord(req);
  if (!c) return res.status(400).json({ ok: false, error: "좌표가 올바르지 않아요." });

  const key = `region|${c.lat.toFixed(3)}|${c.lng.toFixed(3)}`;
  const hit = cacheGet(key);
  if (hit) return res.json(hit);

  const j = await kakaoGet("/geo/coord2regioncode.json", { x: c.lng, y: c.lat });
  const docs = j.documents || [];
  // H = 행정동(사람이 말하는 "○○동"), 없으면 B = 법정동으로 대체.
  const d = docs.find((x) => x.region_type === "H") || docs[0];
  const out = d
    ? { ok: true, si: d.region_1depth_name, gu: d.region_2depth_name, dong: d.region_3depth_name,
        full: [d.region_2depth_name, d.region_3depth_name].filter(Boolean).join(" ") }
    : { ok: true, si: "", gu: "", dong: "", full: "" };
  cacheSet(key, out);
  res.json(out);
}));

// 주변 매장 목록. 반경 기본 1km, 최대 5km(그 이상은 "우리 동네"가 아니다).
app.get("/api/places", ah(async (req, res) => {
  if (!PLACES_ON) return res.status(503).json({ ok: false, error: "장소 검색이 꺼져 있어요." });
  const c = readCoord(req);
  if (!c) return res.status(400).json({ ok: false, error: "좌표가 올바르지 않아요." });

  const type = String(req.query.type || "").trim();
  const spec = PLACE_QUERY[type];
  if (!spec) return res.status(404).json({ ok: false, error: "지도에서 찾을 수 있는 유형이 아니에요." });

  let radius = parseInt(req.query.radius || "1000", 10);
  if (!isFinite(radius)) radius = 1000;
  radius = Math.min(Math.max(radius, 200), 5000);

  const key = `p|${type}|${c.lat.toFixed(3)}|${c.lng.toFixed(3)}|${radius}`;
  const hit = cacheGet(key);
  if (hit) return res.json(hit);

  const common = { x: String(c.lng), y: String(c.lat), radius: String(radius), sort: "distance", size: "15" };
  const j = spec.code
    ? await kakaoGet("/search/category.json", { ...common, category_group_code: spec.code })
    : await kakaoGet("/search/keyword.json", { ...common, query: spec.q });

  const places = (j.documents || []).map((d) => ({
    id: d.id,
    name: d.place_name,
    category: String(d.category_name || "").split(">").pop().trim(),
    address: d.road_address_name || d.address_name || "",
    phone: d.phone || "",
    distance: parseInt(d.distance || "0", 10),  // m
    lat: parseFloat(d.y), lng: parseFloat(d.x),
    url: d.place_url || "",
  }));

  const out = { ok: true, type, radius, total: places.length, places };
  cacheSet(key, out);
  res.json(out);
}));


/* ============================================================
   유형별 공유 링크 — albamates.com/r/ECFG
   카톡·페북에 붙였을 때 고정 이미지 대신 내 유형 카드가 뜨게 한다.
   사람은 앱으로 보내고, 크롤러는 여기 OG 태그만 읽고 간다.
   카드 이미지는 scripts/build_og.js 로 미리 만들어 public/og/ 에 둔다.
   ============================================================ */
const OG_DIR = path.join(__dirname, "public", "og");
let OG_LABELS = {};
try { OG_LABELS = JSON.parse(fs.readFileSync(path.join(OG_DIR, "personas.json"), "utf8")); }
catch (e) { console.warn("유형 이름표 없음 — /r/:code 는 기본 문구로 나갑니다 (node scripts/build_og.js)"); }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

app.get("/r/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!/^[EI][DC][FS][PG]$/.test(code)) return res.redirect(302, "/");

  const base = baseUrl(req);
  const label = OG_LABELS[code] || {};
  const hasCard = fs.existsSync(path.join(OG_DIR, code + ".jpg"));
  const image = hasCard ? `${base}/og/${code}.jpg` : `${base}/og-image.png`;
  const title = label.nick ? `${code} · ${label.nick} — 알바 MBTI` : `${code} — 알바 MBTI`;
  const desc = label.tag
    ? `${label.tag}. 28문항으로 나에게 맞는 알바 유형을 찾아보세요.`
    : "28문항으로 나에게 맞는 알바 유형을 찾아보세요.";

  res.set("Cache-Control", "public, max-age=3600");
  res.type("html").send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${esc(base)}/r/${code}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(image)}" />
<link rel="canonical" href="${esc(base)}/" />
<meta http-equiv="refresh" content="0; url=/" />
</head><body style="font-family:system-ui;padding:40px;text-align:center;color:#555">
<p>알바 MBTI로 이동 중…</p>
<p><a href="/">여기</a>를 눌러주세요.</p>
<script>location.replace("/");</script>
</body></html>`);
});

// 헬스체크 + 결제 상태. Render 서비스에 healthCheckPath=/api/config 가 남아 있어도 통과하도록 경로를 유지한다.
// /api/config 는 프론트가 기동 때 읽고, Render 헬스체크가 이 경로로 남아 있을 수도 있다.
// 여기서 503 을 주면 Render 가 배포 자체를 실패로 보고 트래픽을 아예 안 흘린다 — 항상 200.
app.get("/api/config", (req, res) => res.json({ ok: true, free: !PAY_ON, commit: COMMIT, db: dbState.ready ? "up" : "down" }));

// /api/health 는 감시용이라 저장소가 죽어 있으면 503 + 이유를 실어 보낸다. keepalive 가
// 그대로 실패하되, 로그에 "무응답 타임아웃"이 아니라 원인이 남는다 — 이번 다운의 교훈.
app.get("/api/health", (req, res) => {
  const body = { ok: dbState.ready, free: !PAY_ON, commit: COMMIT, store: store.kind, db: dbState.ready ? "up" : "down" };
  if (!dbState.ready) body.dbError = dbState.error;
  res.status(dbState.ready ? 200 : 503).json(body);
});

app.use(express.static(path.join(__dirname, "public")));

/* 기동 — 포트부터 연다.
   예전엔 store.init() 이 끝나야 listen 했고, 실패하면 process.exit(1) 이었다. 그래서 DB 가
   사라진 날 사이트가 통째로 무응답이 됐고(라우터가 붙을 인스턴스 자체가 없음) 밖에서는
   원인이 안 보였다. 이제는 정적 페이지와 /api/health 는 항상 뜨고, 저장소는 뒤에서 계속
   재시도한다. 저장소가 필요한 API 는 ah() 가 503 으로 돌려보낸다. */
const admin = ADMIN_EMAIL ? `관리자 ${ADMIN_EMAIL}` : "관리자 OFF(ADMIN_EMAIL 미설정)";
app.listen(PORT, () => console.log(`알바 메이트 실행: http://localhost:${PORT} · 저장소 ${store.kind} · ${admin}`));

// 저장소 연결 — 성공할 때까지 백오프 재시도(최대 5분 간격). DB 가 잠깐 죽었다 살아나면
// 재배포 없이 스스로 붙는다.
(async function connectStore(delay = 5000) {
  try {
    await store.init();
    dbState.ready = true;
    dbState.error = null;
    const n = await store.count().catch(() => "?");
    console.log(`저장소 연결됨: ${store.kind} · 계정 ${n}명`);
  } catch (e) {
    dbState.ready = false;
    dbState.error = String((e && e.message) || e);
    console.error(`저장소 초기화 실패(${Math.round(delay / 1000)}초 뒤 재시도):`, dbState.error);
    setTimeout(() => connectStore(Math.min(delay * 2, 300000)), delay).unref?.();
  }
})();
