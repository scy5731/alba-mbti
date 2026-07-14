"use strict";
/* 로컬 개발용 더미 데이터 — 커뮤니티가 채워졌을 때 화면이 어떻게 보이는지 확인하는 용도.
 *
 * ⚠️ 여기 글·댓글은 전부 지어낸 것이다. 실제 알바 경험이 아니다.
 *    운영(albamates.com)에 올리면 그 순간 '가짜 후기'가 되어 실사용자를 속이게 된다.
 *    그래서 BASE 가 localhost 가 아니면 실행을 거부한다. 이 가드를 풀지 말 것.
 *    운영 게시판의 초기 글은 scripts/seed-community.js (운영진 계정, 지어낸 경험담 없음) 를 쓴다.
 *
 * 사용: 로컬 서버를 띄운 뒤
 *   BASE=http://localhost:3000 node scripts/demo-seed-local.js
 */
const BASE = process.env.BASE || "http://localhost:3000";
const PASSWORD = process.env.SEED_PASSWORD || "demo1234";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("이 스크립트는 로컬에서만 돌릴 수 있어요. (지어낸 글이라 운영에 올리면 안 됩니다)");
  console.error("운영 게시판 초기 글은 scripts/seed-community.js 를 쓰세요.");
  process.exit(1);
}

const USERS = [
  { key: "a", email: "demo-a@local.test", nickname: "야간러", avatar: "🐻" },
  { key: "b", email: "demo-b@local.test", nickname: "카페알바3년", avatar: "🐱" },
  { key: "c", email: "demo-c@local.test", nickname: "물류뛰는중", avatar: "⚡" },
  { key: "d", email: "demo-d@local.test", nickname: "복학생김씨", avatar: "🐸" },
  { key: "e", email: "demo-e@local.test", nickname: "첫알바긴장", avatar: "🐣" },
  { key: "f", email: "demo-f@local.test", nickname: "과외러", avatar: "🦊" },
  { key: "g", email: "demo-g@local.test", nickname: "편의점주말러", avatar: "🐨" },
  { key: "h", email: "demo-h@local.test", nickname: "홀서빙3개월", avatar: "🐼" },
  { key: "i", email: "demo-i@local.test", nickname: "배달뛰는대학생", avatar: "🦁" },
  { key: "j", email: "demo-j@local.test", nickname: "졸업반알바", avatar: "🦄" },
];

