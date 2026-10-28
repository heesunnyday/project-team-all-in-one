'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./public/model.js');
test('전체 투두도 완료 그룹과 마감일로 정렬하고 완료 취소 시 원래 ID를 이동한다', () => {
  const rows = [{id: 'done-old', done: true, date: '2026-10-01'}, {id: 'open-none', done: false, date: ''}, {id: 'open-late', done: false, date: '2026-10-30'}, {id: 'open-early', done: false, date: '2026-10-28'}, {id: 'done-none', done: true, date: ''}];
  assert.deepEqual(M.sortedTodos(rows).map(item => item.id), ['open-early', 'open-late', 'open-none', 'done-old', 'done-none']);
  rows[3].done = true;
  assert.deepEqual(M.sortedTodos(rows).map(item => item.id), ['open-late', 'open-none', 'done-old', 'open-early', 'done-none']);
  rows[0].done = false;
  assert.equal(M.sortedTodos(rows)[0], rows[0]); assert.equal(rows.length, 5);
});
test('피드백은 제목이 같아도 업무 ID로 구분하고 각 업무에서 완료 그룹·최신순으로 정렬한다', () => {
  const rows = [
    {id: 'done', taskId: 'a', taskTitle: '같은 제목', status: '완료', createdAt: '2026-10-28T11:00:00Z'},
    {id: 'old', taskId: 'a', taskTitle: '같은 제목', status: '작업 중', createdAt: '2026-10-27T10:00:00Z'},
    {id: 'new', taskId: 'a', taskTitle: '같은 제목', status: '미완료', createdAt: '2026-10-28T10:00:00Z'},
    {id: 'other', taskId: 'b', taskTitle: '같은 제목', status: '미완료', createdAt: '2026-10-28T12:00:00Z'}
  ];
  assert.deepEqual(M.feedbackGroups(rows).map(group => [group.taskId, group.items.map(item => item.id)]), [['a', ['new', 'old', 'done']], ['b', ['other']]]);
  assert.deepEqual(M.feedbackGroups(rows, 'b')[0].items, [rows[3]]);
  rows[0].status = '작업 중';
  assert.strictEqual(M.feedbackGroups(rows, 'a')[0].items[0], rows[0]);
});
test('My Page와 알림은 현재 팀의 개인/팀 공통 업무에만 한정한다', () => {
  const data = M.empty();
  data.todos = [
    {id: 'a-team', teamId: 'a', ownerType: 'team', ownerId: null, date: '2026-10-26', done: false},
    {id: 'a-mine', teamId: 'a', ownerType: 'user', ownerId: 'me', date: '2026-10-27', done: false},
    {id: 'b-team', teamId: 'b', ownerType: 'team', ownerId: null, date: '2026-10-27', done: false},
    {id: 'b-mine', teamId: 'b', ownerType: 'user', ownerId: 'me', date: '2026-10-26', done: false}
  ];
  data.feedback = [{id: 'fa', teamId: 'a', ownerType: 'team'}, {id: 'fb', teamId: 'b', ownerId: 'me'}];
  assert.deepEqual(M.myTasks(data, 'me', 'a').todos.map(item => item.id), ['a-team', 'a-mine']);
  assert.deepEqual(M.myTasks(data, 'me', 'a').feedback.map(item => item.id), ['fa']);
  assert.deepEqual(M.myTasks(data, 'me', 'b').feedback.map(item => item.id), ['fb']);
  assert.deepEqual(M.deadlineCounts(data.todos, 'me', '2026-10-27', 'a'), {overdue: 1, urgent: 1});
  data.todos[2].done = true;
  assert.deepEqual(M.deadlineCounts(data.todos, 'me', '2026-10-27', 'b'), {overdue: 1, urgent: 0});
});

