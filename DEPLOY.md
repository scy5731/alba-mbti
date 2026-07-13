# 알바 MBTI — GCP 배포 가이드 (PWA + 자동 HTTPS)

설치형 웹앱(PWA)을 GCP VM에 Docker로 배포한다. 앞단 **Caddy**가 Let's Encrypt 인증서를
자동 발급/갱신하고, 뒤의 앱 컨테이너(Node/Express)로 프록시한다.
> 토스 결제와 PWA(서비스워커) 모두 **HTTPS + 실도메인**이 필수라 이 구성이 필요하다.

---

## 0. 준비물
- GCP VM 인스턴스 (e2-small 이상 권장, Ubuntu 22.04+)
- VM에 **Docker + docker compose** 설치
- **도메인 1개** (예: `alba.example.com`)
  - 도메인이 없으면 무료 서브도메인(예: DuckDNS)도 Caddy 인증서 발급 가능

## 1. DNS 연결
도메인의 **A 레코드**가 VM의 외부 IP를 가리키게 설정한다.
```
alba.example.com   A   <VM 외부 IP>
```
`nslookup alba.example.com` 으로 전파 확인.

## 2. GCP 방화벽 (80·443 오픈)
```bash
gcloud compute firewall-rules create allow-http-https \
  --allow=tcp:80,tcp:443 --direction=INGRESS --target-tags=http-server,https-server
# VM에 http-server / https-server 네트워크 태그가 붙어 있는지 확인
```
(콘솔의 "HTTP/HTTPS 트래픽 허용" 체크로도 가능)

## 3. 코드 배치
VM에서 프로젝트를 받는다(git clone 또는 scp).
```bash
git clone <repo> alba_app && cd alba_app
# 또는 로컬에서:  scp -r C:\SCY_work\alba_app  user@VM:/home/user/alba_app
```

## 4. 환경변수(.env) 설정
`.env`를 열어 **도메인**과 **토스 키**를 채운다. (지금은 테스트키 유지)
```
DOMAIN=albamates.com
TOSS_CLIENT_KEY=test_ck_...
TOSS_SECRET_KEY=test_sk_...
```
> `.env` 와 `toss_key.txt` 는 절대 커밋/공유하지 말 것 (시크릿 포함).

## 5. 기동
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Caddy가 자동으로 인증서를 발급한다(수십 초). 로그 확인:
```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

## 6. 확인
- 브라우저에서 `https://alba.example.com` 접속 → 자물쇠(HTTPS) 정상
- 모바일 크롬/사파리에서 **"홈 화면에 추가"** → 아이콘 설치되고 전체화면 실행되면 PWA OK
- 테스트 결제 왕복(결제창 → 테스트카드 → 결과 리포트) 동작 확인

---

## 업데이트(재배포)
```bash
git pull            # 또는 변경분 scp
docker compose -f docker-compose.prod.yml up -d --build
```
서비스워커 캐시는 `sw.js`의 `CACHE` 버전(`alba-mbti-v1`)을 올리면 갱신된다.
(index.html은 network-first라 대부분 자동 반영)

## 로컬 개발(참고)
프로덕션과 별개로 로컬은 기존 방식 그대로:
```bash
docker compose up -d --build     # http://localhost:8080
```

---

## 나중에: 실제 과금으로 전환
1. **사업자등록** 후 토스페이먼츠 정식 계약/심사
2. 라이브 키(`live_ck_...` / `live_sk_...`) 발급
3. `.env`의 키를 라이브 키로 교체 → `docker compose -f docker-compose.prod.yml up -d`
4. 결제 검증을 **서버 세션에 묶기**(현재는 데모용으로 localStorage `paid:true`에 의존)
   — 실결제 단계에선 주문 생성/승인 상태를 서버가 재검증하도록 강화 권장

## 참고
- 테스트 키는 실도메인/HTTPS에서도 정상 동작하며 실제 청구되지 않는다.
- 시크릿 키는 서버 컨테이너 안에만 존재하고 프론트로 노출되지 않는다.
- 인증서·프록시 데이터는 `caddy_data`/`caddy_config` 볼륨에 보존된다.

---

# 커스텀 도메인: albamates.com (Render)

서비스는 Render(`alba-mbti`)에서 돌고 있고, 기본 주소는 `https://alba-mbti.onrender.com`.
여기에 `albamates.com` 을 붙인다. **코드 변경은 필요 없다** — 앱의 모든 경로가 상대경로이고
토스 결제 successUrl 도 `location.origin` 기준이라 도메인이 바뀌어도 그대로 동작한다.

## 1) Render 에 도메인 등록
`render.yaml` 에 이미 선언돼 있다:
```yaml
domains:
  - albamates.com
  - www.albamates.com
```
Blueprint 를 재동기화(Render 대시보드 → Blueprint → Sync)하면 자동 반영된다.
수동으로 하려면: 대시보드 → 서비스 `alba-mbti` → **Settings → Custom Domains → Add**
에서 두 도메인을 추가한다.

## 2) 도메인 등록업체(DNS)에 레코드 추가  ← **이 단계는 직접 해야 함**
Render 가 화면에 표시해 주는 값을 그대로 넣는다. 통상 다음과 같다:

| 호스트 | 타입 | 값 |
|---|---|---|
| `@` (albamates.com) | **A** | `216.24.57.1` |
| `www` | **CNAME** | `alba-mbti.onrender.com` |

- apex(`@`)에 CNAME 은 못 넣는다. 등록업체가 ALIAS/ANAME 을 지원하면 A 대신 그걸 써도 된다.
- **반드시 Render 대시보드에 표시된 실제 값을 확인할 것.** 위 IP 는 바뀔 수 있다.

## 3) 검증
DNS 전파(보통 수 분~수 시간) 후:
```bash
nslookup albamates.com
nslookup www.albamates.com
curl -I https://albamates.com/
```
Render 대시보드의 도메인 상태가 **Verified** 가 되면 TLS 인증서(Let's Encrypt)가
자동 발급된다. `https://albamates.com` 이 200 이면 완료.

## 4) 도메인 붙인 뒤 확인할 것
- **링크 미리보기**: `public/og-image.png`(1200x630) + index.html 의 og/twitter 메타.
  카카오톡은 미리보기를 캐시하므로 갱신이 필요하면
  [카카오 디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 캐시 초기화.
- **PWA**: manifest 의 `start_url`/`scope` 는 `/` 상대경로라 도메인 변경 영향 없음.
- **토스 결제**: successUrl 이 `origin` 기반이라 별도 등록 불필요(토스는 도메인 화이트리스트 없음).

## 참고: Caddy(홈/GCP 호스팅) 경로를 쓸 경우
Render 대신 직접 호스팅한다면 `.env` 의 `DOMAIN=albamates.com` 으로 두고
`docker compose -f docker-compose.prod.yml up -d --build`. 이때는 DNS A레코드가
그 서버의 공인 IP 를 가리켜야 한다. (현재 운영은 Render 이므로 이 경로는 미사용)