const POSTS = [
  {
    by: "e", category: "question", anon: false,
    title: "편의점 야간 첫 출근인데 뭘 준비해가야 하나요?",
    body: `내일 첫 야간 출근이에요. 22시~7시 근무입니다.
편의점 알바가 처음이라 뭘 챙겨가야 할지 모르겠어요.

담배 위치 외우는 게 제일 어렵다는 말은 들었는데
그거 말고 미리 알아두면 좋은 거 있을까요?`,
    comments: [
      { by: "a", body: "물이랑 간단한 간식 챙기세요. 새벽 3~5시가 진짜 고비예요. 담배는 어차피 며칠이면 외워집니다." },
      { by: "b", body: "첫날은 인수인계 받는 것만으로도 정신없어요. 폐기 처리랑 발주 시간만 확실히 물어보고 오세요." },
      { by: "a", body: "아 그리고 야간은 시급 1.5배인지 계약서 꼭 확인하세요. 5인 미만이면 안 줘도 되긴 하는데 물어보긴 해야죠." },
    ],
  },
  {
    by: "b", category: "review", anon: false,
    title: "카페 알바 3년 하고 느낀 점 (장단점 솔직히)",
    body: `프랜차이즈 두 곳, 개인 카페 한 곳에서 일했어요.

좋았던 점
- 실내라 덥고 추운 거 걱정 없음
- 음료 만드는 게 은근 재밌어짐
- 단골 손님 생기면 출근이 덜 싫어짐

힘들었던 점
- 피크타임엔 진짜 정신 나감. 주문 밀리면 손이 떨림
- 서서 일해서 다리 아픔. 압박스타킹 신는 사람 많아요
- 진상 손님 한 명이 하루를 다 망침

시급은 대부분 최저시급이었고, 개인 카페가 그나마 유연했어요.
사람 상대하는 게 괜찮은 사람한테는 나쁘지 않은 알바입니다.`,
    comments: [
      { by: "d", body: "피크타임 손 떨리는 거 너무 공감돼요 ㅋㅋㅋ 저도 카페 하다가 그만뒀는데 그것 때문이었어요" },
      { by: "e", body: "다리 아픈 건 어떻게 버티셨어요? 신발 추천 좀 부탁드려요" },
      { by: "b", body: "쿠션 좋은 운동화에 깔창 따로 넣었어요. 그리고 쉬는 시간에 무조건 앉았습니다." },
    ],
  },
  {
    by: "c", category: "review", anon: false,
    title: "물류센터 상하차 일당 후기 (체력 자신 있으면)",
    body: `쿠팡 물류 새벽 상하차 3주째입니다.

일당은 확실히 세요. 근데 그만큼 몸을 갈아넣습니다.
첫 주는 퇴근하고 바로 뻗었어요. 손목이랑 허리가 제일 먼저 나갑니다.

장점은 사람 상대 안 해도 된다는 거예요.
말 걸 일이 거의 없어서 응대 스트레스가 0입니다.
음악 들으면서 몸만 쓰면 되니까 저한테는 맞았어요.

체력 자신 없으면 진짜 비추천입니다. 허리보호대 꼭 하세요.`,
    comments: [
      { by: "a", body: "손목 나가는 거 진짜예요. 저는 손목보호대까지 했습니다" },
      { by: "f", body: "일당 얼마 정도 되나요? 방학 때 잠깐 해볼까 고민 중이에요" },
      { by: "c", body: "센터마다 다른데 저는 야간 기준 10만원 초반이었어요. 주간은 더 낮습니다." },
    ],
  },
  {
    by: "d", category: "question", anon: true,
    title: "사장님이 계약서를 안 써주는데 어떻게 말해야 할까요",
    body: `일 시작한 지 2주 됐는데 아직 근로계약서를 안 썼어요.

먼저 얘기했더니 "우리는 원래 안 써, 다들 그냥 일해" 이러시네요.
분위기 나빠질까 봐 더 말 못 꺼내겠는데
그래도 써야 하는 거 맞죠?

어떻게 말을 꺼내야 자연스러울까요...`,
    comments: [
      { by: "b", body: "\"급여 정산 때문에 저도 기록이 필요해서요\" 이런 식으로 말하면 덜 각 세워져요" },
      { by: "a", body: "안 써주면 사장님이 과태료 대상이에요. 그걸 굳이 말할 필요는 없지만 알고는 계세요." },
      { by: "c", body: "최소한 문자로라도 시급이랑 근무시간 남겨두세요. 나중에 다툼 생기면 그게 증거됩니다." },
    ],
  },
  {
    by: "a", category: "tip", anon: false,
    title: "야간 알바하면서 생활리듬 안 무너지는 법 (제 기준)",
    body: `야간 6개월째인데 나름 자리 잡은 방법 공유해요.

1. 퇴근하고 바로 자지 말고 2시간 정도 버티기
   → 아침에 자면 오후 늦게 일어나서 밤에 또 멀쩡함
2. 암막커튼은 필수. 안대로는 부족해요
3. 출근 전에 밥 챙겨먹기. 새벽에 배고프면 편의점 음식으로 때우게 됨
4. 쉬는 날에도 비슷한 시간에 자고 일어나기 (이게 제일 어려움)

야간 오래 할 생각이면 생활 패턴부터 잡는 게 시급보다 중요한 것 같아요.`,
    comments: [
      { by: "e", body: "저 내일 첫 야간인데 저장해둡니다 감사해요" },
      { by: "d", body: "암막커튼 진짜 인정. 저는 그거 사고 인생 바뀌었어요" },
    ],
  },
  {
    by: "f", category: "question", anon: false,
    title: "과외비 안 주고 연락 끊은 학부모, 어떻게 해야 하나요",
    body: `대학생 과외인데 두 달치가 밀렸어요.
처음엔 "다음 주에 드릴게요" 하시더니 이제 카톡을 읽고 답이 없습니다.

계약서는 안 썼고, 카톡으로 시급이랑 시간 정한 기록은 있어요.
수업 날짜도 다 캘린더에 남아 있고요.

이런 것도 임금체불로 신고가 되나요? 아니면 그냥 포기해야 하나요...`,
    comments: [
      { by: "b", body: "카톡 기록 있으면 증거 됩니다. 절대 지우지 마세요" },
      { by: "c", body: "고용노동부 1350 무료 상담부터 받아보세요. 과외도 근로관계로 볼 수 있는 경우가 있어요" },
      { by: "a", body: "저도 비슷한 일 겪었는데 내용증명 보내니까 바로 입금하더라고요" },
    ],
  },
  {
    by: "e", category: "free", anon: true,
    title: "알바 처음인데 면접에서 너무 떨어서 망친 것 같아요",
    body: `오늘 카페 면접 봤는데 말을 너무 더듬었어요.
"언제부터 나올 수 있냐"는 질문에 "아 그게... 저... 아무때나요" 이렇게 답해버림 ㅠㅠ

원래 다들 이렇게 떠나요?
연락 안 오겠죠...`,
    comments: [
      { by: "b", body: "첫 면접은 다 그래요. 저도 첫 면접에서 손 떨려서 지원서 떨어뜨렸습니다 ㅋㅋ" },
      { by: "d", body: "생각보다 사장님들 그런 거 신경 안 써요. 성실해 보이는지가 중요하지" },
      { by: "e", body: "위로 감사합니다... 연락 오면 다시 후기 남길게요" },
    ],
  },
  {
    by: "c", category: "tip", anon: false,
    title: "급여명세서 받으면 이것만은 꼭 확인하세요",
    body: `저도 처음엔 그냥 입금액만 보고 넘겼는데, 따져보니 빠진 게 있더라고요.

확인할 것
- 근무시간이 내가 일한 시간이랑 맞는지
- 야간(밤 10시~오전 6시) 시간이 1.5배로 계산됐는지
- 주휴수당이 따로 잡혀 있는지 (시급에 포함이라면 그것도 명시돼야 함)
- 3.3% 떼갔으면 왜 뗐는지 (근로자인데 3.3% 떼는 건 이상한 경우가 많음)

이 앱 계산기 탭에 시급이랑 시간 넣어보면 예상 금액 나오니까
명세서랑 비교해보시면 됩니다.`,
    comments: [
      { by: "f", body: "3.3% 그거 저도 떼였는데 돌려받을 수 있다는 말 듣고 알아보는 중이에요" },
      { by: "a", body: "계산기 돌려보니까 제 주휴수당이 안 들어가 있었네요... 내일 말해봐야겠어요" },
      { by: "h", body: "명세서를 아예 안 주는 곳도 있어요. 이런 경우엔 어떻게 해야 하나요?" },
      { by: "c", body: "명세서 교부도 의무입니다. 요구할 수 있어요." },
    ],
  },
  {
    by: "g", category: "review", anon: false,
    title: "편의점 주말 주간 6개월 했습니다 (야간이랑 비교)",
    body: `토·일 주간(9~18시)만 6개월 했어요. 야간도 두 달 해봤는데 비교하자면요.

주말 주간
- 손님이 계속 들어와서 심심할 틈이 없음
- 물건 정리, 진열, 유통기한 확인이 대부분
- 사장님이랑 마주칠 일이 많아서 눈치가 좀 보임

야간
- 새벽엔 손님이 거의 없어서 조용함
- 대신 취객 응대가 가끔 있음
- 시급은 야간이 확실히 나음

체력보다 성향 문제인 것 같아요. 저는 사람 많은 게 덜 지치더라고요.`,
    comments: [
      { by: "a", body: "취객 응대 진짜 공감... 그거 하나 때문에 야간 그만두는 사람 많아요" },
      { by: "e", body: "저 내일 첫 야간인데 무서워지네요 ㅠㅠ" },
      { by: "g", body: "대부분은 조용히 사갑니다! 너무 걱정 마세요" },
    ],
  },
  {
    by: "i", category: "question", anon: false,
    title: "배달 알바 하는데 사고 나면 산재 처리 되나요?",
    body: `배달대행 쓰는 중인데 계약서에 '개인사업자'로 되어 있어요.

지난주에 빗길에 넘어져서 무릎이 좀 까졌는데
병원비를 제가 다 냈거든요.

이런 것도 산재 신청이 되는 건가요?
개인사업자라고 하면 안 되는 건지 헷갈립니다.`,
    comments: [
      { by: "j", body: "형식만 개인사업자여도 실질이 근로자면 산재 대상이 될 수 있어요. 근로복지공단 1588-0075에 물어보세요" },
      { by: "c", body: "배달 라이더는 산재 특수형태근로종사자로 따로 규정돼 있어요. 신청 가능합니다" },
      { by: "i", body: "감사합니다! 내일 전화해볼게요" },
    ],
  },
  {
    by: "h", category: "free", anon: true,
    title: "손님한테 반말 들었는데 그냥 참는 게 맞나요",
    body: `홀서빙 3개월째인데 오늘 손님이 "야, 물"이라고 하시더라고요.

사장님은 그냥 웃으면서 넘기라고 하시는데
집에 오니까 계속 생각나고 기분이 안 좋아요.

다들 이런 거 그냥 넘기시나요?`,
    comments: [
      { by: "b", body: "저도 처음엔 다 담아뒀는데, 그 사람 인성 문제지 내 잘못이 아니라고 생각하려고 해요" },
      { by: "g", body: "그냥 넘기는 게 맞다고 생각하지 마세요. 심하면 사장님한테 정식으로 말해도 됩니다" },
      { by: "j", body: "감정노동도 노동이에요. 너무 혼자 삭이지 마세요" },
    ],
  },
  {
    by: "j", category: "tip", anon: false,
    title: "알바 그만둘 때 언제 말해야 하나요 (제 경험 기준)",
    body: `알바 세 번 그만둬 봤는데, 갑자기 말하면 서로 얼굴 붉히게 되더라고요.

제 기준으로는
- 최소 2주 전에는 말하기 (사장님이 사람 구할 시간)
- 문자나 카톡으로 기록 남기기 (구두로만 하면 나중에 말이 달라짐)
- 마지막 급여 지급일 확인하기

법적으로는 1개월 전 통보가 원칙이지만 알바는 보통 2주면 이해해주시더라고요.
그리고 그만둔 뒤에도 급여는 무조건 받아야 합니다. 퇴사했다고 안 주는 건 임금체불이에요.`,
    comments: [
      { by: "d", body: "마지막 급여 안 주고 버티는 사장님 실제로 있어요. 기록 남기는 거 중요합니다" },
      { by: "g", body: "저는 2주 전에 말했는데도 화내시더라고요... 그래도 말하는 게 맞죠" },
    ],
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

  for (const u of USERS) {
    let d = await call(u.key, "POST", "/api/auth/signup", { email: u.email, password: PASSWORD, nickname: u.nickname });
    if (!d.ok) d = await call(u.key, "POST", "/api/auth/login", { email: u.email, password: PASSWORD });
    if (!d.ok) { console.error(`계정 실패 (${u.email}):`, d.error); process.exit(1); }
    await call(u.key, "PATCH", "/api/auth/profile", { avatar: u.avatar });
  }
  console.log(`더미 계정 ${USERS.length}명 준비`);

  const before = await call("a", "GET", "/api/posts?limit=50");
  const existing = new Set((before.posts || []).map((p) => p.title));

  let posts = 0, comments = 0, likes = 0;
  for (const p of POSTS) {
    if (existing.has(p.title)) { console.log(`건너뜀: ${p.title}`); continue; }
    const d = await call(p.by, "POST", "/api/posts", { category: p.category, title: p.title, body: p.body, anon: !!p.anon });
    if (!d.ok) { console.error(`실패: ${p.title} — ${d.error}`); continue; }
    posts++;
    for (const c of p.comments || []) {
      const r = await call(c.by, "POST", `/api/posts/${d.post.id}/comments`, { body: c.body, anon: !!c.anon });
      if (r.ok) comments++;
    }
    // 좋아요도 몇 개 눌러 둔다 — 숫자가 0뿐이면 화면이 어색해서
    for (const u of USERS.slice(0, 1 + (d.post.id % 4))) {
      const r = await call(u.key, "POST", `/api/posts/${d.post.id}/like`);
      if (r.ok && r.liked) likes++;
    }
    console.log(`[${p.category}]${p.anon ? "(익명)" : ""} ${p.title}`);
  }
  console.log(`\n완료: 글 ${posts} · 댓글 ${comments} · 좋아요 ${likes} (${BASE})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
