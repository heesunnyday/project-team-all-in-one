'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {start} = require('./test-support/memory-store');
const {verifyPassword} = require('./auth');

test('가입·중복 방지·해시·로그인·세션 유지·로그아웃 무효화', async t => {
  const {request, store} = await start(t);
  const input = {name: 'Alice', password: 'test-password-123!'};
  const registered = await request('/api/auth/register', 'POST', input);
  assert.equal(registered.status, 201);
  assert.equal(registered.headers.get('set-cookie'), null);
  assert.deepEqual(Object.keys((await registered.json()).user).sort(), ['id', 'name']);
  const stored = [...store.users.values()][0];
  assert.ok(stored.password_hash.startsWith('scrypt$'));
  assert.ok(!stored.password_hash.includes(input.password));
  assert.equal(await verifyPassword(input.password, stored.password_hash), true);
  assert.equal((await request('/api/auth/register', 'POST', {...input, name: ' alice '})).status, 409);
  assert.equal((await request('/api/auth/login', 'POST', {...input, password: 'wrong-password'})).status, 401);
  const loggedIn = await request('/api/auth/login', 'POST', input);
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Max-Age=604800/); assert.doesNotMatch(cookie, /; Secure/i);
  const token = request.cookie().split('=')[1];
  assert.ok(!store.sessions.has(token)); assert.equal(store.sessions.size, 1);
  assert.equal((await (await request('/api/auth/me')).json()).user.name, 'Alice');
  assert.deepEqual(await (await request('/api/teams')).json(), []);
  const team = await (await request('/api/teams', 'POST', {name: '인증 검사 팀'})).json();
  const users = await (await request(`/api/teams/${team.id}/users`)).json();
  assert.deepEqual(users, [{id: stored.id, name: 'Alice'}]);
  const previousCookie = request.cookie();
  // 같은 쿠키를 사용한 별도 요청으로 새로고침 이후의 세션 유지를 확인합니다.
  const refreshed = await fetch(request.base + '/api/auth/me', {headers: {Cookie: previousCookie}});
  assert.equal(refreshed.status, 200);
  assert.equal((await request('/api/auth/logout', 'POST', {})).status, 204);
  request.setCookie(previousCookie);
  assert.equal((await request('/api/auth/me')).status, 401); assert.equal(store.sessions.size, 0);
});
test('Vercel Secure 쿠키·세션 만료·쿠키 변조를 검증한다', async t => {
  const {request, store} = await start(t, undefined, {secure: true});
  const input = {name: '팀원', password: 'password-123!'};
  await request('/api/auth/register', 'POST', input);
  const loggedIn = await request('/api/auth/login', 'POST', input);
  assert.match(loggedIn.headers.get('set-cookie'), /; Secure/i);
  for (const session of store.sessions.values()) session.expiresAt = '2000-01-01T00:00:00Z';
  assert.equal((await request('/api/events')).status, 401);
  request.setCookie('project_session=' + 'a'.repeat(64));
  assert.equal((await request('/api/events')).status, 401);
});
test('JSON 형식·동일 출처·비밀번호 검증과 인증 요청 제한', async t => {
  const {request, store} = await start(t);
  assert.equal((await request('/api/auth/register', 'POST', {name: ' ', password: '12345678'})).status, 400);
  assert.equal((await request('/api/auth/register', 'POST', {name: '가', password: '123'})).status, 400);
  assert.equal((await request('/api/auth/login', 'POST', {}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await request('/api/auth/login', 'POST', {}, {'Content-Type': 'text/plain'})).status, 415);
  store.consumeAuthAttempt = async () => false;
  assert.equal((await request('/api/auth/login', 'POST', {name: '가', password: 'password-123'})).status, 429);
});
