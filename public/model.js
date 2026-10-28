/* UI와 분리한 데이터 규칙. 브라우저와 Node 테스트에서 함께 사용합니다. */
(function (root) {
  'use strict';
  const KEY = 'moa-team-project-v1';
  const statuses = ['미완료', '작업 중', '완료'];
  const fields = {
    events: [['title', '일정 제목', 'text', true], ['owner', '담당자', 'text', true], ['date', '날짜 (한국 시간)', 'date', true], ['time', '시간 (한국 시간 · 비워 두면 종일)', 'time', false], ['description', '내용', 'textarea', true]],
    todos: [['title', '할 일', 'text', true], ['owner', '담당자', 'text', true], ['date', '마감일', 'date', false]],
    feedback: [['author', '작성자', 'text', true], ['owner', '담당자', 'text', true], ['description', '피드백 내용', 'textarea', true]]
  };
  const empty = () => ({events: [], todos: [], feedback: []});
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00');
    return !Number.isNaN(date.getTime()) && dateKey(date) === value;
  }
  function normalize(type, values) {
    if (!fields[type]) throw new Error('알 수 없는 데이터입니다.');
    const record = {};
    for (const [key, label, inputType, required] of fields[type]) {
      const value = typeof values[key] === 'string' ? values[key].trim() : '';
      if (required && !value) throw new Error(`${label}을(를) 입력해 주세요.`);
      if (inputType === 'date' && value && !validDate(value)) throw new Error('올바른 날짜를 입력해 주세요.');
      if (inputType === 'time' && value && !validTime(value)) throw new Error('시간은 24시간제 HH:mm 형식으로 입력해 주세요.');
      record[key] = value;
    }
    return record;
  }
  function validate(data) {
    if (!data || typeof data !== 'object') throw new Error('저장 데이터 형식 오류');
    const result = empty();
    const ids = new Set();
    for (const type of Object.keys(fields)) {
      if (!Array.isArray(data[type])) throw new Error('저장 데이터 형식 오류');
      result[type] = data[type].map(item => {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('저장 항목 오류');
        ids.add(item.id);
        const record = {id: item.id, ...normalize(type, item)};
        if (Object.hasOwn(item, 'ownerId')) record.ownerId = item.ownerId;
        if (Object.hasOwn(item, 'ownerType')) record.ownerType = item.ownerType;
        if (type === 'feedback' && Object.hasOwn(item, 'authorId')) record.authorId = item.authorId;
        if (type === 'feedback' && Object.hasOwn(item, 'authorType')) record.authorType = item.authorType;
        if (type === 'feedback') for (const key of ['taskId', 'taskTitle']) if (Object.hasOwn(item, key)) record[key] = item[key];
        if (Object.hasOwn(item, 'createdAt')) record.createdAt = item.createdAt;
        if (type !== 'events' && Object.hasOwn(item, 'completedAt')) record.completedAt = item.completedAt || null;
        if (Object.hasOwn(item, 'teamId')) record.teamId = item.teamId;
        if (type === 'todos') {
          if (typeof item.done !== 'boolean') throw new Error('완료 상태 오류');
          record.done = item.done;
        }
        if (type === 'feedback') {
          if (!statuses.includes(item.status)) throw new Error('피드백 상태 오류');
          record.status = item.status;
        }
        return record;
      });
    }
    return result;
  }
  function sortedTodos(todos) {
    return [...todos].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
  }
  function sortedFeedback(feedback) {
    return [...feedback].sort((a, b) => Number(a.status === '완료') - Number(b.status === '완료') || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }
  function feedbackGroups(feedback, taskId = '') {
    const groups = new Map();
    for (const item of feedback) {
      if (taskId && item.taskId !== taskId) continue;
      const key = item.taskId || '';
      if (!groups.has(key)) groups.set(key, {taskId: key, title: item.taskTitle || '미분류', items: []});
      groups.get(key).items.push(item);
    }
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.taskId.localeCompare(b.taskId))
      .map(group => ({...group, items: sortedFeedback(group.items)}));
  }
  function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function sortedEvents(events) {
    return [...events].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  }
  function assignedTo(item, userId) { return Boolean(userId) && (item.ownerType === 'team' || item.ownerId === userId); }
  function itemsForDate(data, date) {
    return [...sortedEvents(data.events).filter(item => item.date === date).map(item => ({...item, type: 'events'})), ...sortedTodos(data.todos).filter(item => item.date === date).map(item => ({...item, type: 'todos'}))];
  }
  const koreaFormatter = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'});
  function koreaDateKey(instant = new Date()) {
    const parts = Object.fromEntries(koreaFormatter.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function deadlineInfo(todo, today = koreaDateKey()) {
    if (todo.done) return {label: '완료', urgent: false, overdue: false, days: null};
    if (!todo.date) return {label: '마감일 없음', urgent: false, overdue: false, days: null};
    const days = Math.round((Date.parse(`${todo.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return {
      label: days < 0 ? `기한 초과 ${-days}일` : days === 0 ? 'D-DAY' : `D-${days}`,
      urgent: days >= 0 && days <= 3,
      overdue: days < 0,
      days
    };
  }
  function addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  }
  function weekRange(date = koreaDateKey()) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const start = addDays(date, -((day + 6) % 7));
    return {start, end: addDays(start, 6)};
  }
  function completionDate(item) {
    const instant = typeof item.completedAt === 'string' ? new Date(item.completedAt) : new Date(NaN);
    return Number.isFinite(instant.getTime()) ? koreaDateKey(instant) : null;
  }
  function completedInPeriod(items, period = 'this', date = koreaDateKey(), previousDate) {
    const range = period === 'unknown' ? null : weekRange(period === 'last' ? addDays(date, -7) : period === 'previous' && validDate(previousDate || '') ? previousDate : date);
    return items.filter(item => {
      const day = completionDate(item);
      return !range ? !day : Boolean(day && day >= range.start && day <= range.end);
    }).sort((a, b) => (Date.parse(b.completedAt) || 0) - (Date.parse(a.completedAt) || 0) || a.id.localeCompare(b.id));
  }
  function myTasks(data, userId, teamId) {
    if (!userId) return {todos: [], feedback: []};
    // 배열만 정렬하며, 각 항목은 전체 탭에서 사용하는 동일한 원본 객체입니다.
    const todos = sortedTodos(data.todos.filter(item => (!teamId || item.teamId === teamId) && assignedTo(item, userId)));
    const feedback = sortedFeedback(data.feedback.filter(item => (!teamId || item.teamId === teamId) && assignedTo(item, userId)));
    return {todos, feedback};
  }
  function deadlineCounts(todos, userId, today = koreaDateKey(), teamId) {
    const counts = {overdue: 0, urgent: 0};
    if (!userId) return counts;
    todos.filter(item => (!teamId || item.teamId === teamId) && assignedTo(item, userId)).forEach(item => {
      const info = deadlineInfo(item, today);
      if (info.overdue) counts.overdue++;
      else if (info.urgent) counts.urgent++;
    });
    return counts;
  }
  const api = {KEY, statuses, fields, empty, dateKey, validDate, validTime, normalize, validate, sortedTodos, sortedFeedback, feedbackGroups, sortedEvents, assignedTo, itemsForDate, koreaDateKey, deadlineInfo, myTasks, deadlineCounts, addDays, weekRange, completionDate, completedInPeriod};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProjectModel = api;
})(globalThis);
