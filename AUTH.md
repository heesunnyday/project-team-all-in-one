> 최신 변경: 작성자는 세션으로 자동 지정하며 수정할 수 없습니다. 과거 팀/미연결 작성자는 그대로 보존합니다. 완료 영역은 접힘/주별 조회로 바뀌었습니다. 최신 SQL·테스트·동작은 [COMPLETION_HISTORY.md](COMPLETION_HISTORY.md)를 따릅니다. 아래는 이전 기능 도입 당시 기록을 포함합니다.

> 팀 구분 버전의 데이터 이관·팀별 API는 [TEAMS.md](TEAMS.md)를 우선 확인하세요. 인증은 유지되며 데이터 API에는 팀 소속 확인이 추가되었습니다.

# 회원가입·로그인과 사용자 담당자 연결

이름을 로그인 아이디와 프로필 표시 이름으로 사용하는 공통 프로젝트입니다. 가입한 팀원은 모든 항목을 조회·수정·삭제·완료 처리할 수 있습니다. 담당자는 업무 구분이며 접근 권한을 제한하지 않습니다.

## 로컬 설정

기존 `DATABASE_URL` 설정을 그대로 사용합니다. `.env`는 서버만 읽고 Git/Vercel 업로드에서 제외합니다. 추가 인증 비밀키는 필요하지 않습니다. 무작위 세션 토큰의 SHA-256 해시를 DB에 저장해 검증합니다.

```sh
npm install
npm run db:migrate
npm start
```

`db:migrate`는 `db/schema.sql` → `db/auth-migration.sql` → `db/team-time-migration.sql` → `db/teams-migration.sql` → `db/feedback-tasks-migration.sql`을 하나의 트랜잭션으로 적용합니다. 기존 행과 담당자/작성자 이름 컬럼을 삭제하지 않습니다. 이미 적용했다면 다시 실행해도 됩니다. Neon SQL Editor를 사용한다면 새 DB는 다섯 파일을 위 순서로 실행하고, 기존 팀 구분 버전은 `db/feedback-tasks-migration.sql`을 추가 실행하세요. 앱 실행 중에 자동으로 스키마를 변경하지 않습니다.

기존 서버가 실행 중이면 `Control+C` 후 `npm start`로 재시작합니다. http://127.0.0.1:8000 에서 회원가입한 뒤 로그인합니다. 기존 브라우저 백업을 위해 예전에 사용하던 주소를 유지하세요.

## 사용 및 데이터 규칙

- **이름:** 앞뒤 공백을 제거한 1~50자입니다. 영문 대소문자를 구분하지 않고 중복 가입을 차단합니다. 내부 사용자 ID는 UUID이며 이름 변경/프로필 사진 기능은 포함하지 않았습니다.
- **비밀번호:** 8~128자로 입력합니다. 양끝 공백도 비밀번호의 일부이며, 공백만 있는 값은 거부합니다. 사용자별 무작위 salt와 Node.js `scrypt`(N=131072, r=8, p=1)로 해시합니다. 원문은 저장하거나 응답에 반환하지 않습니다.
- **회원가입:** 등록 후 로그인 화면으로 돌아갑니다. 회원가입 실패/중복이면 안내를 표시합니다.
- **로그인:** 서버가 비밀번호를 검증하고 7일 유효한 세션을 만듭니다. 새로고침·서버 재시작 이후에도 동일한 쿠키와 DB로 로그인 상태를 확인합니다. 만료 후에는 다시 로그인합니다.
- **로그아웃:** DB의 현재 세션을 삭제하고 쿠키를 만료합니다. 예전 쿠키를 다시 보내도 접근할 수 없습니다. 다른 기기의 세션은 유지됩니다.
- **쿠키:** `HttpOnly`, `SameSite=Lax`, `Path=/`를 설정합니다. Vercel/production에서는 `Secure`도 설정합니다. 로컬 HTTP에서는 Secure를 사용하지 않습니다. 로그인 토큰과 비밀번호를 localStorage에 저장하지 않습니다.
- **서버 검증:** 프로젝트 CRUD, 사용자 목록, 기존 이름 연결, DB 상태 API는 모두 로그인 필요입니다. 쿠키가 없거나 만료·변조된 경우 401입니다. 로그인하지 않은 화면에는 프로젝트 내용이 표시되지 않습니다.
- **요청 보호:** 변경 요청은 JSON만 받으며 다른 Origin 또는 cross-site 브라우저 요청은 거부합니다. 인증 요청 횟수는 Neon 테이블에서 제한해 여러 Vercel 인스턴스에서도 공유합니다. 제한에 걸리면 15분 후 재시도합니다.
- **담당자:** 편집창을 열 때 가입 사용자 목록을 다시 조회하고 이름을 드롭다운으로 보여줍니다. 요청은 `ownerId`, DB 저장은 `owner_id` 외래키입니다. 목록에는 이름을 표시합니다. 존재하지 않는 ID나 자유 입력 이름은 거부합니다.
- **Feedback 작성자:** 등록 시 현재 사용자를 기본 선택하며 가입한 다른 사용자로 바꿀 수 있습니다. 편집창에는 저장된 작성자가 선택됩니다. API는 authorId를 사용자 외래키로 검증합니다. 작성자 변경 없이 내용만 수정하면 기존 작성자를 보존합니다. 자세한 동작은 [MY_PAGE.md](MY_PAGE.md)를 확인하세요.

