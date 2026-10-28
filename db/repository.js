'use strict';
const {neon} = require('@neondatabase/serverless');
const definitions = Object.freeze({
  events: {columns: ['title', 'owner', 'owner_id', 'owner_is_team', 'date', 'start_time', 'description'], order: 't.date, t.start_time ASC NULLS FIRST, t.created_at, t.id'},
  todos: {columns: ['title', 'owner', 'owner_id', 'owner_is_team', 'date', 'done'], order: 't.done ASC, t.date ASC NULLS LAST, t.created_at, t.id'},
  feedback: {columns: ['author', 'author_id', 'author_is_team', 'owner', 'owner_id', 'owner_is_team', 'task_id', 'description', 'status'], order: "(t.status = '완료') ASC, t.created_at DESC, t.id"}
});
function projection(type, joined = false) {
  const p = joined ? 't.' : '';
  const owner = joined ? 'COALESCE(u.name, t.owner)' : 'owner';
  const common = `${p}id, ${p}team_id AS "teamId", CASE WHEN ${p}owner_is_team THEN '팀' ELSE ${owner} END AS owner, ${p}owner_id AS "ownerId", CASE WHEN ${p}owner_is_team THEN 'team' ELSE 'user' END AS "ownerType"`;
  if (type === 'events') return `${common}, ${p}title, to_char(${p}date, 'YYYY-MM-DD') AS date, COALESCE(to_char(${p}date + ${p}start_time, 'HH24:MI'), '') AS time, ${p}description`;
  const completed = `to_char(${p}completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt"`;
  if (type === 'todos') return `${common}, ${p}title, COALESCE(to_char(${p}date, 'YYYY-MM-DD'), '') AS date, ${p}done, ${completed}`;
  const author = joined ? 'COALESCE(a.name, t.author)' : 'author';
  const taskTitle = joined ? 'w.title' : '(SELECT w.title FROM feedback_tasks w WHERE w.id = feedback.task_id AND w.team_id = feedback.team_id)';
  return `${common}, ${p}task_id AS "taskId", ${taskTitle} AS "taskTitle", CASE WHEN ${p}author_is_team THEN '팀' ELSE ${author} END AS author, ${p}author_id AS "authorId", CASE WHEN ${p}author_is_team THEN 'team' ELSE 'user' END AS "authorType", ${p}description, ${p}status, ${completed}, to_char(${p}created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"`;
}
function joins(type) {
  return `LEFT JOIN app_users u ON u.id = t.owner_id${type === 'feedback' ? ' LEFT JOIN app_users a ON a.id = t.author_id LEFT JOIN feedback_tasks w ON w.id = t.task_id AND w.team_id = t.team_id' : ''}`;
}
// 이름 일치 연결은 담당자에만 적용합니다. 과거 작성자 정보는 보존합니다.
const linkLegacySQL = `WITH e AS (
  UPDATE events t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = $1 AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id) RETURNING t.id
), d AS (
  UPDATE todos t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = $1 AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id) RETURNING t.id
), f AS (
  UPDATE feedback t SET owner_id = u.id FROM app_users u
  WHERE t.team_id = $1 AND NOT t.owner_is_team AND t.owner_id IS NULL AND lower(btrim(t.owner)) = u.name_key AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.team_id AND m.user_id = u.id)
  RETURNING t.id
) SELECT (SELECT count(*)::integer FROM e) AS events,
         (SELECT count(*)::integer FROM d) AS todos,
         (SELECT count(*)::integer FROM f) AS feedback`;

