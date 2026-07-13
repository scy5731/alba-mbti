#!/usr/bin/env bash
# 카드뉴스 빌드: slides.js → html/ → out/*.png (1080x1350, 4:5)
# 사용: cd promo && bash build.sh
set -e
cd "$(dirname "$0")"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
ROOT="C:/SCY_work/alba_app/promo"

node render.js
mkdir -p out && rm -f out/*.png

for f in html/*.html; do
  b=$(basename "$f" .html)
  # 경로는 반드시 슬래시로 — bash 큰따옴표 안의 "\\$b" 는 변수 확장이 깨진다
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --allow-file-access-from-files --window-size=1080,1350 \
    --screenshot="$ROOT/out/$b.png" "file:///$ROOT/html/$b.html" >/dev/null 2>&1
done

echo "captured: $(ls out/*.png | wc -l) slides → promo/out/"
