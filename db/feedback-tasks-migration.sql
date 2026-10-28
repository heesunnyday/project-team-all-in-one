-- 기존 팀 구분 SQL 이후 실행합니다. 기존 피드백의 ID/내용/작성자/담당자/상태/작성 시각은 보존합니다.
BEGIN;
CREATE TABLE IF NOT EXISTS feedback_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  title text NOT NULL CHECK (title = btrim(title) AND length(title) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, title)
);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES feedback_tasks(id);
INSERT INTO feedback_tasks(team_id, title)
SELECT DISTINCT team_id, '미분류' FROM feedback WHERE task_id IS NULL
ON CONFLICT (team_id, title) DO NOTHING;
UPDATE feedback f SET task_id = w.id
FROM feedback_tasks w
WHERE f.task_id IS NULL AND w.team_id = f.team_id AND w.title = '미분류';
ALTER TABLE feedback ALTER COLUMN task_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_team_task_created_idx ON feedback(team_id, task_id, created_at DESC);
COMMIT;