## 기존 데이터 연결

기존 `owner`/`author` 텍스트는 보존하고 `owner_id`/`author_id`를 추가했습니다. 아직 연결되지 않은 행은 **기존 이름 · 미연결**로 표시합니다. 기존 행은 사용자 연결 없이도 내용·날짜·완료 상태를 수정할 수 있습니다. 신규 항목은 가입한 담당자를 선택해야 합니다.

1. 기존 담당자/작성자와 같은 이름으로 회원가입합니다.
2. 로그인 후 **기존 담당자 연결**을 누르고 확인합니다.
3. 앞뒤 공백을 제거하고 영문 대소문자를 무시해 일치하는 사용자에게만 ID를 연결합니다. 이미 연결된 ID와 이름 원본은 덮어쓰지 않습니다. 반복 실행해도 추가 일치 항목만 연결합니다.
4. 일치하지 않는 담당자는 항목 편집창의 드롭다운에서 직접 선택하고 저장합니다. 이전 담당자 텍스트 대신 선택한 사용자의 이름/ID로 저장됩니다. 담당자를 선택하지 않고 다른 필드만 수정하면 기존 이름이 유지됩니다.
5. 미연결 Feedback 작성자를 보존하려면 같은 이름으로 가입한 뒤 연결 버튼을 사용합니다. 편집창에서 가입한 작성자를 선택해 연결할 수도 있습니다.

Neon SQL Editor에서 `db/link-legacy.sql`을 실행해도 같은 연결을 할 수 있습니다. localStorage JSON 백업 기능과 원본 보존은 유지했습니다. 브라우저의 오래된 localStorage 내용은 자동 업로드하지 않습니다.

## 테이블

| 테이블 | 내용 |
| --- | --- |
| app_users | UUID, name, 중복 방지 name_key, password_hash, created_at |
| app_sessions | token_hash, user_id, expires_at, created_at |
| auth_rate_limits | 인증 요청별 해시 키, 15분 창과 요청 횟수 |
| events / todos / feedback | 기존 컬럼 + nullable owner_id |
| feedback | 추가 nullable author_id |

새 항목은 API에서 사용자 ID를 필수 검증합니다. 기존 행 보존 때문에 DB의 신규 외래키 컬럼은 nullable입니다. DB는 팀별로 구분합니다. 각 항목의 NOT NULL `team_id`와 소속을 검증하며, 같은 팀 안에서는 담당자와 관계없이 팀원이 항목을 수정할 수 있습니다.

## API

| 요청 | 동작 |
| --- | --- |
| POST /api/auth/register | `{name,password}`로 가입, 201 `{user:{id,name}}` |
| POST /api/auth/login | `{name,password}` 검증 후 세션 쿠키 및 `{user:{id,name}}` |
| GET /api/auth/me | 현재 로그인 사용자, 미로그인 시 401 |
| POST /api/auth/logout | 현재 세션 폐기, JSON `{}` 본문, 204 |
| GET /api/teams/:teamId/users | 로그인 사용자만 `{id,name}` 배열 조회 |
| POST /api/teams/:teamId/users/link-legacy | 로그인 사용자만 기존 이름 연결, JSON `{}`, 종류별 연결 행 수 반환 |

프로젝트 API는 `/api/teams/:teamId/events`, `/api/teams/:teamId/todos`, `/api/teams/:teamId/feedback`으로 변경되었습니다. 이전 전역 경로는 로그인 후에도 404입니다. 팀에 가입한 뒤 사용하는 등록 예시:

```json
{"title":"팀 회의","ownerId":"가입한-사용자의-UUID","date":"2026-10-27","description":"역할 분담"}
```

```json
{"title":"발표 준비","ownerId":"가입한-사용자의-UUID","date":"2026-10-28"}
```

```json
{"taskId":"업무-UUID","ownerId":"가입한-사용자의-UUID","description":"표지를 수정해 주세요."}
```

투두 완료 변경은 기존처럼 `PATCH /api/teams/:teamId/todos/{id}`에 `{"done":true}`를 보냅니다. 피드백 상태는 `{"status":"작업 중"}`입니다. 로그인 쿠키를 함께 보내야 하며 프론트엔드의 fetch는 `credentials: 'same-origin'`을 사용합니다.

## 기능 테스트

