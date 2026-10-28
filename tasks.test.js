'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {start, signInFixture} = require('./test-support/memory-store');

test('업무 생성은 공백을 제거하고 팀 안에서 중복/동시 생성을 기존 ID로 통합한다', async t => {
  const {request, store} = await start(t); await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const first = await project('/api/tasks', 'POST', {title: '  발표 자료  '}); assert.equal(first.status, 201);
  const {task} = await first.json(); assert.equal(task.title, '발표 자료');
  const results = await Promise.all([1, 2].map(() => project('/api/tasks', 'POST', {title: '\t발표 자료\u00a0'})));
  for (const response of results) {
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.task.id, task.id); assert.equal(body.created, false); assert.match(body.message, /기존 업무/);
  }
  assert.equal([...store.tasks.values()].filter(item => item.teamId === store.fixtureTeam.id && item.title === task.title).length, 1);
  for (const body of [{title: ''}, {title: ' \n\t'}, {title: 'x'.repeat(201)}, {title: 123}, {title: '위조', teamId: randomUUID()}, []]) assert.equal((await project('/api/tasks', 'POST', body)).status, 400);
});

test('업무 ID로 여러 피드백을 연결·필터·재지정하고 필수 제목과 내용을 검증한다', async t => {
  const {request, store} = await start(t); const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  const first = (await (await project('/api/tasks', 'POST', {title: '표지 개선'})).json()).task;
  const second = (await (await project('/api/tasks', 'POST', {title: '본문 개선'})).json()).task;
  const sample = {taskId: first.id, ownerId: user.id, description: '색상 수정'};
  const ids = [];
  for (const description of ['색상 수정', '문구 수정']) {
    const response = await project('/api/feedback', 'POST', {...sample, description}); assert.equal(response.status, 201);
    const item = await response.json(); ids.push(item.id); assert.equal(item.taskId, first.id); assert.equal(item.taskTitle, first.title);
  }
  assert.equal((await (await project(`/api/feedback?taskId=${first.id}`)).json()).length, 2);
  const moved = await (await project(`/api/feedback/${ids[0]}`, 'PATCH', {taskId: second.id})).json();
  assert.equal(moved.taskTitle, second.title); assert.equal(moved.description, sample.description);
  assert.deepEqual((await (await project(`/api/feedback?taskId=${second.id}`)).json()).map(item => item.id), [ids[0]]);
  const changed = await (await project(`/api/feedback/${ids[0]}`, 'PATCH', {status: '완료'})).json();
  assert.equal(changed.taskId, second.id); assert.equal(changed.createdAt, moved.createdAt);
  for (const body of [{...sample, taskId: ''}, {...sample, taskId: randomUUID()}, {...sample, description: '  '}, {ownerId: user.id, description: '업무 미선택'}, {...sample, title: '문자열로 연결 시도'}]) assert.equal((await project('/api/feedback', 'POST', body)).status, 400);
  assert.equal((await project(`/api/feedback/${ids[1]}`, 'PATCH', {taskId: null})).status, 400);
  assert.equal((await project('/api/feedback?taskId=wrong')).status, 400);
  assert.equal((await project(`/api/feedback/${ids[0]}`, 'DELETE')).status, 204);
  assert.equal((await project('/api/tasks')).status, 200);
  assert.ok((await (await project('/api/tasks')).json()).some(task => task.id === second.id));
});

test('다른 팀 업무는 목록·피드백 연결·업무 필터에 사용할 수 없다', async t => {
  const {request, store} = await start(t); const user = await signInFixture(request, store);
  const a = store.fixtureTeam;
  const b = await store.createTeam('다른 팀', '', user.id, randomUUID().replaceAll('-', ''));
  const projectA = request.forTeam(a.id), projectB = request.forTeam(b.id);
  const taskA = (await (await projectA('/api/tasks', 'POST', {title: '같은 제목'})).json()).task;
  const taskB = (await (await projectB('/api/tasks', 'POST', {title: '같은 제목'})).json()).task;
  assert.notEqual(taskA.id, taskB.id);
  assert.ok(!(await (await projectA('/api/tasks')).json()).some(task => task.id === taskB.id));
  const sample = {ownerId: user.id, description: '설명', taskId: taskB.id};
  assert.equal((await projectA('/api/feedback', 'POST', sample)).status, 400);
  assert.equal((await projectA(`/api/feedback?taskId=${taskB.id}`)).status, 400);
  const original = await (await projectA('/api/feedback', 'POST', {...sample, taskId: taskA.id})).json();
  assert.equal((await projectA(`/api/feedback/${original.id}`, 'PATCH', {taskId: taskB.id})).status, 400);
  assert.equal((await (await projectA(`/api/feedback/${original.id}`)).json()).taskId, taskA.id);
  await signInFixture(request, store, '다른 팀원', false);
  for (const team of [a, b]) for (const [method, body] of [['GET'], ['POST', {title: '침입'}]]) assert.equal((await request(`/api/teams/${team.id}/tasks`, method, body)).status, 403);
  request.setCookie('');
  assert.equal((await projectA('/api/tasks')).status, 401);
});

test('투두 완료·해제는 같은 원본을 상태별/마감일 순서로 다시 조회한다', async t => {
  const {request, store} = await start(t); const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id), items = [];
  for (const [title, date, done] of [['완료 오래됨', '2026-10-01', true], ['날짜 없음', '', false], ['미완료 늦음', '2026-10-30', false], ['미완료 빠름', '2026-10-28', false], ['완료 날짜 없음', '', true]]) items.push(await (await project('/api/todos', 'POST', {title, date, done, ownerId: user.id})).json());
  const titles = async () => (await (await project('/api/todos')).json()).map(item => item.title);
  assert.deepEqual(await titles(), ['미완료 빠름', '미완료 늦음', '날짜 없음', '완료 오래됨', '완료 날짜 없음']);
  await project(`/api/todos/${items[3].id}`, 'PATCH', {done: true});
  assert.deepEqual(await titles(), ['미완료 늦음', '날짜 없음', '완료 오래됨', '미완료 빠름', '완료 날짜 없음']);
  await project(`/api/todos/${items[0].id}`, 'PATCH', {done: false});
  assert.deepEqual(await titles(), ['완료 오래됨', '미완료 늦음', '날짜 없음', '미완료 빠름', '완료 날짜 없음']);
  assert.equal(store.records.todos.length, 5);
});
