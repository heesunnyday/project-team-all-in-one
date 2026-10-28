'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {start, memoryStore, signInFixture} = require('./test-support/memory-store');
const M = require('./public/model');

test('로그인한 팀원의 CRUD와 캘린더/완료 상태 연동', async t => {
  const {request, store} = await start(t);
  const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const samples = {
    events: {title: '회의', ownerId: user.id, date: '2026-10-27', description: '역할 분담'},
    todos: {title: '초안', ownerId: user.id, date: '2026-10-27'},
    feedback: {taskId: store.fixtureTask.id, ownerId: user.id, description: '수정 의견'}
  };
  for (const [type, sample] of Object.entries(samples)) {
    await t.test(type, async () => {
      const created = await project(`/api/${type}`, 'POST', sample);
      assert.equal(created.status, 201);
      const item = await created.json();
      assert.equal(item.ownerId, user.id); assert.equal(item.owner, user.name);
      if (type === 'feedback') { assert.equal(item.authorId, user.id); assert.equal(item.author, user.name); }
      const route = `/api/${type}/${item.id}`;
      assert.deepEqual(await (await project(route)).json(), item);
      const changes = type === 'events' ? {title: '수정 회의', date: '2026-10-28'} : type === 'todos' ? {title: '최종안', date: '2026-10-28', done: true} : {description: '수정됨', status: '작업 중'};
      const changed = await project(route, 'PATCH', changes);
      assert.equal(changed.status, 200);
      const updated = await changed.json();
      for (const [key, value] of Object.entries(changes)) assert.equal(updated[key], value);
      if (type === 'todos') {
        const data = M.empty(); data.todos = await (await project('/api/todos')).json();
        assert.equal(M.itemsForDate(data, '2026-10-27').length, 0);
        assert.equal(M.itemsForDate(data, '2026-10-28')[0].done, true);
        assert.equal((await (await project(route, 'PATCH', {done: false})).json()).done, false);
        assert.equal((await (await project(route, 'PATCH', {date: ''})).json()).date, '');
      }
      if (type === 'feedback') for (const status of M.statuses) assert.equal((await (await project(route, 'PATCH', {status})).json()).status, status);
      assert.equal((await project(route, 'DELETE')).status, 204);
      assert.equal((await project(route)).status, 404);
      assert.deepEqual(await (await project(`/api/${type}`)).json(), []);
    });
  }
});
test('담당자·필수값·날짜·상태를 검증하고 요청의 작성자 ID를 무시한다', async t => {
  const {request, store} = await start(t);
  const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const valid = {title: '할 일', ownerId: user.id, date: ''};
  for (const body of [{...valid, title: '  '}, {...valid, ownerId: 'unknown'}, {...valid, ownerId: randomUUID()}, {...valid, date: '2026-02-30'}, {...valid, done: 'false'}, {...valid, title: 123}, {...valid, title: 'x'.repeat(201)}, {...valid, owner: '임의 이름'}, []]) assert.equal((await project('/api/todos', 'POST', body)).status, 400);
  for (const body of [{ownerId: user.id, description: '의견', author: '다른 작성자'}, {ownerId: user.id, description: '의견', authorId: randomUUID()}, {ownerId: user.id, description: '의견', status: '모름'}]) assert.equal((await project('/api/feedback', 'POST', body)).status, 400);
  const item = await (await project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerId: user.id, description: '의견'})).json();
  assert.equal((await (await project(`/api/feedback/${item.id}`, 'PATCH', {authorId: randomUUID()})).json()).authorId, user.id);
  const selected = await store.createUser('선택한 작성자', '선택한 작성자', 'fixture');
  await store.addTeamMember(store.fixtureTeam.id, selected.id);
  const createdBySelection = await (await project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerId: user.id, authorId: selected.id, description: '작성자 선택'})).json();
  assert.equal(createdBySelection.authorId, user.id); assert.equal(createdBySelection.author, user.name);
  const updatedAuthor = await (await project(`/api/feedback/${createdBySelection.id}`, 'PATCH', {authorId: user.id})).json();
  assert.equal(updatedAuthor.authorId, user.id);
  assert.equal(updatedAuthor.createdAt, createdBySelection.createdAt);
  assert.equal((await project('/api/todos/invalid')).status, 400);
  assert.equal((await project(`/api/todos/${randomUUID()}`, 'PATCH', {})).status, 400);
});
test('로그인하지 않은 사용자는 모든 프로젝트·사용자 API에 접근할 수 없다', async t => {
  const {request} = await start(t);
  const project = request.forTeam(randomUUID());
  for (const type of ['events', 'todos', 'feedback']) {
    for (const [route, method, body] of [[`/api/${type}`, 'GET'], [`/api/${type}/${randomUUID()}`, 'GET'], [`/api/${type}`, 'POST', {}], [`/api/${type}/${randomUUID()}`, 'PATCH', {}], [`/api/${type}/${randomUUID()}`, 'DELETE', {}]]) assert.equal((await project(route, method, body)).status, 401);
  }
  for (const route of ['/api/users', '/api/health']) assert.equal((await project(route)).status, 401);
  assert.equal((await project('/api/users/link-legacy', 'POST', {})).status, 401);
});
test('다른 팀원의 항목도 수정 가능하며 기존 미연결 데이터와 작성자는 보존한다', async t => {
  const {request, store} = await start(t);
  const a = await signInFixture(request, store, '가');
  const project = request.forTeam(store.fixtureTeam.id);
  const b = await store.createUser('나', '나', 'fixture');
  await store.addTeamMember(store.fixtureTeam.id, b.id);
  const item = await (await project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerId: b.id, description: '의견'})).json();
  await signInFixture(request, store, '다');
  const updated = await (await project(`/api/feedback/${item.id}`, 'PATCH', {description: '다른 팀원이 수정', ownerId: a.id})).json();
  assert.equal(updated.authorId, a.id); assert.equal(updated.ownerId, a.id);
  const legacy = {teamId: store.fixtureTeam.id, id: randomUUID(), title: '기존 일정', owner: ' 가 ', ownerId: null, date: '2026-10-27', description: '원본'};
  store.records.events.push(legacy);
  const unmatched = {teamId: store.fixtureTeam.id, id: randomUUID(), title: '보존', owner: '미가입', ownerId: null, date: '', done: false}; store.records.todos.push(unmatched);
  assert.equal((await project(`/api/events/${legacy.id}`, 'PATCH', {description: '내용만 수정'})).status, 200);
  const result = await (await project('/api/users/link-legacy', 'POST', {})).json();
  assert.equal(result.events, 1); assert.equal(legacy.ownerId, a.id); assert.equal(legacy.owner, ' 가 ');
  assert.equal(unmatched.ownerId, null);
  assert.equal((await (await project('/api/users/link-legacy', 'POST', {})).json()).events, 0);
});
test('DB 장애 응답에 연결 정보가 포함되지 않는다', async t => {
  const store = memoryStore();
  const secret = 'postgresql://user:secret@private/db';
  store.list = async () => { throw new Error(secret); };
  const {request} = await start(t, store); await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const response = await project('/api/todos'); assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(secret));
});

