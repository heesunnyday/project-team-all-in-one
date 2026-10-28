-- 기존 schema.sql 실행 후 한 번 실행하세요. 기존 행/이름 컬럼은 삭제하지 않습니다.
BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 50),
  name_key text NOT NULL UNIQUE CHECK (name_key = lower(btrim(name))),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON app_sessions(expires_at);

-- 서버리스 인스턴스 간에도 공유되는 인증 요청 횟수 제한입니다.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_users(id);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_users(id);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES app_users(id);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES app_users(id);
CREATE INDEX IF NOT EXISTS events_owner_idx ON events(owner_id);
CREATE INDEX IF NOT EXISTS todos_owner_idx ON todos(owner_id);
CREATE INDEX IF NOT EXISTS feedback_owner_idx ON feedback(owner_id);
CREATE INDEX IF NOT EXISTS feedback_author_idx ON feedback(author_id);

COMMIT;
