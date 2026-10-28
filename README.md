# Project Team, All In ONE

팀별 일정, 할 일, 업무별 피드백을 함께 관리하는 한국어 웹 앱입니다. HTML/CSS/JavaScript 화면과 Node.js/Express API, Neon PostgreSQL을 사용하며 PC·모바일에서 사용할 수 있습니다.

- 이름/비밀번호 회원가입·로그인, 서버 검증, HttpOnly 세션 쿠키와 안전한 비밀번호 해시.
- 여러 팀 생성·초대 코드 가입·전환. 모든 프로젝트 API에서 팀 소속과 항목의 팀 ID를 확인합니다.
- **Calendar:** 이전 달/이번 달/다음 달, 일정 CRUD, 선택적 한국 시간 `HH:mm`, 종일 우선 정렬, 투두 마감일·완료 상태 연동.
- **To-Do List:** 담당자/팀 공통 업무, 완료·취소, 마감일 정렬, 한국 날짜 기준 D-day와 마감 경고.
- **Feedback:** 업무 ID로 분류·필터, 등록·수정·삭제·상태 변경. 작성자는 서버 세션으로 고정하고 수정 시 원래 작성자를 유지합니다.
- **My Page:** 현재 팀의 내 담당 업무와 팀 공통 업무, 전체 탭과 같은 원본 데이터·상태 사용, 앱 내 마감 알림.
- **완료 이력:** 기본 접힘, 이번 주/지난주/이전 주/완료일 미상 조회. 완료 시각은 DB에서 기록하고 한국 시간 월~일로 분류합니다.
- 필수값 공백 검증, 삭제 확인, 기존 localStorage 원본 보존 및 JSON 백업.

## 로컬 실행

**Node.js 24.x**와 npm이 필요합니다. 이 저장소는 앱 프로젝트만 포함하며 `package.json`과 `server.js`가 저장소 루트에 있습니다.

```sh
npm ci
cp -n .env.example .env
```

복사한 `.env`에 Neon의 실제 연결 문자열을 입력합니다. 예시 파일은 수정하지 않습니다. 사용할 DB에 아래 SQL을 적용한 다음 실행합니다.

```sh
npm run db:migrate
npm run db:check
npm start
```

http://localhost:8000 에 접속합니다. 종료는 `Control+C`, 자동 재시작은 `npm run dev`입니다. 환경변수를 바꿨다면 서버를 종료하고 다시 실행합니다. 포트를 바꾸려면 `.env`의 `PORT`를 변경하세요. 프론트엔드와 API를 같은 Express 서버에서 제공하므로 HTML 파일을 직접 열거나 별도의 정적 서버로 실행하지 않습니다.

## 환경변수

| 이름 | 필수 여부 | 설정 |
| --- | --- | --- |
| `DATABASE_URL` | 로컬·Vercel 필수 | Neon Connect에서 복사한 PostgreSQL 연결 문자열. 서버에서만 사용 |
| `PORT` | 로컬 선택 | 기본 `8000`. Vercel에는 등록하지 않음 |

