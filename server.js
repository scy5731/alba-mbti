"use strict";
// 알바 MBTI — 정적 앱 + 토스페이먼츠 결제 승인(confirm)만 담당하는 초경량 서버.
const path = require("path");
const express = require("express");

const PORT = process.env.PORT || 3000;
const PRICE = 990;                                   // 결과 리포트 가격(원)
const CLIENT_KEY = process.env.TOSS_CLIENT_KEY || ""; // 프론트에 노출되는 클라이언트 키(test_ck_...)
const SECRET_KEY = process.env.TOSS_SECRET_KEY || ""; // 서버에서만 쓰는 시크릿 키(test_sk_...)

const app = express();
app.use(express.json());

// 프론트가 결제 UI를 띄우는 데 필요한 공개 설정
app.get("/api/config", (req, res) => res.json({ tossClientKey: CLIENT_KEY, price: PRICE }));

// 결제 승인: 프론트가 successUrl 리다이렉트로 받은 paymentKey/orderId/amount를 서버가 토스에 confirm
app.post("/api/confirm", async (req, res) => {
  const { paymentKey, orderId, amount } = req.body || {};
  if (!SECRET_KEY) return res.status(400).json({ ok: false, error: "서버에 TOSS_SECRET_KEY가 설정되지 않았어요." });
  if (!paymentKey || !orderId || Number(amount) !== PRICE)
    return res.status(400).json({ ok: false, error: "잘못된 결제 요청이에요." });
  try {
    const r = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(SECRET_KEY + ":").toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return res.json({ ok: true, method: data.method, approvedAt: data.approvedAt, totalAmount: data.totalAmount });
    return res.status(r.status).json({ ok: false, error: data.message || "결제 승인에 실패했어요.", code: data.code });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "결제 서버 연결에 실패했어요." });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => console.log(`알바 메이트 실행: http://localhost:${PORT} (toss ${CLIENT_KEY ? "ON" : "OFF"})`));
