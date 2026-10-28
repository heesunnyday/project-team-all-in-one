'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRepository} = require('./db/repository');

test('SQL은 사용자 입력을 쿼리 문자열에 삽입하지 않고 매개변수로 전달한다', async () => {
  const calls = [];
  const store = createRepository(async (sql, params) => { calls.push({sql, params}); return [{id: 'test'}]; });
  const attack = "'); DROP TABLE todos; --";
  await store.create('todos', {title: attack, owner: '담당', owner_id: 'user-id', date: '', done: false}, 'team-id');
  assert.ok(!calls[0].sql.includes(attack));
  assert.deepEqual(calls[0].params, [attack, '담당', 'user-id', false, null, false, 'team-id']);
  await store.update('todos', 'test-id', {done: true}, 'team-id');
  assert.match(calls[1].sql, /SET done = \$1, completed_at = CASE WHEN \$1 THEN CASE WHEN done THEN completed_at ELSE now\(\) END ELSE NULL END WHERE id = \$2 AND team_id = \$3/);
  assert.deepEqual(calls[1].params, [true, 'test-id', 'team-id']);
  await assert.rejects(() => store.list('todos; DROP TABLE events;'));
});
test('팀 선택과 일정 시간은 매개변수로 저장하고 종일 우선 정렬한다', async () => {
  const calls = [];
  const store = createRepository(async (sql, params) => { calls.push({sql, params}); return [{}]; });
  await store.create('events', {title: '회의', owner: '팀', owner_id: null, owner_is_team: true, date: '2026-10-27', start_time: '09:30', description: '내용'}, 'team-id');
  assert.deepEqual(calls[0].params, ['회의', '팀', null, true, '2026-10-27', '09:30', '내용', 'team-id']);
  await store.list('events');
  assert.match(calls[1].sql, /ORDER BY t.date, t.start_time ASC NULLS FIRST/);
  assert.match(calls[1].sql, /to_char\(t.date \+ t.start_time, 'HH24:MI'\)/);
  await store.linkLegacyUsers();
  assert.match(calls[2].sql, /NOT t.owner_is_team/);
  assert.doesNotMatch(calls[2].sql, /SET[\s\S]*author_id\s*=/);
});
test('투두 조회는 날짜 문자열과 마감일 없는 항목의 마지막 정렬을 사용한다', async () => {
  let sql;
  const store = createRepository(async query => { sql = query; return []; });
  await store.list('todos');
  assert.match(sql, /to_char\(t.date, 'YYYY-MM-DD'\)/);
  assert.match(sql, /NULLS LAST/);
});
test('모든 CRUD와 사용자/기존 이름 연결 SQL에 팀 조건을 사용한다', async () => {
  const calls = [];
  const store = createRepository(async (sql, params) => { calls.push({sql, params}); return [{id: 'item'}]; });
  for (const type of ['events', 'todos', 'feedback']) {
    await store.list(type, 'team-a'); assert.deepEqual(calls.at(-1).params, ['team-a']); assert.match(calls.at(-1).sql, /WHERE t.team_id = \$1/);
    await store.get(type, 'item', 'team-a'); assert.deepEqual(calls.at(-1).params, ['item', 'team-a']); assert.match(calls.at(-1).sql, /t.id = \$1 AND t.team_id = \$2/);
    await store.update(type, 'item', type === 'todos' ? {done: true} : {description: '수정'}, 'team-a'); assert.match(calls.at(-1).sql, /WHERE id = \$2 AND team_id = \$3/);
    await store.remove(type, 'item', 'team-a'); assert.deepEqual(calls.at(-1).params, ['item', 'team-a']); assert.match(calls.at(-1).sql, /AND team_id = \$2/);
  }
  await store.listUsers('team-a'); assert.match(calls.at(-1).sql, /m.team_id = \$1/);
  await store.linkLegacyUsers('team-a'); assert.deepEqual(calls.at(-1).params, ['team-a']); assert.match(calls.at(-1).sql, /WHERE t.team_id = \$1/);
});