function createRepository(query) {
  function definition(type) {
    if (!Object.hasOwn(definitions, type)) throw new Error('Invalid resource');
    return definitions[type];
  }
  const values = (columns, record) => columns.map(key => ['date', 'start_time'].includes(key) ? record[key] || null : key.endsWith('_is_team') ? record[key] ?? false : record[key]);
  return {
    async health() { await query('SELECT 1 AS connected', []); return true; },
    async countForCheck(type) { definition(type); return (await query(`SELECT count(*)::integer AS count FROM ${type}`, []))[0].count; },
    async list(type, teamId, taskId) {
      const def = definition(type);
      const filter = type === 'feedback' && taskId ? ' AND t.task_id = $2' : '';
      return query(`SELECT ${projection(type, true)} FROM ${type} t ${joins(type)} WHERE t.team_id = $1${filter} ORDER BY ${def.order}`, filter ? [teamId, taskId] : [teamId]);
    },
    async get(type, id, teamId) {
      definition(type);
      return (await query(`SELECT ${projection(type, true)} FROM ${type} t ${joins(type)} WHERE t.id = $1 AND t.team_id = $2`, [id, teamId]))[0] || null;
    },
    async create(type, record, teamId) {
      const def = definition(type);
      const columns = [...def.columns, 'team_id'];
      const tracked = type !== 'events';
      const completed = type === 'todos' ? record.done : record.status === '완료';
      return (await query(`INSERT INTO ${type} (${columns.join(', ')}${tracked ? ', completed_at' : ''}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}${tracked ? completed ? ', now()' : ', NULL' : ''}) RETURNING ${projection(type)}`, values(columns, {...record, team_id: teamId})))[0];
    },
    async update(type, id, record, teamId) {
      const def = definition(type);
      const columns = def.columns.filter(key => Object.hasOwn(record, key) && !(type === 'feedback' && key.startsWith('author')));
      if (!columns.length) throw new Error('Empty update');
      const params = values(columns, record); params.push(id, teamId);
      const changes = columns.map((key, i) => `${key} = $${i + 1}`);
      const stateKey = type === 'todos' ? 'done' : type === 'feedback' ? 'status' : null;
      if (stateKey && columns.includes(stateKey)) {
        const next = `$${columns.indexOf(stateKey) + 1}`;
        const oldDone = type === 'todos' ? 'done' : "status = '완료'";
        const newDone = type === 'todos' ? next : `${next} = '완료'`;
        // 하나의 UPDATE에서 이전 상태를 비교하므로 중복·동시 요청도 완료 시각을 덮어쓰지 않습니다.
        changes.push(`completed_at = CASE WHEN ${newDone} THEN CASE WHEN ${oldDone} THEN completed_at ELSE now() END ELSE NULL END`);
      }
      return (await query(`UPDATE ${type} SET ${changes.join(', ')} WHERE id = $${params.length - 1} AND team_id = $${params.length} RETURNING ${projection(type)}`, params))[0] || null;
    },
    async remove(type, id, teamId) {
      definition(type);
      return (await query(`DELETE FROM ${type} WHERE id = $1 AND team_id = $2 RETURNING id`, [id, teamId])).length > 0;
    },
    async createUser(name, nameKey, passwordHash) {
      return (await query('INSERT INTO app_users (name, name_key, password_hash) VALUES ($1, $2, $3) RETURNING id, name', [name, nameKey, passwordHash]))[0];
    },
    async findUserByName(nameKey) { return (await query('SELECT id, name, password_hash FROM app_users WHERE name_key = $1', [nameKey]))[0] || null; },
    async getUser(id) { return (await query('SELECT id, name FROM app_users WHERE id = $1', [id]))[0] || null; },
    async listTasks(teamId) { return query('SELECT id, team_id AS "teamId", title FROM feedback_tasks WHERE team_id = $1 ORDER BY title, id', [teamId]); },
    async getTask(teamId, id) { return (await query('SELECT id, team_id AS "teamId", title FROM feedback_tasks WHERE team_id = $1 AND id = $2', [teamId, id]))[0] || null; },
    async createTask(teamId, title) {
      const [task] = await query('INSERT INTO feedback_tasks(team_id, title) VALUES ($1, $2) ON CONFLICT (team_id, title) DO NOTHING RETURNING id, team_id AS "teamId", title', [teamId, title]);
      if (task) return {task, created: true};
      const [existing] = await query('SELECT id, team_id AS "teamId", title FROM feedback_tasks WHERE team_id = $1 AND title = $2', [teamId, title]);
      return {task: existing, created: false};
    },
    async listUsers(teamId) { return query('SELECT u.id, u.name FROM app_users u JOIN team_members m ON m.user_id = u.id WHERE m.team_id = $1 ORDER BY u.name, u.id', [teamId]); },
    async getTeamUser(teamId, userId) { return (await query('SELECT u.id, u.name FROM app_users u JOIN team_members m ON m.user_id = u.id WHERE m.team_id = $1 AND u.id = $2', [teamId, userId]))[0] || null; },
    async createSession(hash, userId, expiresAt) {
      await query('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hash, userId, expiresAt]);
    },
    async findSession(hash) {
      return (await query('SELECT u.id, u.name FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [hash]))[0] || null;
    },
    async deleteSession(hash) { await query('DELETE FROM app_sessions WHERE token_hash = $1', [hash]); },
    async consumeAuthAttempt(key, max) {
      const [row] = await query(`INSERT INTO auth_rate_limits (key) VALUES ($1)
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
          window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
        RETURNING attempts`, [key]);
      return row.attempts <= max;
    },
    async linkLegacyUsers(teamId) { return (await query(linkLegacySQL, [teamId]))[0]; },
    async listTeams(userId) {
      return query(`SELECT t.id, t.name, t.description, t.owner_id AS "ownerId", (t.owner_id = $1) AS "isOwner",
        CASE WHEN t.owner_id = $1 THEN t.invite_code ELSE NULL END AS "inviteCode"
        FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = $1 ORDER BY t.created_at, t.id`, [userId]);
    },
    async getTeamForUser(teamId, userId) {
      return (await query(`SELECT t.id, t.name, t.description, t.owner_id AS "ownerId", (t.owner_id = $2) AS "isOwner",
        CASE WHEN t.owner_id = $2 THEN t.invite_code ELSE NULL END AS "inviteCode"
        FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.id = $1 AND m.user_id = $2`, [teamId, userId]))[0] || null;
    },
    async createTeam(name, description, ownerId, inviteCode) {
      // 생성자 가입도 같은 문장에 포함하므로 실패 시 팀만 남지 않습니다.
      return (await query(`WITH new_team AS (
        INSERT INTO teams(name, description, owner_id, invite_code) VALUES ($1, $2, $3, $4) RETURNING *
      ), member AS (
        INSERT INTO team_members(team_id, user_id) SELECT id, owner_id FROM new_team RETURNING team_id
      ) SELECT t.id, t.name, t.description, t.owner_id AS "ownerId", true AS "isOwner", t.invite_code AS "inviteCode"
        FROM new_team t JOIN member m ON m.team_id = t.id`, [name, description, ownerId, inviteCode]))[0];
    },
    async findTeamByInvite(inviteCode, userId) {
      return (await query(`SELECT t.id, t.name, t.description,
        EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = $2) AS "alreadyMember"
        FROM teams t WHERE invite_code = $1`, [inviteCode, userId]))[0] || null;
    },
    async addTeamMember(teamId, userId) {
      return (await query('INSERT INTO team_members(team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING team_id', [teamId, userId])).length > 0;
    }
  };
}
let sql;
let connection;
function client() {
  const url = process.env.DATABASE_URL;
  if (!url) { const error = new Error('Database not configured'); error.status = 503; throw error; }
  if (!sql || connection !== url) { sql = neon(url); connection = url; }
  return sql;
}
const repository = createRepository((text, params) => client().query(text, params));
async function migrate(statements) {
  const sql = client();
  return sql.transaction(statements.map(text => sql.query(text)), {isolationLevel: 'Serializable'});
}
module.exports = {createRepository, repository, migrate};
