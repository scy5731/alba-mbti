"use strict";
/* 커뮤니티 시드 — 빈 게시판을 여는 초기 글.
 *
 * 원칙: 존재하지 않는 사람의 '후기·경험담'을 지어내지 않는다. 가짜 후기는 나중에
 * 진짜 사용자가 실제 경험담으로 읽게 되고, 들통나면 커뮤니티 신뢰가 무너진다.
 * 그래서 글쓴이는 전부 정체가 드러난 운영진 계정이고, 내용은
 *   (1) 앱 가이드에 근거한 정보 요약,
 *   (2) 실사용자의 답을 부르는 질문,
 *   (3) 이용 안내
 * 세 가지뿐이다.
 *
 * 사용:
 *   DATABASE_URL=... SEED_PASSWORD=... node scripts/seed-community.js         (운영)
 *   DB_PATH=... node scripts/seed-community.js                                (로컬 파일 저장소)
 *   BASE=http://localhost:3000 ... 서버가 떠 있어야 한다(HTTP API 로 넣는다).
 */
const BASE = process.env.BASE || "http://localhost:3000";
const PASSWORD = process.env.SEED_PASSWORD || "";

if (!PASSWORD || PASSWORD.length < 6) {
  console.error("SEED_PASSWORD 를 6자 이상으로 지정하세요 (운영진 계정 비밀번호).");
  process.exit(1);
}

// 정체를 숨기지 않는 운영진 계정. 닉네임만 봐도 운영진임을 알 수 있어야 한다.
// avatar 는 서버(server.js AVATARS)가 허용하는 이모지여야 한다 — 아니면 조용히 안 붙는다.
const EDITORS = [
  { email: "editor@albamates.com", nickname: "알바메이트 운영자", avatar: "🍀" },
  { email: "guide@albamates.com", nickname: "알바메이트 가이드", avatar: "🌱" },
  { email: "calc@albamates.com", nickname: "알바메이트 계산기", avatar: "⚡" },
];

