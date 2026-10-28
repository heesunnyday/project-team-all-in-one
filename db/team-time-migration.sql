-- schema.sql, auth-migration.sql 이후 실행합니다. 기존 행/이름/사용자 ID를 보존합니다.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_is_team boolean NOT NULL DEFAULT false
  CHECK (NOT owner_is_team OR owner_id IS NULL);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS owner_is_team boolean NOT NULL DEFAULT false
  CHECK (NOT owner_is_team OR owner_id IS NULL);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS owner_is_team boolean NOT NULL DEFAULT false
  CHECK (NOT owner_is_team OR owner_id IS NULL);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS author_is_team boolean NOT NULL DEFAULT false
  CHECK (NOT author_is_team OR author_id IS NULL);
-- 한국 시간의 날짜(date)와 시각을 별도로 저장합니다. NULL은 종일이며 UTC 변환하지 않습니다.
ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time time without time zone
  CHECK (start_time IS NULL OR (EXTRACT(SECOND FROM start_time) = 0 AND start_time < TIME '24:00'));
COMMIT;
