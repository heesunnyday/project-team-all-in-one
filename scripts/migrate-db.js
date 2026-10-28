'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('../config/env').loadEnvironment();
const {migrate} = require('../db/repository');
const {neon} = require('@neondatabase/serverless');
(async () => {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const snapshots = new Map();
    // 기존 데이터와 사용자 ID/이름을 메모리에서만 비교합니다. 연결 정보·행 내용은 출력하지 않습니다.
    for (const table of ['events', 'todos', 'feedback', 'app_users', 'feedback_tasks']) {
      const [exists] = await sql.query('SELECT to_regclass($1) IS NOT NULL AS present', [table]);
      if (exists.present) {
        const columns = table === 'app_users' ? "jsonb_build_object('id', t.id, 'name', t.name)" : 'to_jsonb(t)';
        const rows = await sql.query(`SELECT ${columns} AS value FROM ${table} t ORDER BY t.id`);
        for (const row of rows) for (const key of ['team_id', 'task_id']) if (row.value[key] == null) delete row.value[key];
        snapshots.set(table, rows);
      }
    }
    const statements = ['schema.sql', 'auth-migration.sql', 'team-time-migration.sql', 'teams-migration.sql', 'feedback-tasks-migration.sql', 'completion-migration.sql'].flatMap(file => fs.readFileSync(path.join(__dirname, '..', 'db', file), 'utf8')
      .replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(sql => sql && !['BEGIN', 'COMMIT'].includes(sql)));
    await migrate(statements);
    for (const [table, before] of snapshots) {
      const columns = table === 'app_users' ? "jsonb_build_object('id', t.id, 'name', t.name)" : 'to_jsonb(t)';
      const after = await sql.query(`SELECT ${columns} AS value FROM ${table} t ORDER BY t.id`);
      const byId = new Map(after.map(row => [row.value.id, row.value]));
      if ((table !== 'feedback_tasks' && after.length !== before.length) || before.some(row => {
        const original = row.value, current = byId.get(original.id);
        if (!current) return true;
        const existingFields = Object.fromEntries(Object.keys(original).map(key => [key, current[key]]));
        return JSON.stringify(existingFields) !== JSON.stringify(original);
      })) throw new Error('Preservation check failed');
      if (table === 'feedback') {
        const ids = before.filter(row => !row.value.task_id).map(row => row.value.id);
        if (ids.length) {
          const [linked] = await sql.query("SELECT count(*)::integer AS count FROM feedback f JOIN feedback_tasks w ON w.id = f.task_id AND w.team_id = f.team_id WHERE f.id = ANY($1::uuid[]) AND w.title = '미분류'", [ids]);
          if (linked.count !== ids.length) throw new Error('Legacy task mapping check failed');
        }
      }
    }
    console.log('팀·업무·완료 시각 스키마를 적용했습니다. 완료 시각이 없는 기존 항목은 미상으로 유지했습니다.');
    console.log('기존 사용자 ID/이름과 일정·투두·피드백의 기존 필드 보존을 확인했습니다.');
  } catch {
    console.error('스키마 적용 실패: Neon 연결 및 테이블 구조를 확인해 주세요. 연결 정보는 출력하지 않았습니다.');
    process.exitCode = 1;
  }
})();