const POSTS = [
  {
    by: 0, category: "free",
    title: "알바 메이트 커뮤니티를 열었어요 🍀",
    body: `안녕하세요, 알바 메이트 운영자입니다.

여기는 알바하면서 겪는 것들을 서로 물어보고 나누는 공간이에요.
· 궁금한 게 있으면 [질문]
· 해본 알바가 있으면 [후기]
· 알게 된 노하우가 있으면 [꿀팁]
· 그냥 하고 싶은 말은 [자유]

말 못 할 고민(임금체불, 갑질, 부당해고 같은)은 글 쓸 때 '🕶 익명으로 쓰기'를 켜세요. 닉네임이 표시되지 않습니다.

서로 존중하는 말투만 지켜주시면 됩니다. 욕설·광고·개인정보 노출 글은 신고 버튼으로 알려주세요.`,
  },
  {
    by: 0, category: "question",
    title: "첫 알바, 어디서 시작하셨어요?",
    body: `첫 알바를 고를 때 제일 막막한 게 "그래서 뭘 해야 하지?"인 것 같아요.

카페였는지, 편의점이었는지, 물류였는지.
그리고 지금 돌아보면 그 선택이 나한테 맞았는지 궁금합니다.

첫 알바가 뭐였는지, 다시 고른다면 같은 걸 고를지 댓글로 알려주세요.
알바를 앞둔 분들에게 가장 도움 되는 정보일 것 같아요.`,
  },
  {
    by: 0, category: "question",
    title: "면접에서 이런 질문 받아보셨나요?",
    body: `알바 면접에서 자주 나오는 질문이 몇 개 있죠.

"언제까지 일할 수 있어요?"
"주말에도 나올 수 있어요?"
"전에 일해본 적 있어요?"

여기에 뭐라고 답하셨는지, 반대로 이런 걸 물어봤을 때 좋았다는 경험이 있으면 나눠주세요.
곧 면접 보는 분들이 참고할 수 있게요.`,
  },
  {
    by: 1, category: "tip",
    title: "근로계약서, 쓰고 끝이 아니라 '받아야' 합니다",
    body: `계약서를 썼다는 분들도 1부를 받아오지 않은 경우가 많아요.

교부(사업주가 근로자에게 1부를 주는 것)는 사업주의 법적 의무입니다.
안 써주거나 안 주면 사업주가 500만 원 이하 과태료 대상이에요.

받은 계약서는 사진을 찍어 클라우드에도 저장해두세요.
급여 다툼이 생겼을 때 나를 지켜주는 건 결국 기록입니다.

계약서에 꼭 있어야 할 것
· 시급(월급)과 지급일·지급 방법
· 근무 시작일, 요일과 시작·종료 시간
· 맡게 될 업무 내용
· 주휴수당·야간/연장수당 등 수당 조건
· 단기라면 계약 종료일

가이드 탭 > 심화 가이드에 조항별로 더 자세히 정리해뒀어요.`,
  },
  {
    by: 1, category: "tip",
    title: "'교육비 먼저 입금하세요' — 이 말 나오면 그냥 나오세요",
    body: `정상적인 알바는 일을 시작하기 전에 돈을 요구하지 않습니다.

이런 곳은 거르세요
· 교육비·유니폼비·보증금 선입금 요구
· 신분증 원본이나 통장·체크카드를 달라는 곳
· 업무는 불명확한데 '고수익 보장'만 강조
· 면접도 없이 개인정보·계좌부터 요구

특히 신분증과 통장을 넘기면 대포통장이나 명의도용에 쓰일 수 있어요.
피해자가 아니라 가담자로 조사받는 경우까지 있습니다.

이상하다 싶으면 → 플랫폼 신고 / 경찰 112 / 고용노동부 1350 (상담 무료)`,
  },
  {
    by: 1, category: "tip",
    title: "알바도 퇴직금 받을 수 있어요 (조건 2개)",
    body: `"알바는 퇴직금 없다"고 알고 계신 분이 많은데, 아닙니다.

조건은 두 가지예요.
· 1주 소정근로시간 15시간 이상
· 같은 곳에서 1년 이상 계속 근무

이 두 개를 채우면 알바(단시간 근로자)도 퇴직금 대상입니다.
주휴수당과 조건이 비슷해서 같이 기억해두면 편해요.

자세한 계산 방법은 가이드 탭 > 심화 가이드 '알바도 퇴직금 받습니다' 편에 정리해뒀습니다.`,
  },
  {
    by: 2, category: "tip",
    title: "주 15시간 넘게 일하면 주휴수당을 받습니다 (월 17만 원)",
    body: `주휴수당 = 일주일 개근하면, 일하지 않은 하루치 임금을 더 받는 제도입니다.

조건은 딱 2개
· 1주 소정근로시간 15시간 이상
· 그 주에 정해진 근무일을 개근

얼마나 되냐면 (2026년 최저시급 10,320원 기준)
· 주 5일 × 하루 4시간 = 주 20시간
· 주휴수당 = 하루치(4시간) = 41,280원
· 한 달(약 4.34주)이면 약 179,000원

시급에 자동으로 포함해주지 않으면 따로 청구할 수 있고, 못 받았다면 임금체불입니다.
고용노동부 1350에서 무료로 상담·진정할 수 있어요.

내 시급·근무시간으로 얼마인지는 계산기 탭에서 바로 확인할 수 있습니다.`,
  },
  {
    by: 2, category: "question",
    title: "야간수당 제대로 받고 계신가요?",
    body: `밤 10시부터 오전 6시 사이 근무는 야간근로라서 1.5배로 계산돼야 합니다.
(5인 이상 사업장 기준)

편의점 야간, 물류 상하차, 호텔 나이트처럼 밤에 일하시는 분들 중에
시급이 그대로였던 경험 있으신가요?

계산이 맞는지 헷갈리면 계산기 탭에 시급·근무시간·야간시간을 넣어보세요.
주휴수당까지 더한 월 예상 급여가 나옵니다.

이상하다 싶은 급여명세서가 있으면 익명으로 올려주셔도 좋아요. 같이 따져봐요.`,
  },
];

async function main() {
  const jar = {};
  const call = async (who, method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(jar[who] ? { cookie: jar[who] } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) jar[who] = set.split(";")[0];
    return r.json().catch(() => ({}));
  };

  // 운영진 계정 준비 (이미 있으면 로그인)
  for (let i = 0; i < EDITORS.length; i++) {
    const e = EDITORS[i];
    let d = await call(i, "POST", "/api/auth/signup", { email: e.email, password: PASSWORD, nickname: e.nickname });
    if (!d.ok) d = await call(i, "POST", "/api/auth/login", { email: e.email, password: PASSWORD });
    if (!d.ok) { console.error(`계정 실패 (${e.email}):`, d.error); process.exit(1); }
    await call(i, "PATCH", "/api/auth/profile", { avatar: e.avatar });
    console.log(`계정 준비: ${e.nickname}`);
  }

  // 이미 글이 있으면 중복 시드하지 않는다
  const before = await call(0, "GET", "/api/posts?limit=50");
  const existing = new Set((before.posts || []).map((p) => p.title));

  let n = 0;
  for (const p of POSTS) {
    if (existing.has(p.title)) { console.log(`건너뜀(이미 있음): ${p.title}`); continue; }
    const d = await call(p.by, "POST", "/api/posts", { category: p.category, title: p.title, body: p.body, anon: false });
    if (d.ok) { n++; console.log(`올림 [${p.category}] ${p.title}`); }
    else console.error(`실패: ${p.title} — ${d.error}`);
  }
  console.log(`\n완료: ${n}개 등록 (${BASE})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
