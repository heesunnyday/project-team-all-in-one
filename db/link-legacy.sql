-- 먼저 아래 값을 현재 팀 UUID로 바꾸세요. 앱의 '기존 담당자 연결' 사용도 가능합니다.
BEGIN;
SET LOCAL app.target_team_id = '현재_팀_UUID';
WITH e AS (
  UPDATE events t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = current_setting('app.target_team_id')::uuid AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id) RETURNING t.id
), d AS (
  UPDATE todos t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = current_setting('app.target_team_id')::uuid AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id) RETURNING t.id
), f AS (
  -- 과거 작성자는 자동 연결하지 않습니다. 담당자만 현재 팀원과 연결합니다.
  UPDATE feedback t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = current_setting('app.target_team_id')::uuid AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id)
  RETURNING t.id
) SELECT (SELECT count(*)::integer FROM e) AS events,
         (SELECT count(*)::integer FROM d) AS todos,
         (SELECT count(*)::integer FROM f) AS feedback;
COMMIT;
