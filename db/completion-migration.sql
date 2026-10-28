BEGIN;
-- 기존 완료 항목은 NULL로 보존합니다. 작성일·마감일로 추정하지 않습니다.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE INDEX IF NOT EXISTS todos_team_completed_idx ON todos (team_id, completed_at DESC) WHERE done;
CREATE INDEX IF NOT EXISTS feedback_team_completed_idx ON feedback (team_id, completed_at DESC) WHERE status = '완료';
-- 작성자 ID/이름/팀 표시, 상태 및 기존 행은 변경하지 않습니다.
COMMIT;
