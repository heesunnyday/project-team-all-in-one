'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {start} = require('./test-support/memory-store');
const {hashPassword} = require('./auth');

async function waitFor(check, message) {
  const deadline = Date.now() + 15000;
  while (!check()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); }
}
test('화면 로그인 → 담당자 선택 → 투두/달력 → 작성자 자동 지정 → 로그아웃', async t => {
  const {request, store} = await start(t);
  const alice = await store.createUser('가팀원', '가팀원', await hashPassword('password-123!'));
  const bob = await store.createUser('나팀원', '나팀원', 'fixture');
  const team = await store.createTeam('화면 검사 팀', '', alice.id, 'a'.repeat(32));
  await store.addTeamMember(team.id, bob.id);
  const task = (await store.createTask(team.id, '화면 검사 업무')).task;
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8'), {url: request.base, runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = selector => w.document.querySelector(selector);
  let cookie = '';
  w.fetch = async (url, options = {}) => {
    const response = await fetch(new URL(url, request.base), {...options, headers: {...options.headers, Cookie: cookie}});
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  w.AbortSignal = AbortSignal; w.confirm = () => true;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const file of ['model.js', 'app.js']) w.eval(fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'));
  await waitFor(() => !$('#auth-submit').disabled, '로그인 상태 확인 대기');
  assert.equal($('#project-content').hidden, true);
  $('#auth-name').value = '가팀원'; $('#auth-password').value = 'password-123!';
  $('#auth-form').dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
  await waitFor(() => !$('#team-screen').hidden && !$('#reload-teams').disabled && $('#team-list button'), '팀 목록 대기');
  $(`[data-open-team="${team.id}"]`).click();
  await waitFor(() => !$('#project-content').hidden && !$('#reload-data').disabled && $('#data-status').textContent.includes('불러왔'), '로그인/불러오기 실패');
  assert.equal($('#current-user-name').textContent, '가팀원');
  $('[data-tab="todos"]').click(); $('[data-new="todos"]').click();
  await waitFor(() => $('#editor').open, '투두 편집창 대기');
  const owner = $('#editor select[name="ownerId"]');
  assert.ok(owner); assert.equal(owner.options.length, 4);
  assert.equal(owner.querySelector(`option[value="${bob.id}"]`).textContent, '나팀원');
  owner.value = bob.id; $('#editor input[name="title"]').value = '화면 테스트';
  const today = w.ProjectModel.koreaDateKey(); $('#editor input[name="date"]').value = today;
  $('#edit-form').dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
  await waitFor(() => !$('#editor').open && $('#todo-list').textContent.includes('화면 테스트'), '투두 저장 실패');
  assert.equal(store.records.todos[0].ownerId, bob.id);
  assert.ok($('#calendar-grid').textContent.includes('화면 테스트'));
  $('#todo-list input[type="checkbox"]').click();
  await waitFor(() => store.records.todos[0].done && $('#calendar-grid .calendar-entry.done'), '완료 캘린더 연동 실패');
  $('[data-new="feedback"]').click(); await waitFor(() => $('#editor').open, '피드백 편집창 대기');
  $('#editor select[name="taskId"]').value = task.id;
  assert.equal($('#editor select[name="authorId"]'), null);
  const author = $('#editor [data-author-display]');
  assert.equal(author.value, alice.name); assert.equal(author.readOnly, true);
  $('#editor select[name="ownerId"]').value = bob.id; $('#editor textarea').value = '작성자 자동 지정';
  $('#edit-form').dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
  await waitFor(() => !$('#editor').open && store.records.feedback.length === 1, '피드백 저장 실패');
  assert.equal(store.records.feedback[0].authorId, alice.id);
  $('#logout').click(); await waitFor(() => $('#project-content').hidden && !$('#auth-submit').disabled, '로그아웃 실패');
  assert.equal(store.sessions.size, 0); assert.equal($('#current-user-name').textContent, '');
});
