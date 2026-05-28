# 방통대 필수 매니저

방통대/U-KNOU에서 꼭 봐야 하는 학습 정보만 모아 보여주는 React + TypeScript 앱입니다.

## Version

- App: `1.0.0`
- Runtime: Node.js 20 이상 권장
- Frontend: React + TypeScript + Vite
- Sync: Playwright, Vercel Serverless Function
- License: MIT

## 주요 기능

- 내 상태: 이름, 학과, 수강목록 링크, 총 학점, 현재 수강과목 성적
- 필수 일정: 전체/수강/과제물/출석/시험 탭과 미완료/완료 보기
- 시험 일정: 선택한 시험 일자, 장소, 시간, 응시과목 표시
- 과제물/출석대체 제출 상태와 놓친 정보 표시
- 필수 공지: 왼쪽 사이드 영역에 최신 공지 표시, 클릭 시 핵심 요약 모달
- 상단 메모 CRUD
- 브라우저 알림 요청
- JSON 내보내기

## 설치

```powershell
npm install
npx playwright install chromium
```

## 계정 정보

Vercel 배포판에서는 `.env`에 사용자 계정을 넣지 않습니다.

앱의 `내 계정으로 동기화` 모달에서 본인의 방통대 아이디/비밀번호를 입력하면, 브라우저 localStorage에만 저장할 수 있습니다. 동기화 요청 시 계정은 `/api/sync`로 전달되어 그 요청 안에서만 로그인에 사용되고, 저장소나 Vercel 환경변수에는 저장하지 않습니다.

주의:

- 공용 PC에서는 `이 브라우저에 계정정보 저장`을 끄거나 사용 후 브라우저 데이터를 삭제하세요.
- Vercel 서버리스 함수 실행 시간 제한 때문에 방통대 사이트 응답이 느리면 동기화가 실패할 수 있습니다.
- GitHub Pages 같은 정적 호스팅만으로는 `/api/sync`가 동작하지 않습니다. 사용자별 웹 동기화는 Vercel 배포가 필요합니다.

## 로컬 실행

```powershell
npm start
```

Vite 주소는 보통 `http://127.0.0.1:5173/`입니다.

로컬에서 기존 방식으로 `.env`를 사용해 JSON을 생성할 수도 있습니다. 이 방식은 개발/백업용입니다.

```env
KNOU_ID=your_knou_id
KNOU_PASSWORD=your_knou_password
KNOU_HEADLESS=true
KNOU_START_URL=https://www.knou.ac.kr/index.jsp
KNOU_UCAMPUS_URL=https://ucampus.knou.ac.kr/ekp/user/main/retrieveUIXMain.do
KNOU_EXTRA_URLS=
```

```powershell
npm run sync
```

`.env`와 `public/data/knou-events.json`은 git에 올리지 않습니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에 연결합니다.
2. Framework Preset은 Vite로 둡니다.
3. Build Command는 `npm run build`, Output Directory는 `dist`를 사용합니다.
4. 별도 사용자 계정 환경변수는 설정하지 않습니다.

배포 후 사용자는 앱 화면에서 본인 계정으로 직접 동기화합니다.

## 명령어

```powershell
npm start      # Vite 개발 서버
npm run sync   # 로컬 .env 기반 데이터 수집
npm run build  # 정적 빌드
npm run preview
npm run check  # 수집 스크립트 문법 검사 + 타입체크 + 빌드
```

## 구조

```text
api/sync.js               Vercel 사용자별 동기화 API
src/main.tsx              React TypeScript 앱
src/styles.css            화면 스타일
scripts/knou-sync.mjs     자동 로그인/정보 수집 공용 모듈 및 CLI
public/data/              로컬 동기화 결과 위치
```

## License

MIT License