test('팀 선택은 계정 없이 저장하고 두 사용자의 조회·상태 변경에 동일 원본을 사용한다', async t => {
  const {request, store} = await start(t);
  const a = await signInFixture(request, store, '가');
  const project = request.forTeam(store.fixtureTeam.id);
  const teamNamedUser = await store.createUser('팀', '팀', 'fixture');
  await store.addTeamMember(store.fixtureTeam.id, teamNamedUser.id);
  const todo = await (await project('/api/todos', 'POST', {title: '팀 업무', ownerType: 'team', ownerId: null, date: '2026-10-27'})).json();
  assert.equal(todo.owner, '팀'); assert.equal(todo.ownerType, 'team'); assert.equal(todo.ownerId, null);
  const fb = await (await project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerType: 'team', authorType: 'team', description: '공통 의견'})).json();
  const personal = await (await project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerId: a.id, authorType: 'team', description: '개인 업무'})).json();
  assert.equal(personal.authorType, 'user'); assert.equal(personal.authorId, a.id);
  await signInFixture(request, store, '나');
  assert.equal((await (await project(`/api/todos/${todo.id}`, 'PATCH', {done: true})).json()).done, true);
  assert.equal((await (await project(`/api/feedback/${fb.id}`, 'PATCH', {status: '완료'})).json()).status, '완료');
  const data = M.empty();
  data.todos = await (await project('/api/todos')).json(); data.feedback = await (await project('/api/feedback')).json();
  assert.equal(M.myTasks(data, a.id).todos[0].done, true);
  assert.equal(M.myTasks(data, teamNamedUser.id).feedback[0].status, '완료');
  assert.ok(!M.myTasks(data, teamNamedUser.id).feedback.some(item => item.id === personal.id));
  await project('/api/users/link-legacy', 'POST', {});
  assert.equal((await (await project(`/api/feedback/${fb.id}`)).json()).authorId, a.id);
  assert.equal((await (await project(`/api/todos/${todo.id}`)).json()).ownerId, null);
  const toPerson = await (await project(`/api/todos/${todo.id}`, 'PATCH', {ownerId: a.id})).json();
  assert.equal(toPerson.ownerType, 'user'); assert.equal(toPerson.ownerId, a.id);
  const toTeam = await (await project(`/api/todos/${todo.id}`, 'PATCH', {ownerType: 'team'})).json();
  assert.equal(toTeam.ownerId, null); assert.equal(toTeam.ownerType, 'team');
  assert.equal(store.records.todos.length, 1);
  for (const body of [{ownerType: 'bad'}, {ownerType: 'team', ownerId: a.id}, {ownerType: 'user', ownerId: null}, {ownerType: null}]) assert.equal((await project(`/api/todos/${todo.id}`, 'PATCH', body)).status, 400);
  assert.equal((await (await project(`/api/feedback/${fb.id}`, 'PATCH', {authorType: 'team', authorId: a.id})).json()).authorId, a.id);
});

test('일정 시간은 선택 사항이며 HH:mm 저장·수정·종일 전환·정렬을 지원한다', async t => {
  const {request, store} = await start(t); const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const sample = {title: '회의', ownerId: user.id, date: '2026-10-27', description: '내용'};
  const all = await (await project('/api/events', 'POST', sample)).json(); assert.equal(all.time, '');
  const late = await (await project('/api/events', 'POST', {...sample, time: '16:30'})).json();
  const early = await (await project('/api/events', 'POST', {...sample, time: '00:00'})).json();
  assert.deepEqual((await (await project('/api/events')).json()).map(item => item.id), [all.id, early.id, late.id]);
  const route = `/api/events/${late.id}`;
  assert.equal((await (await project(route, 'PATCH', {time: '09:05'})).json()).time, '09:05');
  assert.equal((await (await project(route, 'PATCH', {title: '제목만 수정'})).json()).time, '09:05');
  assert.equal((await (await project(route, 'PATCH', {time: ''})).json()).time, '');
  for (const time of ['24:00', '9:05', '09:60', '09:05:30', null, 9]) assert.equal((await project(route, 'PATCH', {time})).status, 400);
  assert.equal((await project('/api/todos', 'POST', {...sample, time: '09:00'})).status, 400);
});
