'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {start, signInFixture} = require('./test-support/memory-store');
const M = require('./public/model');

test('한국 월요일 경계·일요일 끝·월/연도 경계·윤년의 주 범위를 계산한다', () => {
  assert.deepEqual(M.weekRange('2026-10-28'), {start: '2026-10-26', end: '2026-11-01'});
  assert.deepEqual(M.weekRange('2026-01-01'), {start: '2025-12-29', end: '2026-01-04'});
  assert.deepEqual(M.weekRange('2024-02-29'), {start: '2024-02-26', end: '2024-03-03'});
  const items = [
    {id: 'before', completedAt: '2026-10-25T14:59:59.999Z'},
    {id: 'start', completedAt: '2026-10-25T15:00:00Z'},
    {id: 'end', completedAt: '2026-11-01T14:59:59.999Z'},
    {id: 'next', completedAt: '2026-11-01T15:00:00Z'},
    {id: 'old', completedAt: '2020-01-05T15:00:00Z'},
    {id: 'unknown', completedAt: null, createdAt: '2026-10-28T01:00:00Z', date: '2026-10-28'},
    {id: 'invalid', completedAt: 'invalid'}
  ];
  const ids = (period, date) => M.completedInPeriod(items, period, '2026-10-28', date).map(item => item.id);
  assert.deepEqual(ids('this'), ['end', 'start']);
  assert.deepEqual(ids('last'), ['before']);
  assert.deepEqual(ids('previous', '2020-01-08'), ['old']);
  assert.deepEqual(ids('unknown'), ['invalid', 'unknown']);
  assert.deepEqual(M.completedInPeriod(items, 'this', '2026-11-02').map(item => item.id), ['next']);
});

test('작성자는 세션으로 고정하고 다른 팀원 수정·위조·팀/미연결 과거 작성자를 보존한다', async t => {
  const {request, store} = await start(t); const a = await signInFixture(request, store, '원래 작성자');
  const project = request.forTeam(store.fixtureTeam.id);
  const create = body => project('/api/feedback', 'POST', {taskId: store.fixtureTask.id, ownerType: 'team', description: '의견', ...body});
  const item = await (await create({authorId: randomUUID(), authorType: 'team'})).json();
  assert.equal(item.authorId, a.id); assert.equal(item.author, a.name); assert.equal(item.authorType, 'user');
  const b = await signInFixture(request, store, '수정한 팀원');
  const edited = await (await project(`/api/feedback/${item.id}`, 'PATCH', {description: '수정', authorId: b.id, authorType: 'team'})).json();
  assert.equal(edited.authorId, a.id); assert.equal(edited.author, a.name); assert.equal(edited.authorType, 'user');
  for (const [author, authorType] of [['팀', 'team'], [a.name, 'user']]) {
    const legacy = {...item, id: randomUUID(), author, authorType, authorId: null};
    store.records.feedback.push(legacy);
    const changed = await (await project(`/api/feedback/${legacy.id}`, 'PATCH', {status: '작업 중', authorId: b.id})).json();
    assert.equal(changed.authorId, null); assert.equal(changed.authorType, authorType); assert.equal(changed.author, author);
    await project('/api/users/link-legacy', 'POST', {});
    assert.equal(legacy.authorId, null);
  }
});

for (const type of ['todos', 'feedback']) test(`${type}: 완료 전환·중복 요청·내용 수정·취소·재완료·실패·미상 보존`, async t => {
  const {request, store} = await start(t); const user = await signInFixture(request, store);
  const project = request.forTeam(store.fixtureTeam.id);
  let time = '2026-10-25T14:59:59Z'; store.now = () => time;
  const state = done => type === 'todos' ? {done} : {status: done ? '완료' : '작업 중'};
  const content = type === 'todos' ? {title: '내용 수정'} : {description: '내용 수정'};
  const body = type === 'todos' ? {title: '업무', date: ''} : {taskId: store.fixtureTask.id, description: '의견'};
  const item = await (await project(`/api/${type}`, 'POST', {...body, ownerId: user.id})).json();
  const route = `/api/${type}/${item.id}`;
  assert.equal(item.completedAt, null);
  assert.equal((await project(route, 'PATCH', {completedAt: time})).status, 400);
  const first = await (await project(route, 'PATCH', state(true))).json(); assert.equal(first.completedAt, time);
  time = '2026-10-26T01:00:00Z';
  const repeated = await (await project(route, 'PATCH', {...state(true), ...content})).json(); assert.equal(repeated.completedAt, first.completedAt);
  assert.equal((await (await project(route, 'PATCH', content)).json()).completedAt, first.completedAt);
  const undone = await (await project(route, 'PATCH', state(false))).json(); assert.equal(undone.completedAt, null);
  const again = await (await project(route, 'PATCH', state(true))).json(); assert.equal(again.completedAt, time);
  const data = M.empty(); data[type] = await (await project(`/api/${type}`)).json();
  assert.equal(M.myTasks(data, user.id, store.fixtureTeam.id)[type][0].completedAt, time);
  const stored = store.records[type][0]; stored.completedAt = null;
  assert.equal((await (await project(route, 'PATCH', {...content, ...state(true)})).json()).completedAt, null);
  const update = store.update; store.update = async () => { throw new Error('simulated'); };
  assert.equal((await project(route, 'PATCH', state(false))).status, 500);
  assert.equal(type === 'todos' ? stored.done : stored.status === '완료', true); assert.equal(stored.completedAt, null);
  store.update = update;
});
