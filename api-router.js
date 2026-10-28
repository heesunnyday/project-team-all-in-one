'use strict';
const express = require('express');
const M = require('./public/model');
const {createAuth} = require('./auth');
const {randomBytes} = require('node:crypto');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message) { const error = new Error(message); error.status = 400; error.publicMessage = message; throw error; }
function validateBody(type, body, patch = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('JSON 객체를 보내 주세요.');
  const fields = M.fields[type].filter(([key]) => !['owner', 'author'].includes(key));
  const allowed = [...fields.map(([key]) => key), 'ownerId', 'ownerType', ...(type === 'todos' ? ['done'] : type === 'feedback' ? ['status', 'authorId', 'authorType', 'taskId'] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) invalid('지원하지 않는 필드입니다. 담당자는 사용자 ID로 선택하고 작성자는 자동 지정됩니다.');
  if (patch && !Object.keys(body).length) invalid('변경할 값을 입력해 주세요.');
  const record = {};
  for (const [key, label, inputType, required] of fields) {
    if (patch && !Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== 'string' && !(!required && body[key] === undefined)) invalid(`${label}을(를) 문자열로 입력해 주세요.`);
    const value = (body[key] || '').trim();
    if (required && !value) invalid(`${label}을(를) 입력해 주세요.`);
    if (value.length > (inputType === 'textarea' ? 5000 : 200)) invalid(`${label}의 입력 길이를 초과했습니다.`);
    if (inputType === 'date' && value && !M.validDate(value)) invalid('올바른 날짜를 입력해 주세요.');
    if (inputType === 'time' && value && !M.validTime(value)) invalid('시간은 24시간제 HH:mm 형식으로 입력해 주세요.');
    record[key === 'time' ? 'start_time' : key] = key === 'time' ? value || null : value;
  }
  // 작성자 요청 필드는 호환성을 위해 받되 해석하거나 저장하지 않습니다.
  for (const key of ['owner']) {
    const idKey = `${key}Id`, typeKey = `${key}Type`;
    if (patch && !Object.hasOwn(body, idKey) && !Object.hasOwn(body, typeKey)) continue;
    const selection = body[typeKey] ?? 'user';
    if (!['user', 'team'].includes(selection) || (Object.hasOwn(body, typeKey) && body[typeKey] == null)) invalid('개인 사용자 또는 팀을 선택해 주세요.');
    if (selection === 'team') {
      if (body[idKey] !== undefined && body[idKey] !== null) invalid('팀 선택에는 개인 사용자 ID를 지정할 수 없습니다.');
      record[`${key}_id`] = null;
      record[`${key}_is_team`] = true;
      record[key] = '팀';
    } else {
      if (typeof body[idKey] !== 'string' || !uuid.test(body[idKey])) invalid(`가입한 ${key === 'owner' ? '담당자' : '작성자'}를 선택해 주세요.`);
      record[`${key}_id`] = body[idKey];
      record[`${key}_is_team`] = false;
    }
  }
  if (type === 'todos' && (!patch || Object.hasOwn(body, 'done'))) {
    if (body.done !== undefined && typeof body.done !== 'boolean') invalid('완료 여부는 true 또는 false여야 합니다.');
    record.done = body.done ?? false;
  }
  if (type === 'feedback' && (!patch || Object.hasOwn(body, 'status'))) {
    if (body.status !== undefined && !M.statuses.includes(body.status)) invalid('올바른 피드백 상태를 선택해 주세요.');
    record.status = body.status ?? '미완료';
  }
  if (type === 'feedback' && (!patch || Object.hasOwn(body, 'taskId'))) {
    if (typeof body.taskId !== 'string' || !uuid.test(body.taskId)) invalid('업무 제목을 선택하거나 새 업무를 추가해 주세요.');
    record.task_id = body.taskId;
  }
  return record;
}
function createApiRouter(repository, authOptions) {
  const router = express.Router();
  const auth = createAuth(repository, authOptions);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expected)) return res.status(403).json({success: false, message: '같은 앱 화면에서 요청해 주세요.'});
      // DELETE처럼 본문이 없는 JSON 요청도 허용합니다. req.is()는 본문이 없으면 null입니다.
      if ((req.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(415).json({success: false, message: 'application/json 형식으로 요청해 주세요.'});
    }
    next();
  });
  router.get('/test', (req, res) => res.json({success: true, message: 'Express 서버와 정상적으로 연결되었습니다.', timestamp: new Date().toISOString()}));
  router.use('/auth', auth.router);
  router.use(auth.requireUser);
  router.get('/health', async (req, res) => { await repository.health(); res.json({success: true, database: 'connected', message: 'Neon PostgreSQL에 연결되었습니다.'}); });
  router.get('/teams', async (req, res) => res.json(await repository.listTeams(req.user.id)));
  router.post('/teams', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['name', 'description'].includes(key))) invalid('팀 이름과 설명을 입력해 주세요.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) invalid('팀 이름은 공백을 제외한 1~100자로 입력해 주세요.');
    if (body.description !== undefined && typeof body.description !== 'string') invalid('팀 설명을 문자열로 입력해 주세요.');
    const description = (body.description || '').trim();
    if (description.length > 1000) invalid('팀 설명은 1000자 이내로 입력해 주세요.');
    const team = await repository.createTeam(name, description, req.user.id, randomBytes(24).toString('base64url'));
    res.status(201).json(team);
  });
  async function invitedTeam(req) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['inviteCode', 'teamId'].includes(key))) invalid('초대 코드를 입력해 주세요.');
    const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) invalid('초대 코드를 확인해 주세요.');
    const team = await repository.findTeamByInvite(code, req.user.id);
    if (!team) return null;
    return team;
  }
  router.post('/teams/invitations/preview', async (req, res) => {
    const team = await invitedTeam(req);
    if (!team) return res.status(404).json({success: false, message: '일치하는 초대 코드가 없습니다.'});
    res.json(team);
  });
  router.post('/teams/join', async (req, res) => {
    const team = await invitedTeam(req);
    if (!team) return res.status(404).json({success: false, message: '일치하는 초대 코드가 없습니다.'});
    if (req.body.teamId !== team.id) invalid('팀 이름을 확인한 뒤 다시 가입해 주세요.');
    if (!await repository.addTeamMember(team.id, req.user.id)) return res.status(409).json({success: false, message: '이미 가입한 팀입니다.'});
    res.status(201).json(await repository.getTeamForUser(team.id, req.user.id));
  });
  const project = express.Router({mergeParams: true});
  router.use('/teams/:teamId', async (req, res, next) => {
    if (!uuid.test(req.params.teamId)) return res.status(400).json({success: false, message: '올바른 팀 ID가 아닙니다.'});
    const team = await repository.getTeamForUser(req.params.teamId, req.user.id);
    if (!team) return res.status(403).json({success: false, message: '가입한 팀에서만 접근할 수 있습니다.'});
    req.team = team;
    next();
  }, project);
  project.get('/', (req, res) => res.json(req.team));
  project.get('/users', async (req, res) => res.json(await repository.listUsers(req.team.id)));
  project.post('/users/link-legacy', async (req, res) => res.json(await repository.linkLegacyUsers(req.team.id)));
  project.get('/tasks', async (req, res) => res.json(await repository.listTasks(req.team.id)));
  project.post('/tasks', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'title')) invalid('업무 제목을 입력해 주세요.');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title)) invalid('업무 제목은 공백을 제외한 1~200자로 입력해 주세요.');
    const result = await repository.createTask(req.team.id, title);
    res.status(result.created ? 201 : 200).json({...result, message: result.created ? '새 업무를 추가하고 선택했습니다.' : '같은 제목의 업무가 있어 기존 업무를 선택했습니다.'});
  });
  async function prepare(type, body, patch, user, teamId) {
    const record = validateBody(type, body, patch);
    if (record.owner_id) {
      const owner = await repository.getTeamUser(teamId, record.owner_id);
      if (!owner) invalid('현재 팀의 담당자를 선택해 주세요.');
      record.owner = owner.name;
    }
    if (type === 'feedback') {
      if (record.task_id && !await repository.getTask(teamId, record.task_id)) invalid('현재 팀의 업무를 선택해 주세요.');
      if (!patch) { record.author_id = user.id; record.author = user.name; record.author_is_team = false; }
    }
    return record;
  }
  for (const type of Object.keys(M.fields)) {
    project.get(`/${type}`, async (req, res) => {
      const taskId = type === 'feedback' ? req.query.taskId : undefined;
      if (taskId !== undefined && (typeof taskId !== 'string' || !uuid.test(taskId) || !await repository.getTask(req.team.id, taskId))) invalid('현재 팀의 업무를 선택해 주세요.');
      res.json(await repository.list(type, req.team.id, taskId));
    });
    project.post(`/${type}`, async (req, res) => res.status(201).json(await repository.create(type, await prepare(type, req.body, false, req.user, req.team.id), req.team.id)));
    project.use(`/${type}/:id`, (req, res, next) => {
      if (!uuid.test(req.params.id)) return res.status(400).json({success: false, message: '올바른 항목 ID가 아닙니다.'});
      next();
    });
    project.get(`/${type}/:id`, async (req, res) => {
      const item = await repository.get(type, req.params.id, req.team.id);
      if (!item) return res.status(404).json({success: false, message: '항목을 찾을 수 없습니다.'});
      res.json(item);
    });
    project.patch(`/${type}/:id`, async (req, res) => {
      const record = await prepare(type, req.body, true, req.user, req.team.id);
      const item = Object.keys(record).length
        ? await repository.update(type, req.params.id, record, req.team.id)
        : await repository.get(type, req.params.id, req.team.id);
      if (!item) return res.status(404).json({success: false, message: '항목을 찾을 수 없습니다. 새로 불러와 주세요.'});
      res.json(item);
    });
    project.delete(`/${type}/:id`, async (req, res) => {
      if (!await repository.remove(type, req.params.id, req.team.id)) return res.status(404).json({success: false, message: '항목을 찾을 수 없습니다. 새로 불러와 주세요.'});
      res.status(204).end();
    });
  }
  router.use((req, res) => res.status(404).json({success: false, message: '존재하지 않는 API입니다.'}));
  return router;
}
module.exports = {createApiRouter, validateBody};
