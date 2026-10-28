> 최신 변경: 작성자는 세션으로 자동 지정하며 수정할 수 없습니다. 과거 팀/미연결 작성자는 그대로 보존합니다. 완료 영역은 접힘/주별 조회로 바뀌었습니다. 최신 SQL·테스트·동작은 [COMPLETION_HISTORY.md](COMPLETION_HISTORY.md)를 따릅니다. 아래는 이전 기능 도입 당시 기록을 포함합니다.

> 현재 버전은 팀별 프로젝트 구조입니다. ‘팀 공통’과 My Page·알림은 현재 선택한 팀에 한정됩니다. 적용 SQL과 최신 확인 결과는 [TEAMS.md](TEAMS.md)를 확인하세요.

# My Page 진입 위치·팀 공통 업무·일정 시간

기존 디자인과 원본 항목 ID, localStorage 백업을 유지합니다. 새 패키지는 필요하지 않습니다.

## 적용 및 실행

프로젝트의 `.env`에 저장한 `DATABASE_URL`을 그대로 사용합니다. 실제 연결 문자열을 코드나 SQL에 넣지 마세요.

```sh
cd team-project-helper
npm run db:migrate
npm start
```

기존 서버는 해당 터미널에서 Control+C로 종료한 뒤 재시작합니다. http://localhost:8000 에서 로그인하세요. 이미 서버가 재시작되었다면 브라우저를 새로고침하면 됩니다.

변경 SQL은 [db/team-time-migration.sql](db/team-time-migration.sql)입니다. 기존 인증 버전 DB의 Neon SQL Editor에서는 이 파일만 실행하면 됩니다. 현재 팀별 버전의 새 DB는 `schema.sql` → `auth-migration.sql` → `team-time-migration.sql` → `teams-migration.sql` → `feedback-tasks-migration.sql` 순서입니다. `db:migrate`는 다섯 파일을 트랜잭션으로 적용하며 재실행할 수 있습니다. 기존 행을 삭제하거나 담당자 이름을 자동으로 팀으로 바꾸지 않습니다.

Vercel도 같은 DB 변경이 필요합니다. 대상 Neon Branch에 SQL을 적용하고 기존 `DATABASE_URL` 환경변수를 유지한 채 새 코드를 Redeploy하세요. 이번 작업에서 실제 Vercel 배포는 진행하지 않습니다.

## 저장 및 화면 동작

- My Page는 상단의 **사용자 이름 | My Page | 로그아웃**에서 엽니다. 별도 창을 열지 않으며 선택 상태가 표시됩니다. 원래 Calendar / To-Do List / Feedback 세 탭으로 언제든 돌아갈 수 있습니다. 모바일에서는 이름과 버튼이 필요한 만큼 줄바꿈합니다.
- 모든 담당자 및 Feedback 작성자에 **팀**을 선택할 수 있습니다. 실제 사용자 계정이나 가짜 UUID를 만들지 않습니다. DB의 `owner_is_team` / `author_is_team`이 true인 경우 해당 사용자 ID는 NULL입니다. 개인 사용자는 false와 실제 사용자 ID로 저장합니다. 기존 미연결 이름은 false와 NULL을 그대로 유지합니다.
- API는 `ownerType` / `authorType`을 `team` 또는 `user`로 반환합니다. 예: `{"ownerType":"team","ownerId":null}`, `{"authorType":"team","authorId":null}`. 팀과 사용자 ID를 동시에 보내면 거부합니다. 개인으로 바꿀 때는 `{"ownerType":"user","ownerId":"사용자-UUID"}`를 보냅니다. PATCH에서 담당자·작성자를 생략하면 기존 선택을 유지합니다.
- 팀 담당 투두·피드백은 현재 팀의 모든 팀원 My Page에 **팀 공통** 배지로 표시합니다. 같은 테이블의 같은 ID를 사용하므로 상태 변경도 원본 한 행에 저장됩니다. 작성자만 팀인 개인 담당 피드백은 그 담당자의 My Page에만 표시합니다. ‘팀’이라는 이름으로 가입한 개인 계정과 팀 공통 선택도 구분하며, 기존 이름 연결 기능은 팀 공통 항목을 개인에게 연결하지 않습니다.
- 팀 공통 투두도 개인 업무와 동일하게 정렬·D-day·경고·마감 배너를 적용합니다. 변경 성공 후 같은 화면의 전체 탭·My Page·Calendar·배너를 즉시 갱신합니다. 다른 사용자 브라우저에서는 **다시 불러오기** 또는 새로고침으로 최신 DB 상태를 확인합니다. 브라우저 간 실시간 푸시는 포함하지 않습니다.
- 일정의 선택 사항인 시간은 24시간제 **HH:mm**입니다. DB의 `events.start_time`은 `time without time zone`이며 `date`와 함께 한국 시간의 날짜·시각 그대로 저장합니다. UTC 변환을 하지 않습니다. 미입력은 NULL이고 화면에는 **종일**로 표시합니다. 기존 일정도 NULL이므로 종일을 유지합니다. 같은 날짜에서는 종일 → 시간 오름차순이며 투두는 기존 날짜 기준 마감일을 유지합니다.

