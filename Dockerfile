# 알바 성향 테스트 — 정적 웹앱 (Express static)
FROM node:20-bookworm-slim

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY package*.json ./
RUN npm install --omit=dev

# 앱 소스
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
