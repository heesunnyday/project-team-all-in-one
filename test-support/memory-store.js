'use strict';
const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const M = require('../public/model');
const {createApp} = require('../server');
const {digest} = require('../auth');
function memoryStore() {
  const records = M.empty();
  const users = new Map();
  const sessions = new Map();
  const attempts = new Map();
  const teams = new Map(), members = new Map();
  const tasks = new Map();
  const teamView = (team, userId) => ({id: team.id, name: team.name, description: team.description, ownerId: team.ownerId, isOwner: team.ownerId === userId, inviteCode: team.ownerId === userId ? team.inviteCode : null});
  const translate = record => {
    const item = {...record};
    if (Object.hasOwn(item, 'owner_id')) { item.ownerId = item.owner_id; delete item.owner_id; }
    if (Object.hasOwn(item, 'author_id')) { item.authorId = item.author_id; delete item.author_id; }
    if (Object.hasOwn(item, 'task_id')) { item.taskId = item.task_id; item.taskTitle = tasks.get(item.taskId)?.title; delete item.task_id; }
    for (const key of ['owner', 'author']) if (Object.hasOwn(item, `${key}_is_team`)) { item[`${key}Type`] = item[`${key}_is_team`] ? 'team' : 'user'; delete item[`${key}_is_team`]; }
    if (Object.hasOwn(item, 'start_time')) { item.time = item.start_time || ''; delete item.start_time; }
    return item;
  };
  return {
    records, users, sessions, attempts, teams, members, tasks,
    now: () => new Date().toISOString(),
    async health() { return true; },
    async list(type, teamId, taskId) { const rows = records[type].filter(item => item.teamId === teamId && (!taskId || item.taskId === taskId)); return type === 'todos' ? M.sortedTodos(rows) : type === 'events' ? M.sortedEvents(rows) : M.sortedFeedback(rows); },
    async get(type, id, teamId) { return records[type].find(item => item.id === id && item.teamId === teamId); },
    async create(type, item, teamId) { const record = {...translate(item), teamId, id: randomUUID(), ...(type === 'feedback' ? {createdAt: this.now()} : {}), ...(type !== 'events' ? {completedAt: (item.done || item.status === '완료') ? this.now() : null} : {})}; records[type].push(record); return record; },
    async update(type, id, values, teamId) {
      const item = records[type].find(row => row.id === id && row.teamId === teamId);
      if (item) {
        const key = type === 'todos' ? 'done' : type === 'feedback' ? 'status' : null;
        if (key && Object.hasOwn(values, key)) {
          const done = type === 'todos' ? values.done : values.status === '완료';
          const wasDone = type === 'todos' ? item.done : item.status === '완료';
          item.completedAt = done ? wasDone ? item.completedAt || null : this.now() : null;
        }
        Object.assign(item, translate(values));
      }
      return item;
    },
    async remove(type, id, teamId) { const index = records[type].findIndex(row => row.id === id && row.teamId === teamId); if (index < 0) return false; records[type].splice(index, 1); return true; },
    async createUser(name, nameKey, passwordHash) {
      if ([...users.values()].some(user => user.name_key === nameKey)) { const error = new Error('duplicate'); error.code = '23505'; throw error; }
      const user = {id: randomUUID(), name, name_key: nameKey, password_hash: passwordHash}; users.set(user.id, user); return user;
    },
    async findUserByName(key) { return [...users.values()].find(user => user.name_key === key); },
    async getUser(id) { const u = users.get(id); return u ? {id: u.id, name: u.name} : null; },
    async listTasks(teamId) { return [...tasks.values()].filter(task => task.teamId === teamId).sort((a, b) => a.title.localeCompare(b.title)); },
    async getTask(teamId, id) { const task = tasks.get(id); return task?.teamId === teamId ? task : null; },
    async createTask(teamId, title) {
      const found = [...tasks.values()].find(task => task.teamId === teamId && task.title === title);
      if (found) return {task: found, created: false};
      const task = {id: randomUUID(), teamId, title}; tasks.set(task.id, task); return {task, created: true};
    },
    async listUsers(teamId) { return [...users.values()].filter(user => members.get(teamId)?.has(user.id)).map(({id, name}) => ({id, name})); },
    async getTeamUser(teamId, userId) { const u = users.get(userId); return u && members.get(teamId)?.has(userId) ? {id: u.id, name: u.name} : null; },
    async listTeams(userId) { return [...teams.values()].filter(team => members.get(team.id)?.has(userId)).map(team => teamView(team, userId)); },
    async getTeamForUser(teamId, userId) { const team = teams.get(teamId); return team && members.get(teamId)?.has(userId) ? teamView(team, userId) : null; },
    async createTeam(name, description, ownerId, inviteCode) { const team = {id: randomUUID(), name, description, ownerId, inviteCode}; teams.set(team.id, team); members.set(team.id, new Set([ownerId])); return teamView(team, ownerId); },
    async findTeamByInvite(code, userId) { const team = [...teams.values()].find(team => team.inviteCode === code); return team ? {id: team.id, name: team.name, description: team.description, alreadyMember: members.get(team.id)?.has(userId) || false} : null; },
    async addTeamMember(teamId, userId) { const set = members.get(teamId); if (!set || set.has(userId)) return false; set.add(userId); return true; },
    async createSession(hash, userId, expiresAt) { sessions.set(hash, {userId, expiresAt}); },
    async findSession(hash) { const s = sessions.get(hash); return s && Date.parse(s.expiresAt) > Date.now() ? users.get(s.userId) : null; },
    async deleteSession(hash) { sessions.delete(hash); },
    async consumeAuthAttempt(key, max) { const n = (attempts.get(key) || 0) + 1; attempts.set(key, n); return n <= max; },
    async linkLegacyUsers(teamId) {
      const counts = {events: 0, todos: 0, feedback: 0};
      for (const type of Object.keys(records)) for (const item of records[type]) {
        if (item.teamId !== teamId) continue;
        let changed = false;
        for (const [textKey, idKey] of [['owner', 'ownerId']]) {
          const u = [...users.values()].find(user => members.get(teamId)?.has(user.id) && user.name_key === item[textKey].trim().toLowerCase());
          if (item[`${textKey}Type`] !== 'team' && !item[idKey] && u) { item[idKey] = u.id; changed = true; }
        }
        if (changed) counts[type]++;
      }
      return counts;
    }
  };
}
async function start(t, store = memoryStore(), options) {
  const server = createApp(store, options).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', Cookie: cookie, ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };
  request.cookie = () => cookie;
  request.setCookie = value => { cookie = value; };
  request.base = base;
  request.forTeam = teamId => (route, ...args) => request(`/api/teams/${teamId}${route.replace(/^\/api/, '')}`, ...args);
  return {request, store};
}
async function signInFixture(request, store, name = '테스트 팀원', withTeam = true) {
  const user = await store.createUser(name, name.toLowerCase(), 'fixture-only');
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await store.createSession(digest(token), user.id, new Date(Date.now() + 60000).toISOString());
  request.setCookie(`project_session=${token}`);
  if (withTeam) {
    if (!store.fixtureTeam) store.fixtureTeam = await store.createTeam('테스트 프로젝트', '', user.id, randomUUID().replaceAll('-', ''));
    await store.addTeamMember(store.fixtureTeam.id, user.id);
    if (!store.fixtureTask) store.fixtureTask = (await store.createTask(store.fixtureTeam.id, '테스트 업무')).task;
  }
  return user;
}
module.exports = {memoryStore, start, signInFixture};