1. 새 이름으로 가입 → DB `app_users`에 사용자와 `scrypt$...` 해시 저장 확인. 이름만 앞뒤 공백/영문 대소문자를 바꿔 중복 가입하면 409인지 확인합니다. 테스트 비밀번호나 해시를 화면/로그에 노출하지 마세요.
2. 잘못된 비밀번호는 로그인 실패, 올바른 비밀번호는 프로필 이름·로그아웃 버튼이 표시되는지 확인합니다.
3. 새로고침과 서버 재시작 후에도 로그인 유지 확인. 개발자 도구 Application → Cookies에서 HttpOnly, SameSite, Vercel HTTPS에서는 Secure 속성 확인. 쿠키 원문은 공유하지 마세요.
4. 다른 브라우저/시크릿 창에서 미로그인 상태로 `/api/events`, `/api/todos`, `/api/feedback`, `/api/users`를 열면 401이어야 합니다. POST/PATCH/DELETE도 서버에서 막히는지 확인합니다. `/api/test`만 공개 통신 테스트입니다.
5. 팀원 두 명이 같은 팀에 가입한 뒤 각 편집창의 담당자 드롭다운에 이름이 나타나는지 확인합니다. 다른 팀원에게 배정하고 DB의 `owner_id`가 해당 사용자 UUID인지 확인합니다.
6. Feedback의 작성자 기본값은 로그인 사용자이며 같은 팀의 다른 사용자 또는 팀을 선택할 수 있는지 확인합니다. 내용만 수정하면 원래 `author_id`가 유지되고, 작성자를 선택해 변경하면 해당 ID로 저장되어야 합니다.
7. 투두 등록·담당자/마감일 변경·완료/해제·삭제를 하고 캘린더도 반영되는지 확인합니다. 다른 팀원도 해당 항목을 수정·완료할 수 있어야 합니다.
8. 기존 미연결 항목을 불러오고 내용만 수정해 원래 이름과 행이 유지되는지 확인합니다. 같은 이름의 사용자가 같은 팀에 가입한 후 기존 담당자 연결을 실행해 ID가 채워지는지 확인합니다. 일치하지 않는 이름은 그대로 남아야 합니다.
9. 로그아웃 후 프로젝트 내용이 숨겨지고 `/api/auth/me`가 401인지 확인합니다. 로그아웃 전 쿠키를 재사용해도 실패해야 합니다.
10. 모바일 폭 375px에서 로그인·탭·드롭다운·상태 선택·로그아웃을 확인합니다.

자동 테스트:

```sh
npm test
npm run db:check
```

자동 테스트에는 Node.js 22 이상을 사용하세요. 기본 테스트는 저장소 대역과 실제 로컬 HTTP를 사용하며 `npm run test:browser`로 실제 Chrome 화면 이벤트를 검사합니다. jsdom 검사는 `npm run test:dom`으로 별도 실행할 수 있습니다. 비밀번호 해시·세션·쿠키·미로그인 차단·잘못된 작성자 ID·다른 팀원 수정·기존 이름 연결·투두 캘린더 연동을 검사하며 실제 Neon 데이터를 변경하지 않습니다. `db:check`는 실제 DB의 세 테이블을 읽기 전용으로 조회합니다. 실제 GUI 브라우저 표시와 Vercel 배포는 위 수동 절차로 확인하세요.

`npm run test:db`는 실제 Neon에서 고유한 임시 계정/항목을 만들어 인증과 CRUD를 검사하고, 생성한 데이터만 정리합니다. 연결 정보와 테스트 비밀번호는 출력하지 않습니다. 일반 자동 테스트와 달리 DB 쓰기가 발생하므로 테스트용 Neon Branch에서 실행하는 것을 권장합니다.

## Vercel

기존 Express `server.js` export와 `public/` 구조를 유지합니다. Vercel Node.js 버전은 24.x를 권장합니다. Vercel 프로젝트 Root Directory는 `team-project-helper`입니다. 서버 환경변수 `DATABASE_URL`을 등록하고, 대상 DB에 마이그레이션을 적용한 뒤 Redeploy합니다. `.env`를 업로드하지 않습니다. 추가 세션 비밀키나 메모리 세션 저장소를 사용하지 않습니다.

`VERCEL` 환경에서는 Secure Cookie를 발급하므로 Vercel의 HTTPS 주소에서 사용하세요. 프론트엔드/API를 같은 배포 주소로 사용합니다. 세션은 Neon에 저장되므로 서버리스 인스턴스가 바뀌어도 유지됩니다. Preview가 다른 Neon Branch를 사용한다면 그 Branch에도 SQL을 적용해야 합니다. 서로 다른 배포 도메인끼리는 쿠키가 공유되지 않습니다.

이름만으로 가입하는 열린 회원가입 구조이므로 가입한 사용자는 모두 공통 프로젝트에 접근합니다. 초대/관리자 승인/비밀번호 재설정 기능은 이번 범위에 포함하지 않았습니다.

구현 참고: [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