test('모든 필수 입력란은 빈 값과 공백만 있는 값을 거부한다', () => {
  for (const [type, fields] of Object.entries(M.fields)) {
    const valid = Object.fromEntries(fields.map(([key, , inputType]) => [key, inputType === 'date' ? '2026-10-27' : inputType === 'time' ? '09:30' : '  테스트 내용  ']));
    for (const [key, , , required] of fields) {
      if (required) for (const blank of ['', '   ', '\n\t']) assert.throws(() => M.normalize(type, {...valid, [key]: blank}));
    }
    const normalized = M.normalize(type, valid);
    for (const value of Object.values(normalized)) assert.equal(value, value.trim());
  }
});
test('날짜는 실제 달력 날짜여야 하며 윤년과 연도 경계를 처리한다', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-1-1', 'invalid']) assert.equal(M.validDate(value), false);
  for (const value of ['2024-02-29', '2026-12-31', '2027-01-01']) assert.equal(M.validDate(value), true);
  assert.equal(M.dateKey(new Date(2026, 12, 1, 12)), '2027-01-01');
  assert.equal(M.dateKey(new Date(2026, -1, 1, 12)), '2025-12-01');
});
test('투두는 마감일 오름차순으로 정렬하며 날짜가 없으면 마지막이다', () => {
  const todos = [{id: 'none', date: ''}, {id: 'late', date: '2027-01-01'}, {id: 'early', date: '2026-10-27'}];
  assert.deepEqual(M.sortedTodos(todos).map(item => item.id), ['early', 'late', 'none']);
  assert.equal(todos[0].id, 'none');
  assert.equal(M.normalize('todos', {title: '할 일', owner: '담당자', date: ''}).date, '');
});
test('투두 등록·수정·완료·미완료·삭제가 캘린더 조회에 즉시 반영된다', () => {
  const data = M.empty();
  data.events.push({id: 'event', title: '회의', owner: '가', date: '2026-10-27', description: '내용'});
  const todo = {id: 'todo', title: '초안', owner: '나', date: '2026-10-27', done: false};
  data.todos.push(todo);
  assert.equal(M.itemsForDate(data, '2026-10-27').length, 2);
  Object.assign(todo, {title: '최종안', owner: '다', date: '2026-10-28'});
  assert.equal(M.itemsForDate(data, '2026-10-27').length, 1);
  assert.equal(M.itemsForDate(data, '2026-10-28')[0].title, '최종안');
  assert.equal(M.itemsForDate(data, '2026-10-28')[0].owner, '다');
  todo.done = true;
  assert.equal(M.itemsForDate(data, '2026-10-28')[0].done, true);
  todo.done = false;
  assert.equal(M.itemsForDate(data, '2026-10-28')[0].done, false);
  todo.date = '';
  assert.equal(M.itemsForDate(data, '2026-10-28').length, 0);
  data.todos = [];
  assert.equal(M.itemsForDate(data, '2026-10-27').length, 1);
});
test('localStorage용 JSON 왕복에서 항목과 피드백 상태를 유지한다', () => {
  const data = M.empty();
  data.todos.push({id: 'todo', title: '<script>alert(1)</script>', owner: '나', date: '', done: true});
  data.events.push({id: 'event', title: '발표', owner: '가', date: '2026-10-27', time: '', description: '발표 준비'});
  for (const status of M.statuses) {
    data.feedback = [{id: 'feedback', author: '가', owner: '나', description: '수정 의견', status}];
    assert.deepEqual(M.validate(JSON.parse(JSON.stringify(data))), data);
  }
});

test('종일 일정이 먼저이고 한국 시각 HH:mm 순으로 정렬하며 기존 일정은 종일이다', () => {
  const data = M.empty();
  data.events = [
    {id: 'late', date: '2026-10-27', time: '23:59'},
    {id: 'old', title: '기존', owner: '가', description: '보존', date: '2026-10-27'},
    {id: 'early', date: '2026-10-27', time: '00:00'},
    {id: 'all', date: '2026-10-27', time: ''},
    {id: 'other', date: '2026-10-28', time: '09:00'}
  ];
  assert.deepEqual(M.itemsForDate(data, '2026-10-27').map(item => item.id), ['old', 'all', 'early', 'late']);
  assert.equal(M.normalize('events', data.events[1]).time, '');
  for (const time of ['24:00', '9:30', '12:60', '12:30:00', 'garbage']) assert.equal(M.validTime(time), false);
  for (const time of ['00:00', '09:30', '23:59']) assert.equal(M.validTime(time), true);
});

test('팀 공통 업무는 모든 팀원이 같은 원본을 조회하며 작성자만 팀인 개인 업무는 분리한다', () => {
  const data = M.empty();
  const shared = {id: 'team', owner: '팀', ownerType: 'team', ownerId: null, date: '2026-10-27', done: false};
  data.todos = [shared, {id: 'person', owner: '팀', ownerType: 'user', ownerId: 'a', date: '2026-10-26', done: false}];
  data.feedback = [{id: 'shared', ownerType: 'team', ownerId: null, status: '미완료'}, {id: 'personal', ownerType: 'user', ownerId: 'a', authorType: 'team', status: '미완료'}];
  assert.strictEqual(M.myTasks(data, 'b').todos[0], shared);
  assert.deepEqual(M.myTasks(data, 'b').feedback.map(item => item.id), ['shared']);
  assert.equal(M.myTasks(data, 'a').feedback.length, 2);
  assert.deepEqual(M.deadlineCounts(data.todos, 'a', '2026-10-27'), {overdue: 1, urgent: 1});
  assert.deepEqual(M.deadlineCounts(data.todos, 'b', '2026-10-27'), {overdue: 0, urgent: 1});
  shared.done = true;
  assert.equal(M.myTasks(data, 'a').todos.find(item => item.id === 'team').done, true);
  assert.deepEqual(M.deadlineCounts(data.todos, 'b', '2026-10-27'), {overdue: 0, urgent: 0});
});
test('손상된 저장 데이터와 잘못된 상태를 거부한다', () => {
  assert.throws(() => M.validate({}));
  const data = M.empty();
  data.feedback.push({id: 'feedback', author: '가', owner: '나', description: '의견', status: '잘못된 상태'});
  assert.throws(() => M.validate(data));
  data.feedback[0].status = '미완료';
  data.feedback.push({...data.feedback[0]});
  assert.throws(() => M.validate(data));
});