## 확인 방법

```sh
npm test
npm run test:browser
npm run test:db
npm run db:check
```

`test:browser`는 설치된 Chrome의 임시 프로필과 테스트 저장소를 사용합니다. macOS 기본 설치 경로 외에는 `CHROME_PATH`를 설정하세요. `test:db`는 실제 Neon에 임시 사용자·항목을 생성하고 해당 ID의 데이터만 정리합니다. 기존 데이터는 변경하지 않으며 연결 문자열·비밀번호를 출력하지 않습니다.

1. 로그인 후 상단의 버튼 순서를 확인합니다. My Page 선택 상태, 새 창 없이 화면 전환, 세 탭 복귀를 확인합니다. 모바일 320px/375px에서 가로 넘침과 버튼 겹침이 없어야 합니다.
2. 담당자 팀으로 투두·피드백을 등록합니다. 서로 다른 사용자로 접속해 My Page의 같은 항목과 팀 공통 배지를 확인합니다. 한쪽에서 상태 변경 후 다른 쪽에서 다시 불러와 동일 상태인지 확인합니다. 전체 탭과 Calendar도 확인합니다.
3. 팀 담당자를 개인으로 바꾸면 다른 사용자 My Page에서 제외되어야 합니다. 다시 팀으로 바꾸면 모두에게 표시되어야 합니다. Feedback 작성자만 팀이고 담당자는 개인인 항목은 해당 개인에게만 표시되어야 합니다.
4. 팀 투두의 마감일을 어제·오늘·3일 뒤로 바꾸어 D-day, 기한 경고, 배너를 확인합니다. 완료하면 경고/배너에서 빠지고 완료 해제 시 복구되어야 합니다.
5. 같은 날짜에 16:30, 09:05, 시간 없음으로 일정을 등록합니다. 종일 → 09:05 → 16:30 순서와 달력/상세 시간 표시를 확인합니다. 시간 수정·시간 비우기·새로고침 후 유지도 확인합니다. 기존 일정은 종일이어야 합니다.

Neon SQL Editor에서 저장 내용을 직접 확인할 수 있습니다.

```sql
SELECT id, title, owner, owner_id, owner_is_team, date,
       to_char(date + start_time, 'HH24:MI') AS korea_time
FROM events ORDER BY date, start_time ASC NULLS FIRST, created_at, id;
SELECT id, title, owner, owner_id, owner_is_team, date, done FROM todos;
SELECT id, author, author_id, author_is_team,
       owner, owner_id, owner_is_team, status FROM feedback;
```

## 확인 결과 (2026-10-27)

- `npm test`: 34개 통과, 실패·건너뜀 0개. 개인/팀 선택 검증, 팀을 개인 이름에 연결하지 않는 규칙, 원본 필터·알림, 시간 유효성·종일/시간 정렬, 인증·CRUD를 확인했습니다.
- 실제 Chrome 시나리오 2개 모두 통과: 기존 My Page·D-day·한국 자정 갱신·저장 실패 복원 시나리오와 신규 두 사용자 연동 시나리오를 각각 확인했습니다. 신규 시나리오 최종 재검사는 실패·건너뜀 0개입니다.
- 두 사용자 브라우저에서 팀 공통 투두/피드백의 같은 ID와 상태를 확인했습니다. 개인↔팀 재배정, 작성자만 팀인 개인 피드백의 제외, 전체 탭·Calendar·My Page·배너 연동이 정상입니다.
- 일정 HH:mm 저장·재수정·종일 전환·새로고침 유지, 기존 일정의 종일 표시, 같은 날짜의 종일→시간 순 정렬을 확인했습니다.
- 모바일 375px/320px에서 가로 넘침과 사용자 이름/My Page/로그아웃의 겹침이 없습니다. 검사에서 발견한 마감 배너 링크의 여백 넘침을 수정했습니다.
- 실제 Neon 통합 검사와 세 테이블 조회가 성공했습니다. 임시 계정·항목만 정리했으며 기존 프로젝트 항목은 수정·삭제하지 않았습니다. 실제 연결 문자열·비밀번호는 출력하지 않았습니다.
- 현재 연결된 Neon에 변경 SQL을 적용했고 로컬 서버를 재시작했습니다. `http://localhost:8000/api/test`의 JSON 성공 응답도 확인했습니다. 실제 Vercel 배포 검증은 진행하지 않았습니다.
