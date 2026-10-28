'use strict';
// 실제 Neon에서 검사용 두 계정·두 팀만 만들고 해당 ID의 데이터만 정리합니다.
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {once} = require('node:events');
const {neon} = require('@neondatabase/serverless');
const {createApp} = require('../server');
const {digest} = require('../auth');
const M = require('../public/model');
(async () => {
  let server, sql, failed = false;
  const users = [], teams = [], names = [];
  try {
    sql = neon(process.env.DATABASE_URL);
    server = createApp(undefined, {secure: false}).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function request(route, method = 'GET', body) {
      const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', Cookie: cookie}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(20000)});
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    }
    assert.equal((await request('/api/teams')).status, 401);
    const password = randomBytes(24).toString('hex');
    for (let i = 0; i < 2; i++) {
      const name = `검증_${randomBytes(8).toString('hex')}`; names.push(name);
      const response = await request('/api/auth/register', 'POST', {name, password}); assert.equal(response.status, 201); users.push((await response.json()).user);
    }
    async function login(index) { const response = await request('/api/auth/login', 'POST', {name: users[index].name, password}); assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly/); }
    async function createTeam(index) {
      await login(index); assert.deepEqual(await (await request('/api/teams')).json(), []);
      const response = await request('/api/teams', 'POST', {name: `검증 팀 ${index}`, description: '검사 후 정리'}); assert.equal(response.status, 201);
      const team = await response.json(); teams.push(team); assert.equal(team.ownerId, users[index].id); assert.equal(team.isOwner, true); assert.equal(team.inviteCode.length, 32); return team;
    }
    const a = await createTeam(0);
    const taskA = (await (await request(`/api/teams/${a.id}/tasks`, 'POST', {title: '검증 업무'})).json()).task;
    const b = await createTeam(1);
    const taskB = (await (await request(`/api/teams/${b.id}/tasks`, 'POST', {title: '  검증 업무  '})).json()).task;
    assert.equal(taskB.title, '검증 업무'); assert.notEqual(taskA.id, taskB.id);
    const duplicate = await request(`/api/teams/${b.id}/tasks`, 'POST', {title: ' 검증 업무 '}); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).task.id, taskB.id);
    const concurrent = await Promise.all([1, 2].map(() => request(`/api/teams/${b.id}/tasks`, 'POST', {title: '동시 생성 업무'})));
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 201]);
    const concurrentBodies = await Promise.all(concurrent.map(response => response.json())); assert.equal(concurrentBodies[0].task.id, concurrentBodies[1].task.id);
    const samples = {
      events: {title: '시간 검증', ownerType: 'team', date: '2026-10-27', time: '16:30', description: '검사 후 정리'},
      todos: {title: '팀 B 투두', ownerType: 'team', date: '2026-10-27'},
      feedback: {taskId: taskB.id, ownerType: 'team', authorType: 'team', description: '검사 후 정리'}
    };
    const records = {};
    for (const [type, body] of Object.entries(samples)) {
      const response = await request(`/api/teams/${b.id}/${type}`, 'POST', body); assert.equal(response.status, 201); records[type] = await response.json(); assert.equal(records[type].teamId, b.id);
    }
    assert.equal((await request(`/api/teams/${b.id}/todos`, 'POST', {title: '외부 담당자', ownerId: users[0].id})).status, 400);
    await login(0);
    for (const type of Object.keys(samples)) {
      const path = `/api/teams/${b.id}/${type}`, own = `/api/teams/${a.id}/${type}`;
      for (const [route, method, body] of [[path, 'GET'], [path, 'POST', samples[type]], [`${path}/${records[type].id}`, 'GET'], [`${path}/${records[type].id}`, 'PATCH', type === 'todos' ? {done: true} : {description: '금지'}], [`${path}/${records[type].id}`, 'DELETE']]) assert.equal((await request(route, method, body)).status, 403);
      assert.equal((await request(`${own}/${records[type].id}`, 'DELETE')).status, 404);
      assert.deepEqual(await (await request(own)).json(), []);
    }
    assert.equal((await request(`/api/teams/${b.id}/users`)).status, 403);
    const spoofed = await (await request(`/api/teams/${a.id}/feedback`, 'POST', {taskId: taskA.id, ownerId: users[0].id, authorId: users[1].id, authorType: 'team', description: '작성자 위조 무시'})).json();
    assert.equal(spoofed.authorId, users[0].id); assert.equal(spoofed.authorType, 'user');
    assert.equal((await request('/api/teams/invitations/preview', 'POST', {inviteCode: 'x'.repeat(32)})).status, 404);
    const preview = await (await request('/api/teams/invitations/preview', 'POST', {inviteCode: b.inviteCode})).json(); assert.equal(preview.name, b.name); assert.equal(preview.alreadyMember, false);
    const join = {inviteCode: b.inviteCode, teamId: b.id};
    assert.deepEqual((await Promise.all([request('/api/teams/join', 'POST', join), request('/api/teams/join', 'POST', join)])).map(response => response.status).sort(), [201, 409]);
    const [membership] = await sql.query('SELECT count(*)::integer AS count FROM team_members WHERE team_id = $1 AND user_id = $2', [b.id, users[0].id]); assert.equal(membership.count, 1);
    const mine = await (await request('/api/teams')).json(); assert.equal(mine.length, 2); assert.equal(mine.find(team => team.id === b.id).inviteCode, null);
    assert.deepEqual((await (await request(`/api/teams/${a.id}/users`)).json()).map(user => user.id), [users[0].id]);
    for (const type of Object.keys(samples)) {
      assert.equal((await request(`/api/teams/${a.id}/${type}/${records[type].id}`, 'PATCH', type === 'todos' ? {done: true} : {description: '다른 팀 ID'})).status, 404);
      assert.equal((await request(`/api/teams/${a.id}/${type}`, 'POST', {...samples[type], teamId: b.id})).status, 400);
    }
    const path = `/api/teams/${b.id}`;
    assert.equal((await request(`${path}/feedback`, 'POST', {...samples.feedback, taskId: taskA.id})).status, 400);
    assert.equal((await request(`${path}/feedback?taskId=${taskA.id}`)).status, 400);
    assert.equal((await request(`${path}/feedback/${records.feedback.id}`, 'PATCH', {taskId: taskA.id})).status, 400);
    const extraFeedback = await (await request(`${path}/feedback`, 'POST', {...samples.feedback, description: '동일 업무 추가 의견'})).json();
    assert.equal(extraFeedback.taskId, records.feedback.taskId); assert.equal(records.feedback.taskTitle, taskB.title);
    assert.equal((await (await request(`${path}/feedback?taskId=${taskB.id}`)).json()).length, 2);
    const reassigned = await (await request(`${path}/feedback/${records.feedback.id}`, 'PATCH', {taskId: concurrentBodies[0].task.id})).json();
    assert.equal(reassigned.taskTitle, '동시 생성 업무'); assert.equal(reassigned.createdAt, records.feedback.createdAt);
    assert.deepEqual((await (await request(`${path}/feedback?taskId=${taskB.id}`)).json()).map(item => item.id), [extraFeedback.id]);
    await request(`${path}/todos/${records.todos.id}`, 'PATCH', {done: true}); await request(`${path}/feedback/${records.feedback.id}`, 'PATCH', {status: '완료', authorId: users[0].id});
    assert.equal((await (await request(`${path}/events/${records.events.id}`, 'PATCH', {time: '09:05'})).json()).time, '09:05');
    const all = await (await request(`${path}/events`, 'POST', {...samples.events, time: ''})).json();
    const early = await (await request(`${path}/events`, 'POST', {...samples.events, time: '00:00'})).json();
    assert.deepEqual((await (await request(`${path}/events`)).json()).map(item => item.id), [all.id, early.id, records.events.id]);
    const [stored] = await sql.query('SELECT owner_is_team, owner_id, start_time FROM events WHERE id = $1', [early.id]); assert.equal(stored.owner_is_team, true); assert.equal(stored.owner_id, null); assert.equal(stored.start_time, '00:00:00');
    const data = M.empty(); data.todos = await (await request(`${path}/todos`)).json(); data.feedback = await (await request(`${path}/feedback`)).json();
    for (const user of users) assert.equal(M.myTasks(data, user.id, b.id).todos[0].done, true);
    await login(1);
    assert.equal((await (await request(`${path}/todos/${records.todos.id}`)).json()).done, true);
    assert.equal((await (await request(`${path}/feedback/${records.feedback.id}`)).json()).authorId, users[1].id);
    assert.equal((await request(`/api/teams/${a.id}/todos`)).status, 403);
    const ordered = [];
    for (const [title, date, done] of [['날짜 있는 미완료', '2026-10-30', false], ['날짜 없는 미완료', '', false], ['이른 완료', '2026-10-01', true]]) ordered.push(await (await request(`${path}/todos`, 'POST', {title, date, done, ownerType: 'team'})).json());
    const todoIds = async () => (await (await request(`${path}/todos`)).json()).map(item => item.id);
    assert.deepEqual(await todoIds(), [ordered[0].id, ordered[1].id, ordered[2].id, records.todos.id]);
    await request(`${path}/todos/${ordered[2].id}`, 'PATCH', {done: false});
    assert.deepEqual(await todoIds(), [ordered[2].id, ordered[0].id, ordered[1].id, records.todos.id]);
    await request(`${path}/todos/${ordered[0].id}`, 'PATCH', {done: true});
    assert.deepEqual(await todoIds(), [ordered[2].id, ordered[1].id, records.todos.id, ordered[0].id]);
    // 실제 DB 전환과 서버 시각을 검증합니다. 검사용 ID에만 직접 SQL을 적용합니다.
    for (const type of ['todos', 'feedback']) {
      const id = records[type].id, route = `${path}/${type}/${id}`;
      const state = done => type === 'todos' ? {done} : {status: done ? '완료' : '작업 중'};
      const content = type === 'todos' ? {title: '내용만 수정'} : {description: '내용만 수정', authorId: users[0].id, authorType: 'team'};
      const first = await (await request(route)).json(); assert.ok(first.completedAt);
      const [storedTime] = await sql.query(`SELECT completed_at IS NOT NULL AS present FROM ${type} WHERE id = $1`, [id]); assert.equal(storedTime.present, true);
      const repeated = await Promise.all([1, 2].map(() => request(route, 'PATCH', state(true))));
      for (const response of repeated) assert.equal((await response.json()).completedAt, first.completedAt);
      const edited = await (await request(route, 'PATCH', content)).json(); assert.equal(edited.completedAt, first.completedAt);
      if (type === 'feedback') assert.equal(edited.authorId, users[1].id);
      assert.equal((await request(route, 'PATCH', {completedAt: '2000-01-01T00:00:00Z'})).status, 400);
      const undone = await (await request(route, 'PATCH', state(false))).json(); assert.equal(undone.completedAt, null);
      const again = await (await request(route, 'PATCH', state(true))).json(); assert.ok(Date.parse(again.completedAt) > Date.parse(first.completedAt));
      await sql.query(`UPDATE ${type} SET completed_at = NULL WHERE id = $1 AND team_id = $2`, [id, b.id]);
      const unknown = await (await request(route, 'PATCH', {...state(true), ...content})).json(); assert.equal(unknown.completedAt, null);
      assert.deepEqual(M.completedInPeriod([unknown], 'unknown').map(item => item.id), [id]);
      if (type === 'feedback') {
        for (const isTeam of [true, false]) {
          await sql.query('UPDATE feedback SET author = $1, author_id = NULL, author_is_team = $2 WHERE id = $3 AND team_id = $4', [isTeam ? '팀' : users[0].name, isTeam, id, b.id]);
          const legacy = await (await request(route, 'PATCH', content)).json(); assert.equal(legacy.authorId, null); assert.equal(legacy.authorType, isTeam ? 'team' : 'user');
          await request(`${path}/users/link-legacy`, 'POST', {});
          assert.equal((await (await request(route)).json()).authorId, null);
        }
      }
    }
    const response = await request(`${path}/todos/${records.todos.id}`, 'DELETE'); assert.equal(response.status, 204); assert.equal((await request(`${path}/todos/${records.todos.id}`)).status, 404);
    assert.equal((await request('/api/auth/logout', 'POST', {})).status, 204); assert.equal((await request('/api/teams')).status, 401);
    console.log('Neon 검증 성공: 세션 작성자/위조 차단/과거 작성자 보존·완료 시각/동시 중복 요청/내용 수정/취소/재완료/미상 보존· 두 계정·두 팀 격리/권한·업무 생성/중복/동시 생성·피드백 ID 연결/필터/재지정·투두 완료 정렬·기존 상태/시간 연동');
  } catch {
    failed = true; console.error('Neon 팀 통합 검사 실패. 연결 문자열·비밀번호·초대 코드는 출력하지 않았습니다.');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (sql) try {
      for (const team of teams) {
        for (const table of ['events', 'todos', 'feedback', 'feedback_tasks']) await sql.query(`DELETE FROM ${table} WHERE team_id = $1`, [team.id]);
        await sql.query('DELETE FROM teams WHERE id = $1', [team.id]);
      }
      for (const user of users) await sql.query('DELETE FROM app_users WHERE id = $1', [user.id]);
      for (const name of names) await sql.query('DELETE FROM auth_rate_limits WHERE key = $1', [digest(`login-name:${name.toLowerCase()}`)]);
      console.log('검사용 두 계정·두 팀과 해당 항목만 정리했습니다. 기존 프로젝트 데이터는 변경하지 않았습니다.');
    } catch { failed = true; console.error('검사 데이터 정리 실패. 자동 생성한 검증_ 계정 및 검증 팀을 확인해 주세요.'); }
    if (failed) process.exitCode = 1;
  }
})();