test('한국 날짜와 D-day는 UTC+9 자정, 윤년·연도 경계에서 정확하다', () => {
  assert.equal(M.koreaDateKey(new Date('2026-10-27T14:59:59.999Z')), '2026-10-27');
  assert.equal(M.koreaDateKey(new Date('2026-10-27T15:00:00.000Z')), '2026-10-28');
  for (const [date, label, urgent, overdue] of [
    ['2026-10-31', 'D-4', false, false], ['2026-10-30', 'D-3', true, false],
    ['2026-10-29', 'D-2', true, false], ['2026-10-28', 'D-1', true, false],
    ['2026-10-27', 'D-DAY', true, false], ['2026-10-26', '기한 초과 1일', false, true],
    ['', '마감일 없음', false, false]
  ]) assert.deepEqual(M.deadlineInfo({date, done: false}, '2026-10-27'), {label, urgent, overdue, days: date ? Math.round((Date.parse(date) - Date.parse('2026-10-27')) / 86400000) : null});
  assert.equal(M.deadlineInfo({date: '2027-01-01'}, '2026-12-31').days, 1);
  assert.equal(M.deadlineInfo({date: '2028-03-01'}, '2028-02-28').days, 2);
  assert.deepEqual(M.deadlineInfo({date: '2026-10-26', done: true}, '2026-10-27'), {label: '완료', urgent: false, overdue: false, days: null});
});
test('My Page는 이름 대신 ID로 원본을 선택하고 완료 그룹/마감일로 정렬한다', () => {
  const data = M.empty();
  data.todos = [
    {id: 'done-none', ownerId: 'me', done: true, date: ''},
    {id: 'open-none', ownerId: 'me', done: false, date: ''},
    {id: 'done-early', ownerId: 'me', done: true, date: '2026-10-26'},
    {id: 'open-late', ownerId: 'me', done: false, date: '2026-10-30'},
    {id: 'open-early', ownerId: 'me', done: false, date: '2026-10-27'},
    {id: 'same-name', owner: '내 이름', ownerId: 'other', done: false, date: ''},
    {id: 'legacy', owner: '내 이름', ownerId: null, done: false, date: ''}
  ];
  const mine = M.myTasks(data, 'me');
  assert.deepEqual(mine.todos.map(item => item.id), ['open-early', 'open-late', 'open-none', 'done-early', 'done-none']);
  assert.strictEqual(mine.todos[0], data.todos[4]);
  data.todos[4].ownerId = 'other';
  assert.ok(!M.myTasks(data, 'me').todos.some(item => item.id === 'open-early'));
  assert.deepEqual(M.myTasks(data, null), {todos: [], feedback: []});
});
test('내 피드백은 미완료/작업 중 우선, 그룹 안에서 최신 작성순이다', () => {
  const data = M.empty();
  data.feedback = [
    {id: 'open-old', ownerId: 'me', status: '미완료', createdAt: '2026-10-20T10:00:00Z'},
    {id: 'done-new', ownerId: 'me', status: '완료', createdAt: '2026-10-27T10:00:00Z'},
    {id: 'working-new', ownerId: 'me', status: '작업 중', createdAt: '2026-10-26T10:00:00Z'},
    {id: 'done-old', ownerId: 'me', status: '완료', createdAt: '2026-10-20T10:00:00Z'},
    {id: 'other', ownerId: 'other', status: '미완료', createdAt: '2026-10-28T10:00:00Z'}
  ];
  assert.deepEqual(M.myTasks(data, 'me').feedback.map(item => item.id), ['working-new', 'open-old', 'done-new', 'done-old']);
  data.feedback[1].status = '미완료';
  assert.equal(M.myTasks(data, 'me').feedback[0].id, 'done-new');
});
test('마감 알림은 내 미완료 투두만 집계하고, 날짜/담당자/완료 변경을 반영한다', () => {
  const todos = [
    {ownerId: 'me', date: '2026-10-26', done: false},
    {ownerId: 'me', date: '2026-10-27', done: false},
    {ownerId: 'me', date: '2026-10-30', done: false},
    {ownerId: 'me', date: '2026-10-31', done: false},
    {ownerId: 'me', date: '', done: false},
    {ownerId: 'me', date: '2026-10-26', done: true},
    {ownerId: 'other', date: '2026-10-26', done: false}
  ];
  assert.deepEqual(M.deadlineCounts(todos, 'me', '2026-10-27'), {overdue: 1, urgent: 2});
  todos[0].done = true; todos[1].ownerId = 'other'; todos[2].date = '';
  assert.deepEqual(M.deadlineCounts(todos, 'me', '2026-10-27'), {overdue: 0, urgent: 0});
  todos[0].done = false;
  assert.deepEqual(M.deadlineCounts(todos, 'me', '2026-10-28'), {overdue: 1, urgent: 1});
  assert.deepEqual(M.deadlineCounts(todos, null, '2026-10-27'), {overdue: 0, urgent: 0});
});
