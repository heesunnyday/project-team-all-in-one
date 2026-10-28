-- schema.sql → auth-migration.sql → team-time-migration.sql 이후 실행합니다.
-- 기존 데이터를 지우지 않습니다. 기존 공통 데이터와 당시 사용자만 이관합니다.
BEGIN;
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  owner_id uuid NOT NULL REFERENCES app_users(id),
  invite_code text NOT NULL UNIQUE CHECK (invite_code ~ '^[A-Za-z0-9_-]{32}$'),
  is_legacy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_one_legacy_idx ON teams(is_legacy) WHERE is_legacy;
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id, team_id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id);

-- 초대 코드는 암호학적으로 생성되는 UUID에서 만듭니다. 일반 팀은 서버의 192비트 난수를 사용합니다.
-- 최초 이관 시에만 당시 사용자 모두를 가입시킵니다. 재실행 시 신규 사용자를 자동 가입시키지 않습니다.
WITH legacy AS (
  INSERT INTO teams(name, description, owner_id, invite_code, is_legacy)
  SELECT '기존 공통 프로젝트', '팀 구분 기능 도입 전의 공통 프로젝트입니다.', id,
         replace(gen_random_uuid()::text, '-', ''), true
  FROM app_users
  WHERE EXISTS (SELECT 1 FROM events WHERE team_id IS NULL)
     OR EXISTS (SELECT 1 FROM todos WHERE team_id IS NULL)
     OR EXISTS (SELECT 1 FROM feedback WHERE team_id IS NULL)
  ORDER BY created_at, id LIMIT 1
  ON CONFLICT (is_legacy) WHERE is_legacy DO NOTHING
  RETURNING id
)
INSERT INTO team_members(team_id, user_id)
SELECT legacy.id, u.id FROM legacy CROSS JOIN app_users u
ON CONFLICT DO NOTHING;

UPDATE events SET team_id = (SELECT id FROM teams WHERE is_legacy) WHERE team_id IS NULL;
UPDATE todos SET team_id = (SELECT id FROM teams WHERE is_legacy) WHERE team_id IS NULL;
UPDATE feedback SET team_id = (SELECT id FROM teams WHERE is_legacy) WHERE team_id IS NULL;
ALTER TABLE events ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE todos ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE feedback ALTER COLUMN team_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS events_team_date_idx ON events(team_id, date, start_time);
CREATE INDEX IF NOT EXISTS todos_team_date_idx ON todos(team_id, date);
CREATE INDEX IF NOT EXISTS feedback_team_created_idx ON feedback(team_id, created_at);
-- 기존 작성자/담당자 ID, 이름, 완료 상태, 일정 시각은 변경하지 않습니다.
COMMIT;
