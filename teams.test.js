'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {start, signInFixture} = require('./test-support/memory-store');

async function setup(t) {
  const {request, store} = await start(t);
  const a = await signInFixture(request, store, '사용자 A', false), cookieA = request.cookie();
  assert.deepEqual(await (await request('/api/teams')).json(), []);
  const ta = await (await request('/api/teams', 'POST', {name: '팀 A', description: 'A의 프로젝트'})).json();
  const b = await signInFixture(request, store, '사용자 B', false), cookieB = request.cookie();
  const tb = await (await request('/api/teams', 'POST', {name: '팀 B', description: 'B의 프로젝트'})).json();
  const taskA = (await store.createTask(ta.id, 'A 업무')).task;
  const taskB = (await store.createTask(tb.id, 'B 업무')).task;
  return {request, store, a, b, ta, tb, cookieA, cookieB, taskA, taskB};
}
test('두 계정·두 팀: 생성자 소속·대표·초대 확인·가입·중복 방지·코드 공개 범위', async t => {
  const {request, store, a, ta, tb, cookieA} = await setup(t);
  assert.notEqual(ta.inviteCode, tb.inviteCode); assert.match(ta.inviteCode, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(ta.ownerId, a.id); assert.equal(ta.isOwner, true);
  assert.equal(store.members.get(ta.id).has(a.id), true);
  assert.deepEqual((await (await request('/api/teams')).json()).map(team => team.id), [tb.id]);
  request.setCookie(cookieA);
  assert.equal((await request('/api/teams/invitations/preview', 'POST', {inviteCode: '잘못된 코드'})).status, 400);
  assert.equal((await request('/api/teams/invitations/preview', 'POST', {inviteCode: 'x'.repeat(32)})).status, 404);
  const preview = await (await request('/api/teams/invitations/preview', 'POST', {inviteCode: tb.inviteCode})).json();
  assert.equal(preview.name, '팀 B'); assert.equal(preview.alreadyMember, false); assert.ok(!Object.hasOwn(preview, 'inviteCode'));
  assert.equal((await request('/api/teams/join', 'POST', {inviteCode: tb.inviteCode, teamId: ta.id})).status, 400);
  const responses = await Promise.all([1, 2].map(() => request('/api/teams/join', 'POST', {inviteCode: tb.inviteCode, teamId: tb.id})));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal(store.members.get(tb.id).size, 2);
  const teams = await (await request('/api/teams')).json(); assert.equal(teams.length, 2);
  assert.equal(teams.find(team => team.id === tb.id).inviteCode, null);
  assert.equal((await (await request(`/api/teams/${tb.id}`)).json()).inviteCode, null);
  assert.equal((await (await request('/api/teams/invitations/preview', 'POST', {inviteCode: tb.inviteCode})).json()).alreadyMember, true);
  for (const name of ['', '   ', 'x'.repeat(101)]) assert.equal((await request('/api/teams', 'POST', {name})).status, 400);
  assert.equal((await request('/api/teams', 'POST', {name: '위조', ownerId: randomUUID()})).status, 400);
});

test('모든 팀 데이터 API가 소속을 확인하고 다른 팀 UUID를 우회해서 수정할 수 없다', async t => {
  const {request, a, b, ta, tb, cookieA, cookieB, taskA, taskB} = await setup(t);
  const samples = {
    events: {title: '회의', ownerType: 'team', date: '2026-10-27', time: '09:30', description: '내용'},
    todos: {title: '공통 업무', ownerType: 'team', date: '2026-10-27'},
    feedback: {taskId: taskB.id, ownerType: 'team', authorType: 'team', description: '공통 의견'}
  };
  const original = {};
  for (const [type, sample] of Object.entries(samples)) {
    const response = await request(`/api/teams/${tb.id}/${type}`, 'POST', sample);
    assert.equal(response.status, 201); original[type] = await response.json();
  }
  request.setCookie(cookieA);
  for (const [type, sample] of Object.entries(samples)) for (const [suffix, method, body] of [[type, 'GET'], [type, 'POST', sample], [`${type}/${original[type].id}`, 'GET'], [`${type}/${original[type].id}`, 'PATCH', type === 'todos' ? {done: true} : {description: '침입'}], [`${type}/${original[type].id}`, 'DELETE']]) {
    assert.equal((await request(`/api/teams/${tb.id}/${suffix}`, method, body)).status, 403);
  }
  for (const [suffix, method, body] of [['', 'GET'], ['/users', 'GET'], ['/users/link-legacy', 'POST', {}]]) assert.equal((await request(`/api/teams/${tb.id}${suffix}`, method, body)).status, 403);
  for (const route of ['/api/events', '/api/todos', '/api/feedback', '/api/users']) assert.equal((await request(route)).status, 404);
  for (const [type, sample] of Object.entries(samples)) {
    assert.deepEqual(await (await request(`/api/teams/${ta.id}/${type}`)).json(), []);
    assert.equal((await request(`/api/teams/${ta.id}/${type}/${original[type].id}`)).status, 404);
    assert.equal((await request(`/api/teams/${ta.id}/${type}/${original[type].id}`, 'PATCH', type === 'todos' ? {done: true} : {description: '침입'})).status, 404);
    assert.equal((await request(`/api/teams/${ta.id}/${type}/${original[type].id}`, 'DELETE')).status, 404);
    assert.equal((await request(`/api/teams/${ta.id}/${type}`, 'POST', {...sample, teamId: tb.id})).status, 400);
  }
  assert.equal((await request(`/api/teams/${ta.id}/todos`, 'POST', {title: '외부 담당자', ownerId: b.id})).status, 400);
  const spoofed = await (await request(`/api/teams/${ta.id}/feedback`, 'POST', {taskId: taskA.id, ownerId: a.id, authorId: b.id, description: '외부 작성자 무시'})).json();
  assert.equal(spoofed.authorId, a.id);
  assert.equal((await request(`/api/teams/${ta.id}/feedback/${spoofed.id}`, 'DELETE')).status, 204);
  assert.deepEqual(await (await request(`/api/teams/${ta.id}/users`)).json(), [{id: a.id, name: a.name}]);
  await request('/api/teams/join', 'POST', {inviteCode: tb.inviteCode, teamId: tb.id});
  for (const type of Object.keys(samples)) {
    assert.equal((await (await request(`/api/teams/${tb.id}/${type}`)).json())[0].teamId, tb.id);
    assert.deepEqual(await (await request(`/api/teams/${ta.id}/${type}`)).json(), []);
    assert.equal((await request(`/api/teams/${ta.id}/${type}/${original[type].id}`, 'DELETE')).status, 404);
  }
  await request(`/api/teams/${tb.id}/todos/${original.todos.id}`, 'PATCH', {done: true});
  request.setCookie(cookieB);
  assert.equal((await (await request(`/api/teams/${tb.id}/todos/${original.todos.id}`)).json()).done, true);
  assert.equal((await request(`/api/teams/${ta.id}/todos`)).status, 403);
  request.setCookie('');
  for (const route of ['/api/teams', `/api/teams/${tb.id}`, `/api/teams/${tb.id}/todos`, `/api/teams/${tb.id}/users`]) assert.equal((await request(route)).status, 401);
});

test('기존 이름 연결은 현재 팀의 행과 현재 팀의 사용자에게만 적용한다', async t => {
  const {request, store, a, b, ta, tb, cookieA} = await setup(t);
  const legacy = {id: randomUUID(), teamId: ta.id, owner: b.name, ownerId: null, title: '미연결', date: '', done: false};
  const outside = {id: randomUUID(), teamId: tb.id, owner: a.name, ownerId: null, title: '다른 팀', date: '', done: false};
  store.records.todos.push(legacy, outside);
  request.setCookie(cookieA);
  await request(`/api/teams/${ta.id}/users/link-legacy`, 'POST', {});
  assert.equal(legacy.ownerId, null); assert.equal(outside.ownerId, null);
});
