'use strict';
const M = ProjectModel;
const $ = selector => document.querySelector(selector);
let today = M.koreaDateKey();
let baseMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1, 12);
let monthOffset = 0;
let selectedDate = today;
let data = M.empty();
let editing = null;
let currentUser = null;
let currentTeam = null;
let teams = [];
let teamEpoch = 0;
let invitation = null;
let users = [];
let tasks = [];
let feedbackTaskFilter = '';
const completionViews = new Map();
let authMode = 'login';
let myUrgentOnly = false;
let dateRefreshTimer;
let ready = false;
let busy = false;
let notificationTimer;
const names = {events: '일정', todos: '할 일', feedback: '피드백'};
function notify(message, persistent = false) {
  clearTimeout(notificationTimer);
  $('#notification').textContent = message;
  if (!persistent) notificationTimer = setTimeout(() => { $('#notification').textContent = ''; }, 3500);
}
async function request(url, options = {}) {
  const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), ...options, headers: {'Content-Type': 'application/json', ...options.headers}});
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) setCurrentUser(null);
    const error = new Error(body.message || '서버 요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return body;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button, input, select, textarea').forEach(element => {
    if (element.id === 'backup-local') return;
    if (value) {
      element.dataset.wasDisabled = String(element.disabled);
      element.disabled = true;
    } else {
      element.disabled = element.dataset.wasDisabled === 'true';
      delete element.dataset.wasDisabled;
    }
  });
  $('main').setAttribute('aria-busy', String(value));
}
async function loadData() {
  if (busy || !currentUser || !currentTeam) return;
  const teamId = currentTeam.id, epoch = teamEpoch;
  setBusy(true);
  $('#data-status').textContent = '데이터베이스에서 불러오는 중…';
  try {
    const [events, todos, feedback, members, taskList] = await Promise.all(['events', 'todos', 'feedback', 'users', 'tasks'].map(type => request(`/api/teams/${teamId}/${type}`)));
    if (epoch !== teamEpoch || currentTeam?.id !== teamId) return false;
    users = members;
    tasks = taskList;
    data = M.validate({events, todos, feedback});
    ready = true;
    $('#data-status').textContent = '데이터베이스에서 불러왔습니다.';
    return true;
  } catch (error) {
    if (epoch !== teamEpoch) return false;
    ready = false;
    $('#data-status').textContent = `불러오기 실패: ${error.message} 서버의 DATABASE_URL과 테이블을 확인한 뒤 다시 불러와 주세요.`;
    return false;
  } finally {
    setBusy(false);
    render();
  }
}
async function mutate(type, id, values, message, remove = false) {
  if (busy) return false;
  if (!ready || !currentTeam) { notify('팀을 선택하고 데이터를 불러와 주세요.'); return false; }
  const teamId = currentTeam.id, epoch = teamEpoch;
  setBusy(true);
  $('#data-status').textContent = '변경 내용을 저장하는 중…';
  try {
    const item = await request(`/api/teams/${teamId}/${type}${id ? `/${id}` : ''}`, {
      method: remove ? 'DELETE' : id ? 'PATCH' : 'POST',
      ...(remove ? {} : {body: JSON.stringify(values)})
    });
    if (epoch !== teamEpoch || currentTeam?.id !== teamId) return false;
    // 저장 성공 응답을 받은 뒤에만 화면과 캘린더를 함께 갱신합니다.
    data = {...data, [type]: remove ? data[type].filter(value => value.id !== id) : id ? data[type].map(value => value.id === id ? item : value) : [...data[type], item]};
    if (type === 'todos' && values?.done === true && myUrgentOnly && !$('#panel-mypage').hidden) {
      myUrgentOnly = false;
      message += ' 완료 목록을 볼 수 있도록 전체 내 투두를 표시했어요.';
    }
    notify(message);
    $('#data-status').textContent = '데이터베이스에 저장했습니다.';
    return true;
  } catch (error) {
    if (epoch !== teamEpoch) return false;
    $('#data-status').textContent = '저장에 실패했습니다. 다시 불러와 서버의 저장 결과를 확인해 주세요.';
    notify(`저장 확인 실패: ${error.message} 다시 불러와 저장 결과를 확인해 주세요.`, true);
    return false;
  } finally {
    setBusy(false);
    render();
  }
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function action(label, handler, className = '') {
  const button = node('button', className, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}
function formattedDate(value) {
  return new Intl.DateTimeFormat('ko-KR', {month: 'long', day: 'numeric', weekday: 'short'}).format(new Date(value + 'T12:00:00'));
}
function switchTab(tab, focus = false, alertsOnly = false) {
  if (!currentTeam) return;
  if (tab === 'mypage') myUrgentOnly = alertsOnly;
  refreshForDate();
  render();
  document.querySelectorAll('[data-tab]').forEach((button, index) => {
    const active = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active || (tab === 'mypage' && index === 0) ? 0 : -1;
    $(`#panel-${button.dataset.tab}`).hidden = !active;
    if (active && focus) button.focus();
  });
  $('#panel-mypage').hidden = tab !== 'mypage';
  $('#open-mypage').setAttribute('aria-pressed', String(tab === 'mypage'));
}
$('#open-mypage').addEventListener('click', () => switchTab('mypage'));
document.querySelectorAll('[data-tab]').forEach((button, index, buttons) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    let next;
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % buttons.length;
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); switchTab(buttons[next].dataset.tab, true); }
  });
});
function renderStats() {
  const stats = [ ['등록된 일정', data.events.length, '▦'], ['남은 할 일', data.todos.filter(item => !item.done).length, '☑'], ['확인할 피드백', data.feedback.filter(item => item.status !== '완료').length, '☷'] ];
  $('#stats').replaceChildren(...stats.map(([label, count, icon]) => {
    const card = node('div', 'stat');
    const content = node('div');
    content.append(node('span', 'stat-label', label), node('strong', '', String(count).padStart(2, '0')));
    const symbol = node('span', 'stat-icon', icon); symbol.setAttribute('aria-hidden', 'true');
    card.append(content, symbol); return card;
  }));
}
function renderCalendar() {
  const month = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + monthOffset, 1, 12);
  $('#month-title').textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
  $('#prev-month').disabled = monthOffset <= -1;
  $('#next-month').disabled = monthOffset >= 1;
  const grid = $('#calendar-grid'); grid.replaceChildren();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((month.getDay() + days) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const day = i - month.getDay() + 1;
    const cell = node('div', 'calendar-cell');
    if (day < 1 || day > days) { cell.classList.add('blank'); grid.append(cell); continue; }
    const date = M.dateKey(new Date(month.getFullYear(), month.getMonth(), day, 12));
    if (date === selectedDate) cell.classList.add('selected');
    const button = action(String(day), () => { selectedDate = date; renderCalendar(); renderDay(); $('#calendar-grid').querySelector(`[data-date="${date}"]`).focus(); }, 'date-button' + (date === today ? ' today' : ''));
    button.dataset.date = date;
    button.setAttribute('aria-label', `${formattedDate(date)}${date === today ? ', 오늘' : ''}`);
    button.setAttribute('aria-pressed', String(date === selectedDate));
    if (date === today) button.setAttribute('aria-current', 'date');
    cell.append(button);
    const items = M.itemsForDate(data, date);
    items.slice(0, 2).forEach(item => {
      const timeLabel = item.type === 'events' ? `${item.time || '종일'} · ` : '';
      const entry = action(`${item.done ? '✓ ' : ''}${timeLabel}${item.title}`, () => openEditor(item.type, item.id), `calendar-entry${item.type === 'todos' ? ' todo' : ''}${item.done ? ' done' : ''}`);
      entry.dataset.itemId = item.id;
      entry.title = `${names[item.type]}: ${timeLabel}${item.title} · ${item.owner}${item.ownerType === 'team' ? ' (팀 공통)' : ''}${item.type === 'todos' ? (item.done ? ' · 완료' : ' · 미완료') : ''}`;
      entry.setAttribute('aria-label', entry.title + ', 조회 및 수정');
      cell.append(entry);
    });
    if (items.length > 2) cell.append(action(`+${items.length - 2}개 더 보기`, () => {
      selectedDate = date; renderCalendar(); renderDay(); $('#selected-date-title').tabIndex = -1; $('#selected-date-title').focus();
    }, 'more-items'));
    grid.append(cell);
  }
}
function renderItem(type, item) {
  const deadline = type === 'todos' ? M.deadlineInfo(item, today) : null;
  const card = node('article', `item${item.done ? ' done' : ''}${deadline?.overdue ? ' overdue-item' : ''}`);
  card.dataset.itemId = item.id;
  if (type === 'todos') {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = item.done;
    checkbox.setAttribute('aria-label', `${item.title} 완료 여부`);
    checkbox.addEventListener('change', async () => {
      const done = checkbox.checked;
      checkbox.checked = item.done;
      if (!await mutate('todos', item.id, {done}, done ? '할 일을 완료했어요.' : '미완료로 변경했어요.')) checkbox.checked = item.done;
    });
    card.append(checkbox);
  }
  const content = node('div', 'item-content');
  const feedbackTitle = item.authorType === 'team' ? '팀의 피드백' : `${item.author}님의 피드백`;
  content.append(node('h3', 'item-title', type === 'feedback' ? item.taskTitle || '미분류' : item.title));
  const meta = node('div', 'item-meta');
  meta.append(node('span', '', `담당자 · ${item.owner}${item.ownerId || item.ownerType === 'team' ? '' : ' (기존 이름 · 미연결)'}`));
  if (item.ownerType === 'team') meta.append(node('span', 'pill team-pill', '팀 공통'));
  if (type === 'feedback') meta.append(node('span', '', `작성자 · ${item.author}${item.authorId || item.authorType === 'team' ? '' : ' (기존 이름 · 미연결)'}`));
  if (item.done || item.status === '완료') {
    meta.append(node('span', 'completion-time', M.completionDate(item) ? `완료 · ${new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23'}).format(new Date(item.completedAt))}` : '완료일 미상'));
  }
  if (type === 'events') meta.append(node('span', '', formattedDate(item.date)), node('span', 'pill event-time', item.time || '종일'), node('span', 'pill', '일정'));
  if (type === 'todos') {
    if (item.date) meta.append(node('span', '', `마감 · ${item.date}`));
    const badge = node('span', `pill deadline-pill${deadline.urgent ? ' urgent' : ''}${deadline.overdue ? ' overdue' : ''}${item.done ? ' completed' : ''}`);
    if (deadline.overdue) { const warning = node('span', 'warning-icon', '⚠ '); warning.setAttribute('aria-hidden', 'true'); badge.append(warning); }
    badge.append(document.createTextNode(deadline.label));
    meta.append(badge);
  }
  content.append(meta);
  if (item.description) content.append(node('p', 'item-description', item.description));
  card.append(content);
  const actions = node('div', 'item-actions');
  if (type === 'feedback') {
    const select = node('select', 'status-select'); select.setAttribute('aria-label', `${feedbackTitle} 상태`);
    M.statuses.forEach(status => { const option = node('option', '', status); option.value = status; select.append(option); });
    select.value = item.status;
    select.addEventListener('change', async () => {
      const status = select.value;
      select.value = item.status;
      if (!await mutate('feedback', item.id, {status}, '피드백 상태를 변경했어요.')) select.value = item.status;
    });
    actions.append(select);
  }
  actions.append(action('수정', () => openEditor(type, item.id)), action('삭제', () => {
    if (confirm(`이 ${names[type]}을(를) 삭제할까요? 삭제 후 되돌릴 수 없습니다.`)) mutate(type, item.id, null, '삭제했어요.', true);
  }, 'delete'));
  card.append(actions); return card;
}
function renderList(target, items, type, emptyText, hint = '위의 등록 버튼으로 새 항목을 추가해 보세요.') {
  target.replaceChildren();
  if (!items.length) { const empty = node('div', 'empty-state'); empty.append(node('strong', '', emptyText), node('span', '', hint)); target.append(empty); }
  else items.forEach(item => target.append(renderItem(type || item.type, item)));
}
function completedSection(key, items, type) {
  if (!completionViews.has(key)) completionViews.set(key, {open: false, period: 'this', date: M.addDays(M.weekRange(today).start, -7)});
  const view = completionViews.get(key);
  const details = node('details', 'completed-section'); details.dataset.completedScope = key;
  details.open = view.open;
  details.addEventListener('toggle', () => { if (details.isConnected) view.open = details.open; });
  details.append(node('summary', '', `완료된 목록 (${items.length}개)`));
  const controls = node('div', 'completion-controls');
  const label = node('label', 'field', '완료한 주');
  const select = node('select'); select.setAttribute('aria-label', '완료한 주');
  for (const [value, text] of [['this', '이번 주'], ['last', '지난주'], ['previous', '이전 주 선택'], ['unknown', '완료일 미상']]) {
    const option = node('option', '', text); option.value = value; select.append(option);
  }
  select.value = view.period;
  select.addEventListener('change', () => { view.open = details.open; view.period = select.value; render(); });
  label.append(select); controls.append(label);
  if (view.period === 'previous') {
    const dateLabel = node('label', 'field', '조회할 주에 속한 날짜');
    const input = node('input'); input.type = 'date'; input.value = view.date; input.min = '0001-01-01'; input.max = M.addDays(M.weekRange(today).start, -1);
    input.setAttribute('aria-label', '이전 주 날짜');
    input.addEventListener('change', () => {
      if (!M.validDate(input.value) || input.value > input.max) { input.setCustomValidity('이번 주 이전 날짜를 선택해 주세요.'); input.reportValidity(); return; }
      view.date = input.value; render();
    });
    dateLabel.append(input); controls.append(dateLabel);
  }
  const range = view.period === 'unknown' ? null : M.weekRange(view.period === 'last' ? M.addDays(today, -7) : view.period === 'previous' ? view.date : today);
  const shown = M.completedInPeriod(items, view.period, today, view.date);
  const count = node('p', 'completion-count', `${range ? `${range.start} ~ ${range.end} (한국 시간 · 월~일)` : '완료일 미상'} · ${shown.length}개`);
  count.setAttribute('role', 'status');
  const list = node('div', 'item-list completed-items');
  renderList(list, shown, type, range ? '선택한 주에 완료된 항목이 없어요.' : '완료일이 미상인 항목이 없어요.', '다른 주를 선택해 이전 완료 기록을 확인할 수 있어요.');
  details.append(controls, count, list);
  return details;
}
function renderTodoGroups(target, items, emptyText, hint, headingTag = 'h3', completedItems = items.filter(item => item.done)) {
  target.replaceChildren();
  const todos = M.sortedTodos(items.filter(item => !item.done));
  const group = node('section', 'todo-group'); group.dataset.todoGroup = 'open';
  group.append(node(headingTag, 'task-group-title', `미완료 (${todos.length})`));
  const list = node('div', 'item-list');
  renderList(list, todos, 'todos', !items.length ? emptyText : '미완료 항목이 없어요.', hint);
  group.append(list); target.append(group, completedSection(target.id, completedItems, 'todos'));
}
function renderTaskFilter() {
  if (!tasks.some(task => task.id === feedbackTaskFilter)) feedbackTaskFilter = '';
  const filter = $('#feedback-task-filter');
  const all = node('option', '', '전체'); all.value = '';
  filter.replaceChildren(all, ...tasks.map(task => { const option = node('option', '', task.title); option.value = task.id; return option; }));
  filter.value = feedbackTaskFilter;
}
function renderFeedback() {
  renderTaskFilter();
  const target = $('#feedback-list'); target.replaceChildren();
  const scoped = data.feedback.filter(item => !feedbackTaskFilter || item.taskId === feedbackTaskFilter);
  const groups = M.feedbackGroups(scoped.filter(item => item.status !== '완료'));
  if (!groups.length) {
    renderList(target, [], 'feedback', scoped.length ? '미완료·작업 중 피드백이 없어요.' : feedbackTaskFilter ? '이 업무에 등록된 피드백이 없어요.' : '아직 등록된 피드백이 없어요.');
  }
  groups.forEach(group => {
    const section = node('section', 'feedback-group'); section.dataset.taskId = group.taskId;
    const heading = node('div', 'feedback-group-heading');
    heading.append(node('h3', 'task-group-title', group.title), node('span', 'pill', `${group.items.length}개`));
    const list = node('div', 'item-list');
    renderList(list, group.items, 'feedback', '등록된 피드백이 없어요.');
    section.append(heading, list); target.append(section);
  });
  target.append(completedSection(target.id, scoped.filter(item => item.status === '완료'), 'feedback'));
}
$('#feedback-task-filter').addEventListener('change', event => { feedbackTaskFilter = event.target.value; renderFeedback(); });
function renderDay() {
  $('#selected-date-title').textContent = `${formattedDate(selectedDate)}의 일정`;
  renderList($('#day-items'), M.itemsForDate(data, selectedDate), null, '이 날짜에는 아직 일정이 없어요.');
}
function render() {
  renderStats(); renderCalendar(); renderDay();
  renderTodoGroups($('#todo-list'), data.todos, '아직 등록된 할 일이 없어요.');
  renderFeedback();
  renderMyPage();
  renderDeadlineBanner();
}
function renderMyPage() {
  $('#mypage-name').textContent = currentUser?.name || '';
  const mine = M.myTasks(data, currentUser?.id, currentTeam?.id);
  const todos = myUrgentOnly ? mine.todos.filter(item => { const info = M.deadlineInfo(item, today); return info.overdue || info.urgent; }) : mine.todos;
  $('#my-deadline-filter').setAttribute('aria-pressed', String(myUrgentOnly));
  $('#my-deadline-filter').textContent = myUrgentOnly ? '모든 내 투두 보기' : '마감 알림만 보기';
  renderTodoGroups($('#my-todo-list'), todos, myUrgentOnly ? '마감 알림에 해당하는 투두가 없어요.' : '배정된 투두가 없어요.', myUrgentOnly ? '모든 내 투두 보기로 전체 업무를 확인하세요.' : '담당자로 배정되면 여기에 표시됩니다.', 'h4', mine.todos.filter(item => item.done));
  const target = $('#my-feedback-list');
  renderList(target, mine.feedback.filter(item => item.status !== '완료'), 'feedback', mine.feedback.length ? '미완료·작업 중 피드백이 없어요.' : '배정된 피드백이 없어요.', '담당자로 배정되면 여기에 표시됩니다.');
  target.append(completedSection(target.id, mine.feedback.filter(item => item.status === '완료'), 'feedback'));
}
function renderDeadlineBanner() {
  const counts = M.deadlineCounts(data.todos, currentUser?.id, today, currentTeam?.id);
  const banner = $('#deadline-banner');
  banner.hidden = !currentUser || !currentTeam || !ready || counts.overdue + counts.urgent === 0;
  $('#deadline-banner-counts').textContent = `기한 초과 ${counts.overdue}개 · 마감 임박 ${counts.urgent}개`;
}
$('#deadline-banner').addEventListener('click', () => {
  switchTab('mypage', false, true);
  $('#mypage-title').focus();
  $('#mypage-title').scrollIntoView({block: 'start', behavior: 'auto'});
});
$('#my-deadline-filter').addEventListener('click', () => { myUrgentOnly = !myUrgentOnly; renderMyPage(); });
function refreshForDate() {
  const next = M.koreaDateKey();
  if (next === today) return false;
  if (selectedDate === today) selectedDate = next;
  today = next;
  baseMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1, 12);
  $('#today-label').textContent = `오늘 · ${formattedDate(today)}`;
  // 저장 중에도 날짜 표시를 갱신하되, 기존 요청이 끝날 때까지 편집은 잠급니다.
  const pending = busy;
  render();
  if (pending) document.querySelectorAll('button, input, select, textarea').forEach(element => {
    if (element.id !== 'backup-local' && element.dataset.wasDisabled === undefined) { element.dataset.wasDisabled = String(element.disabled); element.disabled = true; }
  });
  return true;
}
function scheduleDateRefresh() {
  clearTimeout(dateRefreshTimer);
  const now = Date.now();
  const nextMidnight = Date.parse(`${M.koreaDateKey()}T00:00:00+09:00`) + 86400000;
  dateRefreshTimer = setTimeout(() => { refreshForDate(); scheduleDateRefresh(); }, Math.max(100, nextMidnight - now + 50));
}
window.addEventListener('focus', () => { refreshForDate(); scheduleDateRefresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshForDate(); scheduleDateRefresh(); } });
window.addEventListener('pageshow', () => { refreshForDate(); scheduleDateRefresh(); });
function fillTaskSelect(select, selected = '') {
  const placeholder = node('option', '', tasks.length ? '업무를 선택하세요' : '새 업무를 먼저 추가해 주세요'); placeholder.value = '';
  select.replaceChildren(placeholder, ...tasks.map(task => { const option = node('option', '', task.title); option.value = task.id; return option; }));
  select.value = selected;
}
function taskEditorControls(select) {
  const tools = node('div', 'task-editor-tools');
  const creator = node('div', 'task-creator'); creator.hidden = true;
  const label = node('label', 'field', '새 업무 제목 *');
  const input = node('input'); input.type = 'text'; input.name = 'newTaskTitle'; input.maxLength = 200; input.placeholder = '현재 팀의 새 업무 제목';
  label.append(input);
  const message = node('p', 'task-create-message'); message.id = 'task-create-message'; message.setAttribute('role', 'status');
  const toggle = action('새 업무 추가', () => { creator.hidden = false; message.textContent = ''; input.focus(); }, 'subtle-button'); toggle.id = 'new-feedback-task';
  const add = action('업무 추가', async () => {
    if (busy || !currentTeam) return;
    const title = input.value.trim();
    if (!title) { message.textContent = '업무 제목을 입력해 주세요.'; input.focus(); return; }
    const epoch = teamEpoch, teamId = currentTeam.id;
    setBusy(true); message.textContent = '업무를 저장하는 중…';
    try {
      const result = await request(`/api/teams/${teamId}/tasks`, {method: 'POST', body: JSON.stringify({title})});
      if (epoch !== teamEpoch || currentTeam?.id !== teamId) return;
      tasks = [...tasks.filter(task => task.id !== result.task.id), result.task].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
      fillTaskSelect(select, result.task.id);
      message.textContent = result.message;
      creator.hidden = true; input.value = ''; select.focus();
      renderFeedback();
    } catch (error) { if (epoch === teamEpoch) message.textContent = `업무 추가 실패: ${error.message}`; }
    finally { setBusy(false); }
  }, 'primary'); add.id = 'save-feedback-task';
  creator.append(label, add, action('추가 취소', () => { creator.hidden = true; message.textContent = ''; input.value = ''; }, 'subtle-button'));
  tools.append(toggle, creator, message); return tools;
}
async function openEditor(type, id = null) {
  if (!ready || busy || !currentUser || !currentTeam) { notify('로그인 후 팀을 선택하고 데이터를 불러와 주세요.'); return; }
  setBusy(true);
  try {
    const [members, taskList] = await Promise.all([request(`/api/teams/${currentTeam.id}/users`), type === 'feedback' ? request(`/api/teams/${currentTeam.id}/tasks`) : Promise.resolve(tasks)]);
    users = members; tasks = taskList; renderTaskFilter();
  }
  catch (error) { notify(error.message); return; }
  finally { setBusy(false); }
  const item = id ? data[type].find(value => value.id === id) : null;
  editing = {type, id};
  $('#editor-title').textContent = `${names[type]} ${id ? '조회 · 수정' : '등록'}`;
  $('#form-error').textContent = '';
  $('#form-fields').replaceChildren();
  const fields = type === 'feedback' ? [['taskId', '업무 제목', 'task', true], ...M.fields[type]] : M.fields[type];
  fields.forEach(([key, label, inputType, required]) => {
    const field = node('label', 'field', label + (required ? ' *' : ' (선택)'));
    let input;
    if (key === 'taskId') {
      input = node('select'); input.name = key; input.required = true;
      fillTaskSelect(input, item?.taskId || '');
    } else if (key === 'author') {
      input = node('input'); input.type = 'text'; input.readOnly = true;
      input.dataset.authorDisplay = 'true';
      input.value = item ? `${item.author}${item.authorType === 'team' ? ' (기존 팀 작성자 · 유지)' : !item.authorId ? ' (기존 이름 · 미연결)' : ''}` : currentUser.name;
      input.setAttribute('aria-label', '작성자 (변경 불가)');
    } else if (key === 'owner') {
      const idKey = 'ownerId';
      const isTeam = item?.[`${key}Type`] === 'team';
      input = document.createElement('select');
      input.name = idKey;
      input.required = !item || isTeam || Boolean(item[idKey]);
      const placeholder = node('option', '', item && !item[idKey] && !isTeam ? `${item[key]} (기존 이름 유지 · 사용자 선택 시 연결)` : `${label}를 선택하세요`);
      placeholder.value = ''; input.append(placeholder);
      const team = node('option', '', '팀'); team.value = 'team'; input.append(team);
      users.forEach(user => { const option = node('option', '', user.name === '팀' ? '팀 (개인)' : user.name); option.value = user.id; input.append(option); });
      input.value = item ? (isTeam ? 'team' : item[idKey] || '') : '';
    } else {
      input = document.createElement(inputType === 'textarea' ? 'textarea' : 'input');
      if (inputType !== 'textarea') input.type = inputType;
      input.name = key;
      input.required = required;
      input.maxLength = inputType === 'textarea' ? 5000 : 200;
      if (inputType === 'date') { input.min = '0001-01-01'; input.max = '9999-12-31'; }
      if (inputType === 'time') { input.step = '60'; input.min = '00:00'; input.max = '23:59'; }
      input.value = item ? item[key] || '' : (type === 'events' && key === 'date' ? selectedDate : '');
      if (!['date', 'time'].includes(inputType)) input.placeholder = `${label}을(를) 입력하세요`;
    }
    input.addEventListener('input', () => input.setCustomValidity(''));
    field.append(input); $('#form-fields').append(field);
    if (key === 'taskId') $('#form-fields').append(taskEditorControls(input));
  });
  $('#editor').showModal();
}
document.querySelectorAll('[data-new]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.new)));
$('#close-editor').addEventListener('click', () => $('#editor').close());
$('#cancel-edit').addEventListener('click', () => $('#editor').close());
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const {type, id} = editing;
  try {
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const item = id ? data[type].find(value => value.id === id) : null;
    const values = M.normalize(type, {...raw, owner: raw.ownerId === 'team' ? '팀' : users.find(user => user.id === raw.ownerId)?.name || item?.owner || '', author: item?.author || currentUser.name});
    delete values.owner; delete values.author;
    if (type === 'feedback') {
      if (!raw.taskId || !tasks.some(task => task.id === raw.taskId)) throw new Error('업무 제목을 선택하거나 새 업무를 추가해 주세요.');
      values.taskId = raw.taskId;
    }
    for (const key of ['owner']) {
      const selected = raw[`${key}Id`];
      if (selected) { values[`${key}Type`] = selected === 'team' ? 'team' : 'user'; values[`${key}Id`] = selected === 'team' ? null : selected; }
    }
    if (await mutate(type, id, values, id ? '변경 내용을 저장했어요.' : `${names[type]}을(를) 등록했어요.`)) {
      if (type === 'feedback' && feedbackTaskFilter && feedbackTaskFilter !== values.taskId) { feedbackTaskFilter = values.taskId; renderFeedback(); }
      $('#editor').close();
    }
    else $('#form-error').textContent = '저장 결과를 확인하지 못했습니다. 다시 불러온 뒤 확인해 주세요.';
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#prev-month').addEventListener('click', () => { monthOffset = Math.max(-1, monthOffset - 1); renderCalendar(); });
$('#next-month').addEventListener('click', () => { monthOffset = Math.min(1, monthOffset + 1); renderCalendar(); });
$('#current-month').addEventListener('click', () => { monthOffset = 0; selectedDate = today; renderCalendar(); renderDay(); });
$('#reload-data').addEventListener('click', loadData);
$('#backup-local').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(M.KEY);
    if (raw === null) { notify('이 주소의 브라우저에 기존 localStorage 데이터가 없습니다. 이전에 사용한 주소에서 확인해 주세요.'); return; }
    let legacy;
    try { legacy = JSON.parse(raw); } catch { legacy = {unparsedLocalStorage: raw}; }
    const backup = {exportedAt: new Date().toISOString(), source: location.origin, storageKey: M.KEY, data: legacy};
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `moa-localStorage-backup-${today}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('기존 데이터를 JSON으로 내보냈습니다. 브라우저 원본은 유지됩니다.');
  } catch { notify('브라우저 저장소에 접근하지 못해 백업할 수 없습니다.', true); }
});
function setCurrentUser(user) {
  currentUser = user;
  $('#profile-bar').hidden = !user;
  $('#current-user-name').textContent = user?.name || '';
  $('#auth-screen').hidden = Boolean(user);
  teams = [];
  $('#team-list').replaceChildren();
  $('#teams-status').textContent = '';
  setCurrentTeam(null);
  if (!user) for (const id of ['create-team-dialog', 'join-team-dialog']) if ($(`#${id}`).open) $(`#${id}`).close();
}
function setCurrentTeam(team) {
  teamEpoch++;
  completionViews.clear();
  currentTeam = team;
  ready = false; data = M.empty(); users = []; tasks = []; feedbackTaskFilter = ''; myUrgentOnly = false;
  monthOffset = 0; selectedDate = today;
  if ($('#editor').open) $('#editor').close();
  notify('');
  $('#project-content').hidden = !team;
  $('#team-screen').hidden = !currentUser || Boolean(team);
  $('#project-nav').hidden = !team;
  $('#open-mypage').hidden = !team;
  $('.mypage-separator').hidden = !team;
  $('#open-mypage').setAttribute('aria-pressed', 'false');
  $('#header-team-name').textContent = team?.name || '내 팀 목록';
  $('#sidebar-team-name').textContent = team?.name || '내 팀 목록';
  $('#current-team-name').textContent = team?.name || '';
  $('#current-team-description').textContent = team?.description || '';
  $('#team-invite').replaceChildren();
  if (team?.isOwner && team.inviteCode) $('#team-invite').append(inviteControl(team.inviteCode));
  $('#switch-team').replaceChildren(...teams.map(item => { const option = node('option', '', item.name); option.value = item.id; return option; }));
  $('#switch-team').value = team?.id || '';
  $('#server-result').textContent = '버튼을 누르면 서버를 통해 Neon 연결을 확인합니다.';
  render();
  if (team) switchTab('calendar');
}
function inviteControl(code) {
  const container = node('div', 'invite-control');
  const input = node('input'); input.value = code; input.readOnly = true;
  input.setAttribute('aria-label', '팀 초대 코드');
  const copy = action('초대 코드 복사', async () => {
    try { await navigator.clipboard.writeText(code); notify('초대 코드를 복사했어요.'); }
    catch { input.focus(); input.select(); notify('초대 코드를 선택했어요. 복사해서 팀원에게 전달하세요.'); }
  }, 'subtle-button');
  container.append(node('label', '', '대표용 초대 코드 · 함께할 팀원에게 공유하세요.'), input, copy);
  return container;
}
function renderTeams() {
  const list = $('#team-list'); list.replaceChildren();
  if (!teams.length) {
    const empty = node('div', 'empty-state');
    empty.append(node('strong', '', '아직 가입한 팀이 없어요.'), node('span', '', '팀을 만들거나 초대 코드로 가입해 주세요.'));
    list.append(empty); return;
  }
  teams.forEach(team => {
    const card = node('article', 'team-card'); card.dataset.teamId = team.id;
    card.append(node('span', 'pill' + (team.isOwner ? ' team-pill' : ''), team.isOwner ? '대표' : '팀원'), node('h2', '', team.name), node('p', '', team.description || '등록된 팀 설명이 없습니다.'));
    const open = action('팀 들어가기 →', () => selectTeam(team.id), 'primary'); open.dataset.openTeam = team.id;
    card.append(open);
    if (team.isOwner && team.inviteCode) card.append(inviteControl(team.inviteCode));
    list.append(card);
  });
}
async function loadTeams() {
  if (busy || !currentUser) return;
  const userId = currentUser.id;
  setBusy(true); $('#teams-status').textContent = '내 팀 목록을 불러오는 중…';
  try {
    const result = await request('/api/teams');
    if (currentUser?.id !== userId) return;
    teams = result; renderTeams();
    $('#teams-status').textContent = `가입한 팀 ${teams.length}개`;
  } catch (error) {
    teams = []; $('#team-list').replaceChildren();
    $('#teams-status').textContent = `팀 목록 불러오기 실패: ${error.message} 목록 다시 불러오기를 눌러 주세요.`;
  } finally { setBusy(false); }
}
async function selectTeam(teamId) {
  if (busy || !currentUser) return;
  // 이전 팀의 항목·알림을 먼저 비워 지연 응답이 다른 팀에 나타나지 않게 합니다.
  setCurrentTeam(null);
  setBusy(true); $('#teams-status').textContent = '선택한 팀을 확인하는 중…';
  let team;
  try { team = await request(`/api/teams/${teamId}`); }
  catch (error) { $('#teams-status').textContent = error.message; }
  finally { setBusy(false); }
  if (!team || !currentUser) return;
  setCurrentTeam(team);
  await loadData();
}
$('#back-teams').addEventListener('click', async () => { if (busy) return; setCurrentTeam(null); await loadTeams(); });
$('#switch-team').addEventListener('change', event => selectTeam(event.target.value));
$('#reload-teams').addEventListener('click', loadTeams);
$('#new-team').addEventListener('click', () => { $('#create-team-form').reset(); $('#create-team-error').textContent = ''; $('#create-team-dialog').showModal(); });
$('#join-team').addEventListener('click', () => {
  $('#preview-team-form').reset(); invitation = null;
  $('#team-preview').replaceChildren(); $('#join-team-error').textContent = ''; $('#confirm-join').hidden = true;
  $('#join-team-dialog').showModal();
});
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.closeDialog}`).close()));
$('#create-team-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const body = Object.fromEntries(new FormData(event.currentTarget));
  setBusy(true); let created = false;
  try {
    await request('/api/teams', {method: 'POST', body: JSON.stringify(body)});
    $('#create-team-dialog').close(); created = true;
  } catch (error) { $('#create-team-error').textContent = error.message; }
  finally { setBusy(false); }
  if (created) { await loadTeams(); notify('팀을 만들었어요. 초대 코드를 공유하고 팀에 들어가세요.'); }
});
$('#invite-code').addEventListener('input', () => { invitation = null; $('#confirm-join').hidden = true; $('#team-preview').replaceChildren(); $('#join-team-error').textContent = ''; });
$('#preview-team-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const code = $('#invite-code').value.trim();
  invitation = null; $('#confirm-join').hidden = true; $('#team-preview').replaceChildren(); $('#join-team-error').textContent = '';
  setBusy(true);
  try {
    const team = await request('/api/teams/invitations/preview', {method: 'POST', body: JSON.stringify({inviteCode: code})});
    if ($('#invite-code').value.trim() !== code) return;
    $('#team-preview').append(node('h3', '', team.name), node('p', '', team.description || '등록된 팀 설명이 없습니다.'));
    if (team.alreadyMember) $('#join-team-error').textContent = '이미 가입한 팀입니다. 내 팀 목록에서 선택해 주세요.';
    else { invitation = {teamId: team.id, inviteCode: code}; $('#confirm-join').hidden = false; }
  } catch (error) { $('#join-team-error').textContent = error.message; }
  finally { setBusy(false); }
});
$('#confirm-join').addEventListener('click', async () => {
  if (busy || !invitation || invitation.inviteCode !== $('#invite-code').value.trim()) return;
  setBusy(true); let joined = false;
  try {
    await request('/api/teams/join', {method: 'POST', body: JSON.stringify(invitation)});
    $('#join-team-dialog').close(); joined = true;
  } catch (error) { $('#join-team-error').textContent = error.message; }
  finally { setBusy(false); }
  if (joined) { await loadTeams(); notify('팀에 가입했어요. 목록에서 팀을 선택하세요.'); }
});
function selectAuthMode(mode) {
  authMode = mode;
  $('#mode-login').setAttribute('aria-pressed', String(mode === 'login'));
  $('#mode-register').setAttribute('aria-pressed', String(mode === 'register'));
  $('#auth-submit').textContent = mode === 'login' ? '로그인' : '회원가입';
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-password').value = '';
  $('#auth-message').textContent = mode === 'login' ? '이름은 로그인 아이디와 프로필 이름으로 사용됩니다.' : '같은 이름으로 중복 가입할 수 없습니다. 비밀번호는 8~128자로 입력하세요.';
}
$('#mode-login').addEventListener('click', () => selectAuthMode('login'));
$('#mode-register').addEventListener('click', () => selectAuthMode('register'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const body = {name: $('#auth-name').value, password: $('#auth-password').value};
  setBusy(true);
  let signedIn = false;
  try {
    const response = await request(`/api/auth/${authMode}`, {method: 'POST', body: JSON.stringify(body)});
    $('#auth-password').value = '';
    if (authMode === 'register') { selectAuthMode('login'); $('#auth-message').textContent = '회원가입을 완료했습니다. 같은 이름과 비밀번호로 로그인하세요.'; }
    else { setCurrentUser(response.user); signedIn = true; notify(`${response.user.name}님, 로그인했어요.`); }
  } catch (error) { $('#auth-message').textContent = error.message; }
  finally { setBusy(false); }
  if (signedIn) await loadTeams();
});
$('#logout').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await request('/api/auth/logout', {method: 'POST', body: '{}'});
    setCurrentUser(null); selectAuthMode('login'); notify('로그아웃했습니다.');
  } catch (error) { notify(`로그아웃하지 못했습니다. ${error.message}`); }
  finally { setBusy(false); render(); }
});
async function restoreSession() {
  setBusy(true);
  $('#auth-message').textContent = '로그인 상태를 확인하고 있어요…';
  let signedIn = false;
  try { const response = await request('/api/auth/me'); setCurrentUser(response.user); signedIn = true; }
  catch (error) { setCurrentUser(null); $('#auth-message').textContent = error.status === 401 ? '이름과 비밀번호로 로그인하세요.' : `${error.message} 서버와 인증 테이블 설정을 확인해 주세요.`; }
  finally { setBusy(false); }
  if (signedIn) await loadTeams();
}
$('#link-legacy').addEventListener('click', async () => {
  if (busy || !currentUser || !currentTeam) return;
  if (!confirm('기존 담당자 이름과 현재 팀원의 이름이 일치하는 항목의 담당자만 연결할까요? 기존 작성자는 변경하지 않습니다.')) return;
  setBusy(true);
  try {
    const counts = await request(`/api/teams/${currentTeam.id}/users/link-legacy`, {method: 'POST', body: '{}'});
    notify(`연결 완료: 일정 ${counts.events}개, 할 일 ${counts.todos}개, 피드백 ${counts.feedback}개`);
  } catch (error) { notify(error.message); }
  finally { setBusy(false); }
  await loadData();
});
$('#today-label').textContent = `오늘 · ${formattedDate(today)}`;
render();
scheduleDateRefresh();
restoreSession();

$('#test-server').addEventListener('click', async () => {
  const button = $('#test-server');
  const result = $('#server-result');
  button.disabled = true;
  result.textContent = '서버에 요청을 보내고 있어요…';
  try {
    const response = await fetch('/api/health', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.success !== true || body.database !== 'connected') {
      throw new Error('응답 형식 오류');
    }
    result.textContent = `${body.message} (HTTP ${response.status} · ${new Date().toLocaleString('ko-KR')})`;
  } catch {
    result.textContent = '데이터베이스 연결을 확인하지 못했습니다. 서버 실행, DATABASE_URL, Neon 연결 상태를 확인해 주세요.';
  } finally {
    button.disabled = false;
  }
});
