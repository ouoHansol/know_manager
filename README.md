# 방통대 필수 매니저

방통대/U-KNOU에서 필요한 학습 정보만 모아 보여주는 React 앱입니다.

## Version

- App: `1.0.0`
- Runtime: Node.js 20 이상 권장
- Frontend: React + Vite
- Sync: Playwright + dotenv
- License: MIT

## 기능

- U-KNOU 형성평가 진도 자동 수집
- 완료/미완료 자동 반영
- 필수 공지 후보 자동 수집
- 공지는 사이드 패널에 최신순 표시
- 공지 클릭 시 핵심 내용 모달과 원문 링크 제공
- 지연, 7일 이내, 미완료 항목 요약
- 유형별 필터: 수강신청, 과제, 출석, 수강
- 제목 클릭 시 원문 URL 이동
- 연필 버튼으로 항목 수정
- 브라우저 알림 요청
- JSON 내보내기

## 설치

```powershell
npm install
npx playwright install chromium
```

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 값을 채웁니다.

```env
KNOU_ID=your_knou_id
KNOU_PASSWORD=your_knou_password
KNOU_HEADLESS=true
KNOU_START_URL=https://www.knou.ac.kr/index.jsp
KNOU_UCAMPUS_URL=https://ucampus.knou.ac.kr/ekp/user/main/retrieveUIXMain.do
KNOU_EXTRA_URLS=
```

주의:

- `.env`는 git에 올리지 않습니다.
- `public/data/knou-events.json`도 git에 올리지 않습니다.
- 계정 기반 동기화는 GitHub Pages에서 실행되지 않고 로컬에서만 실행됩니다.

## 로컬 실행

```powershell
npm run sync
npm start
```

브라우저에서 표시되는 Vite 주소를 엽니다. 기본값은 보통 `http://127.0.0.1:5173/`입니다.

## 명령어

```powershell
npm start      # Vite 개발 서버
npm run sync   # 방통대/U-KNOU 로그인 후 정보 수집
npm run build  # 정적 빌드
npm run preview
npm run check  # 수집 스크립트 구문 검사 + 빌드 검증
```

## GitHub 배포

정적 앱만 배포하려면:

```powershell
npm run build
```

`dist/` 결과물을 GitHub Pages, Netlify, Vercel 등에 배포할 수 있습니다.

GitHub Pages에서 주의할 점:

- 배포된 사이트는 학교 로그인을 직접 실행하지 않습니다.
- 최신 개인 데이터는 로컬에서 `npm run sync`로 생성됩니다.
- 개인 데이터 JSON은 git 무시 대상이라 공개 저장소에 올라가지 않습니다.

## 구조

```text
src/main.jsx              React 앱
src/styles.css            화면 스타일
scripts/knou-sync.mjs     자동 로그인/정보 수집
scripts/inspect-knou.mjs  학교 화면 진단용
public/data/              동기화 결과 위치
.env.example              환경 변수 예시
```

## 라이선스

MIT License
