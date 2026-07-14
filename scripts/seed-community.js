"use strict";
/* 커뮤니티 시드 — 빈 게시판을 여는 초기 글.
 *
 * 원칙: 존재하지 않는 사람의 '후기·경험담'을 지어내지 않는다. 가짜 후기는 나중에
 * 진짜 사용자가 실제 경험담으로 읽게 되고, 들통나면 커뮤니티 신뢰가 무너진다.
 * 그래서 글쓴이는 전부 정체가 드러난 운영진 계정이고, 내용은
 *   (1) 앱 가이드에 근거한 정보 요약,
 *   (2) 실사용자의 답을 부르는 질문,
 *   (3) 이용 안내
 * 세 가지뿐이다. 톤은 공지가 아니라 말 거는 대화체로 쓴다.
 *
 * 같은 제목의 글이 이미 있으면 건너뛴다. oldTitle 이 있으면 그 글을 찾아
 * 새 제목·본문으로 갱신한다(카피를 고쳐 다시 돌릴 때 쓴다).
 *
 * 사용:
 *   BASE=https://albamates.com SEED_PASSWORD=... node scripts/seed-community.js
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
    oldTitle: "알바 메이트 커뮤니티를 열었어요 🍀",
    title: "여기, 알바 얘기 편하게 하는 곳이에요 🍀",
    body: `안녕하세요! 알바 메이트 운영자입니다.

이 게시판은 알바하면서 생기는 것들을 서로 물어보고 나누라고 만들었어요.
잘 쓴 글일 필요 없어요. 겪은 거, 궁금한 거 툭 던져주시면 됩니다.

· 뭔가 궁금하다 → [질문]
· 이 알바 해봤다 → [후기]
· 이건 알아두면 좋다 → [꿀팁]
· 그냥 하고 싶은 말 → [자유]

말 꺼내기 어려운 이야기(월급을 안 준다, 사장님이 심하다 같은)는
글 쓸 때 '🕶 익명으로 쓰기'를 켜세요. 닉네임이 안 보입니다.

서로 존중하는 말투만 지켜주시면 돼요.
불편한 글이 보이면 신고 버튼 눌러주세요. 제가 확인합니다.`,
  },
  {
    by: 0, category: "question",
    oldTitle: "첫 알바, 어디서 시작하셨어요?",
    title: "첫 알바 뭐였어요? 다시 고른다면 같은 거 고르실 건가요",
    body: `알바 처음 구할 때 제일 막막한 게 "그래서 뭘 해야 하지"인 것 같아요.
카페? 편의점? 물류? 다들 뭐부터 시작하셨나요.

그리고 지금 돌아보면, 그때 그 선택이 나한테 잘 맞았나요?

첫 알바가 뭐였는지, 다시 고른다면 같은 걸 고를지 댓글로 알려주세요.
지금 첫 알바를 앞둔 분들한테는 이게 제일 도움 되는 이야기일 거예요.`,
  },
  {
    by: 0, category: "question",
    oldTitle: "면접에서 이런 질문 받아보셨나요?",
    title: "면접에서 이 질문 받으면 뭐라고 답하세요?",
    body: `알바 면접 가면 거의 매번 나오는 질문들이 있죠.

"언제까지 일할 수 있어요?"
"주말에도 나올 수 있어요?"
"전에 일해본 적 있어요?"

솔직하게 답하면 떨어질까 싶고, 맞춰서 답하자니 나중에 힘들고.
다들 여기에 뭐라고 답하시나요?

반대로 "이렇게 답했더니 바로 붙었다" 하는 게 있으면 그것도 알려주세요.
곧 면접 보는 분들이 보고 갈 거예요.`,
  },
  {
    by: 1, category: "tip",
    oldTitle: "근로계약서, 쓰고 끝이 아니라 '받아야' 합니다",
    title: "계약서 쓰셨어요? 그럼 1부 받아오셨나요",
    body: `계약서는 썼는데 정작 1부를 안 받아온 경우가 많더라고요. 근데 이게 중요합니다.

교부(사장님이 근로자에게 1부를 주는 것)는 사장님의 법적 의무예요.
안 써주거나 안 주면 사장님이 500만 원 이하 과태료 대상입니다.

받으면 사진 찍어서 클라우드에도 올려두세요.
나중에 급여 다툼이 생겼을 때 결국 나를 지켜주는 건 기록이에요.

계약서에 이건 꼭 있어야 해요
· 시급(월급), 지급일, 지급 방법
· 근무 시작일, 요일, 시작·종료 시간
· 무슨 일을 하는지
· 주휴수당·야간/연장수당 조건
· 단기면 계약 종료일

혹시 지금 계약서 없이 일하고 계신 분 있나요?
어떻게 말을 꺼내야 할지 막막하면 댓글 주세요. 같이 방법을 찾아봐요.`,
  },
  {
    by: 1, category: "tip",
    oldTitle: "'교육비 먼저 입금하세요' — 이 말 나오면 그냥 나오세요",
    title: "\"교육비 먼저 입금하세요\" 이 말 들으면 그냥 나오세요",
    body: `정상적인 알바는 일을 시작하기 전에 돈을 요구하지 않아요. 여기엔 예외가 없습니다.

이런 곳은 거르세요
· 교육비·유니폼비·보증금을 먼저 입금하라는 곳
· 신분증 원본이나 통장·체크카드를 달라는 곳
· 무슨 일인지는 애매한데 "고수익 보장"만 강조하는 곳
· 면접도 없이 개인정보랑 계좌부터 요구하는 곳

특히 신분증이랑 통장을 넘기면 대포통장이나 명의도용에 쓰일 수 있어요.
피해자인데 오히려 가담자로 조사받는 경우까지 있습니다.

이상하다 싶으면 → 플랫폼 신고 / 경찰 112 / 고용노동부 1350 (상담은 무료예요)

혹시 "이거 사기인가?" 싶은 공고 보신 적 있나요?
어떤 곳이었는지 알려주시면 다른 분들이 피해 갈 수 있을 것 같아요.`,
  },
  {
    by: 1, category: "tip",
    oldTitle: "알바도 퇴직금 받을 수 있어요 (조건 2개)",
    title: "알바도 퇴직금 받을 수 있는 거, 알고 계셨어요?",
    body: `"알바는 퇴직금 없다"고 알고 계신 분이 많은데, 아닙니다.

조건은 딱 두 개예요.
· 1주에 15시간 이상 일했고
· 같은 곳에서 1년 넘게 계속 일했으면

알바(단시간 근로자)도 퇴직금 대상입니다.
주휴수당이랑 조건이 비슷해서 같이 외워두면 편해요.

혹시 한 곳에서 1년 가까이 일하고 계신 분 있나요?
그만두기 전에 꼭 확인하세요. 계산 방법은 가이드 탭에 정리해뒀습니다.`,
  },
  {
    by: 2, category: "tip",
    oldTitle: "주 15시간 넘게 일하면 주휴수당을 받습니다 (월 17만 원)",
    title: "혹시 주휴수당 못 받고 계신 분? (한 달 17만 원입니다)",
    body: `주휴수당, 모르고 못 받는 분이 생각보다 많아요.

간단히 말하면 일주일 개근하면 일 안 한 하루치 임금을 더 주는 제도예요.

조건은 두 개뿐입니다
· 1주에 15시간 이상 일하고
· 그 주에 정해진 날 다 나왔으면

얼마냐면요 (2026년 최저시급 10,320원 기준)
· 주 5일 × 하루 4시간 = 주 20시간
· 주휴수당 = 하루치(4시간) = 41,280원
· 한 달이면 약 179,000원

한 달에 17만 원이면 적은 돈이 아니잖아요.
시급에 자동으로 안 넣어주면 따로 청구할 수 있고, 못 받았으면 그건 임금체불이에요.

내 시급으로 얼마인지는 계산기 탭에 넣어보면 바로 나옵니다.
계산해보고 이상하다 싶으면 댓글 주세요. 같이 봐드릴게요.`,
  },
  {
    by: 2, category: "question",
    oldTitle: "야간수당 제대로 받고 계신가요?",
    title: "야간수당 1.5배, 제대로 받고 계세요?",
    body: `밤 10시부터 오전 6시 사이 근무는 야간근로라서 1.5배로 계산돼야 해요.
(5인 이상 사업장 기준입니다)

편의점 야간, 물류 상하차, 호텔 나이트처럼 밤에 일하시는 분들.
혹시 시급이 낮이랑 똑같지 않나요?

급여명세서 한번 꺼내서 확인해보세요.
헷갈리면 계산기 탭에 시급·근무시간·야간시간을 넣어보시면
주휴수당까지 더한 예상 금액이 나옵니다.

계산이 안 맞는 것 같으면 명세서 내용을 익명으로 올려주셔도 좋아요. 같이 따져봐요.`,
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

  const before = await call(0, "GET", "/api/posts?limit=50");
  const existing = new Map((before.posts || []).map((p) => [p.title, p]));

  let added = 0, updated = 0;
  for (const p of POSTS) {
    const old = p.oldTitle && existing.get(p.oldTitle);
    if (old) {
      const d = await call(p.by, "PATCH", "/api/posts/" + old.id, { category: p.category, title: p.title, body: p.body });
      if (d.ok) { updated++; console.log(`갱신 [${p.category}] ${p.title}`); }
      else console.error(`갱신 실패: ${p.title} — ${d.error}`);
      continue;
    }
    if (existing.has(p.title)) { console.log(`건너뜀(이미 있음): ${p.title}`); continue; }
    const d = await call(p.by, "POST", "/api/posts", { category: p.category, title: p.title, body: p.body, anon: false });
    if (d.ok) { added++; console.log(`올림 [${p.category}] ${p.title}`); }
    else console.error(`실패: ${p.title} — ${d.error}`);
  }
  console.log(`\n완료: 새 글 ${added} · 갱신 ${updated} (${BASE})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