`.env.example`의 다음 값은 형식 예시입니다.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
PORT=8000
```

`config/env.js`가 프로젝트 루트 `.env`를 읽습니다. 이미 프로세스에 설정된 환경변수가 우선하며 Vercel에서는 프로젝트 환경변수를 사용합니다. 로컬에 예전에 export한 값이 있다면 `unset DATABASE_URL` 후 서버를 재시작해 `.env` 값을 사용하세요.

이 앱은 임의의 세션 토큰을 발급하고 DB에는 토큰의 SHA-256 해시만 저장합니다. `SESSION_SECRET`이나 프론트엔드용 DB 환경변수는 필요하지 않습니다. `VERCEL`과 `NODE_ENV`는 Vercel의 자동 설정을 사용합니다.

## Neon 데이터베이스 설정

1. Neon에서 사용할 프로젝트·Branch·Database·Role을 선택합니다.
2. **Connect**에서 연결 문자열을 복사해 로컬 `.env`의 `DATABASE_URL`에만 저장합니다. Neon이 제공한 SSL 옵션을 유지합니다.
3. 프로젝트 폴더에서 `npm run db:migrate`를 실행합니다. 같은 DB의 Neon SQL Editor에서 아래 SQL을 순서대로 실행해도 됩니다.
4. `npm run db:check`로 연결과 일정·투두·피드백 테이블 조회를 확인합니다. 연결 문자열·비밀번호는 출력하지 않습니다.

| 순서 | SQL | 용도 |
| --- | --- | --- |
| 1 | [db/schema.sql](db/schema.sql) | 일정·투두·피드백 기본 테이블 |
| 2 | [db/auth-migration.sql](db/auth-migration.sql) | 사용자·세션·인증 요청 제한·사용자 ID 연결 |
| 3 | [db/team-time-migration.sql](db/team-time-migration.sql) | 팀 공통 선택·일정 시간 |
| 4 | [db/teams-migration.sql](db/teams-migration.sql) | 팀·팀원·팀별 데이터 연결 |
| 5 | [db/feedback-tasks-migration.sql](db/feedback-tasks-migration.sql) | 업무 목록·피드백의 업무 ID |
| 6 | [db/completion-migration.sql](db/completion-migration.sql) | 투두·피드백 완료 시각 |

SQL은 기존 행을 삭제하거나 초기화하지 않습니다. 최초 팀 구분 이관은 기존 공통 데이터를 **기존 공통 프로젝트**로 옮기고 당시 사용자들을 가입시킵니다. 기존 피드백의 업무가 없으면 같은 팀의 **미분류** 업무로 연결합니다. 완료 시각이 없던 기존 완료 항목은 **완료일 미상**으로 유지합니다. 과거 팀/미연결 작성자는 임의 사용자에게 연결하지 않습니다.

이미 최신 스키마가 적용된 같은 Neon DB를 Vercel에서 사용하면 데이터를 다시 옮길 필요가 없습니다. 배포 빌드나 서버 시작에서 마이그레이션을 자동 실행하지 않습니다.

주요 테이블은 `app_users`, `app_sessions`, `auth_rate_limits`, `teams`, `team_members`, `events`, `todos`, `feedback_tasks`, `feedback`입니다. 담당자와 업무는 고유 ID로 연결하며 팀 공통 담당자는 별도 계정 없이 구분합니다.

## Vercel 배포 설정

Vercel에서 **Add New → Project → Import Git Repository**로 이 저장소를 선택합니다.

| 항목 | 선택할 값 |
| --- | --- |
| Project Name | `project-team-all-in-one` |
| Framework Preset | **Express** (`vercel.json`에도 지정) |
| Root Directory | **저장소 루트 `./`**. 앱 폴더를 한 겹 더 지정하지 않음 |
| Node.js Version | **24.x** (`package.json`에 고정) |
| Install Command | **`npm ci`** (`vercel.json`에 지정) |
| Build Command | 기본값 유지, 별도 명령 없음 |
| Output Directory | 기본값 유지, 별도 지정 없음 |
| Production Branch | `main` |

`server.js`가 Express 앱을 CommonJS로 export합니다. Vercel은 이를 서버 함수로 실행하고 `public/` 파일은 CDN에서 제공합니다. `public`을 Output Directory로 지정해 정적 사이트로만 배포하지 마세요. `npm start`는 로컬 서버 실행 명령이며 Build Command로 지정하지 않습니다. 기존 함수 설정은 최대 30초입니다.

**Environment Variables**에 `DATABASE_URL`을 등록합니다.

- **Production:** 실제 운영할 Neon DB의 연결 문자열.
- **Preview:** 미리보기 배포에도 DB 기능이 필요하면 별도로 등록합니다. 운영 데이터와 분리하려면 별도 Neon Branch에 같은 SQL을 적용해 해당 연결 문자열을 사용합니다.
- **Development:** `vercel dev` 등을 사용할 때만 추가합니다. 일반 `npm start`는 로컬 `.env`를 사용합니다.

환경변수 변경 후 **Redeploy**해야 새 배포에 적용됩니다. 실제 값은 Vercel의 서버 환경변수 입력란에만 넣고 GitHub·프론트엔드·빌드 명령에 넣지 않습니다. `PORT`, `SESSION_SECRET`, `VITE_DATABASE_URL`, `NEXT_PUBLIC_DATABASE_URL`은 등록할 필요가 없습니다.

설정 근거: [Vercel Express 공식 안내](https://vercel.com/docs/frameworks/backend/express), [지원 Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [vercel.json 설정](https://vercel.com/docs/project-configuration/vercel-json).

## GitHub 업로드와 비밀 정보 제외

`.gitignore`와 `.vercelignore`에 실제 `.env`와 환경별 파일, 백업, 로그, 인증 파일 등을 제외했습니다. `.env.example`은 예시만 포함합니다. `node_modules`는 GitHub에 포함하지 않고 잠금 파일로 설치합니다. 사용자 비밀번호 해시·세션·프로젝트의 실제 데이터는 Neon에 있으며 저장소에 덤프하지 않습니다. 테스트의 더미 비밀번호·가상 DB URL은 실제 인증 정보가 아닙니다.

업로드 전 Git에 준비한 실제 내용을 다음 명령으로 점검할 수 있습니다.

```sh
git add .
npm run check:release
```

검사 스크립트는 인덱스의 파일 경로·내용과 로컬 `.env`의 비밀값을 메모리에서 비교하며 값 자체는 출력하지 않습니다. 실제 DB URL, 비밀번호·세션·토큰 형식, 제외 대상 파일이 포함되면 실패합니다. 실제 `.env`는 로컬에 그대로 유지합니다.

## 통신·기능 확인

```sh
npm test
npm run test:browser
npm run test:dom
npm run db:check
```

`test:browser`는 설치된 Chrome을 사용합니다. 다른 위치라면 `CHROME_PATH`를 지정할 수 있습니다. `npm run test:db`는 실제 Neon에서 임시 계정 2개·팀 2개로 검사하고 생성한 데이터만 정리합니다.

배포 후 아래를 확인하세요.

1. 배포 URL의 `/api/test`에서 JSON 성공 응답을 확인합니다. 이 경로는 Express 통신만 확인합니다.
2. 회원가입·로그인 → 팀 선택 → 화면 하단 **연결 테스트**에서 실제 DB 연결을 확인합니다. 로그인 없이 `/api/teams` 등 프로젝트 API를 호출하면 401이어야 합니다.
3. 일정 등록·시간 수정, 투두 마감일과 Calendar 표시, 완료·취소와 My Page/알림 갱신을 확인합니다.
4. Feedback 업무 생성·선택·필터, 작성자 자동 지정과 원래 작성자 유지, 상태 변경을 확인합니다.
5. 접힌 완료 영역을 펼쳐 한국 시간 월~일 범위, 전체/주별 건수, 지난주·이전 주·완료일 미상 조회를 확인합니다.
6. 새로고침 후 로그인·DB 데이터가 유지되는지, 다른 팀의 데이터에 접근할 수 없는지 확인합니다.

다른 브라우저의 변경 사항은 **다시 불러오기**로 가져옵니다. 날짜가 바뀌면 D-day·알림·주별 조회 범위는 페이지에서도 자동 갱신합니다.

## 기존 브라우저 데이터 백업

이전에 사용한 **같은 브라우저·같은 주소와 포트**에서 **기존 데이터 JSON 백업** 버튼을 누르면 `moa-team-project-v1` 원본을 내보냅니다. 앱은 이 localStorage 키를 자동으로 삭제하거나 DB에 업로드하지 않습니다. Vercel 주소에서는 로컬 주소의 저장소를 읽을 수 없으므로 로컬 주소에서 먼저 백업하세요. 백업 파일은 GitHub에 올리지 않습니다.

## 파일 구성과 상세 안내

- `public/`: 한국어 화면·스타일·공유 모델.
- `server.js`, `api-router.js`, `auth.js`: 서버·팀별 API·인증.
- `db/`: Neon 저장소 코드·스키마·이관 SQL.
- `config/`, `scripts/`: 환경변수 로딩·DB 점검·업로드 점검.
- `*.test.js`, `test-support/`: API·모델·브라우저 회귀 검사.
- [완료 이력·작성자 처리](COMPLETION_HISTORY.md), [팀 이관](TEAMS.md), [업무별 피드백](FEEDBACK_TASKS.md), [My Page·D-day](MY_PAGE.md), [일정 시간](TEAM_TIME.md), [인증](AUTH.md).
