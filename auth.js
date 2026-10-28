'use strict';
const express = require('express');
const {randomBytes, createHash, scrypt, timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');
const deriveKey = promisify(scrypt);
const COOKIE = 'project_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const params = {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024};
const digest = value => createHash('sha256').update(value).digest('hex');
const publicUser = user => ({id: user.id, name: user.name});

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt, 64, params);
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$131072$8$1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  // 등록되지 않은 이름에도 같은 비용으로 계산합니다.
  const salt = valid ? parts[4] : '0'.repeat(32);
  const candidate = await deriveKey(password, salt, 64, params);
  return valid && timingSafeEqual(candidate, Buffer.from(parts[5], 'hex'));
}
function tokenFrom(req) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  const token = value ? value.slice(COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function authError(status, message) {
  const error = new Error(message); error.status = status; error.publicMessage = message; return error;
}
function credentials(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['name', 'password'].includes(key))) throw authError(400, '이름과 비밀번호를 입력해 주세요.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = body.password;
  if (!name || name.length > 50 || /[\u0000-\u001f\u007f]/.test(name)) throw authError(400, '이름은 공백을 제외한 1~50자로 입력해 주세요.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim() || Buffer.byteLength(password, 'utf8') > 512) throw authError(400, '비밀번호는 8~128자로 입력해 주세요.');
  return {name, nameKey: name.toLowerCase(), password};
}

function createAuth(store, {secure = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'} = {}) {
  const router = express.Router();
  const cookieOptions = {httpOnly: true, secure, sameSite: 'lax', path: '/'};
  const requireUser = async (req, res, next) => {
    const token = tokenFrom(req);
    const user = token ? await store.findSession(digest(token)) : null;
    if (!user) return res.status(401).json({success: false, message: '로그인이 필요합니다.'});
    req.user = publicUser(user);
    next();
  };
  async function issueSession(req, res, user) {
    const previous = tokenFrom(req);
    if (previous) await store.deleteSession(digest(previous));
    const token = randomBytes(32).toString('hex');
    await store.createSession(digest(token), user.id, new Date(Date.now() + SESSION_MS).toISOString());
    res.cookie(COOKIE, token, {...cookieOptions, maxAge: SESSION_MS});
  }
  async function limit(key, max) {
    if (!await store.consumeAuthAttempt(digest(key), max)) throw authError(429, '요청이 너무 많습니다. 15분 후 다시 시도해 주세요.');
  }
  router.post('/register', async (req, res) => {
    const input = credentials(req.body);
    await limit(`register:${req.ip}`, 20);
    const passwordHash = await hashPassword(input.password);
    let user;
    try { user = await store.createUser(input.name, input.nameKey, passwordHash); }
    catch (error) {
      if (error.code === '23505') throw authError(409, '이미 가입된 이름입니다. 다른 이름을 사용해 주세요.');
      throw error;
    }
    // 가입 후 로그인 화면으로 돌아갑니다. 세션 발급은 로그인에서만 수행합니다.
    res.status(201).json({user: publicUser(user)});
  });
  router.post('/login', async (req, res) => {
    const input = credentials(req.body);
    await limit(`login-ip:${req.ip}`, 60);
    await limit(`login-name:${input.nameKey}`, 20);
    const user = await store.findUserByName(input.nameKey);
    if (!await verifyPassword(input.password, user?.password_hash)) throw authError(401, '이름 또는 비밀번호가 올바르지 않습니다.');
    await issueSession(req, res, user);
    res.json({user: publicUser(user)});
  });
  router.get('/me', requireUser, (req, res) => res.json({user: req.user}));
  router.post('/logout', async (req, res) => {
    const token = tokenFrom(req);
    if (token) await store.deleteSession(digest(token));
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });
  return {router, requireUser};
}
module.exports = {createAuth, hashPassword, verifyPassword, digest, SESSION_MS};
