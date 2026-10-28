'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {loadEnvironment} = require('./config/env');

test('프로젝트 루트의 .env를 읽고 외부 환경변수는 유지한다', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-env-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  // 실제 자격증명이 아닌 테스트 전용 문자열입니다.
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=postgresql://example.invalid/test\nPORT=8000\n');
  const env = {PORT: '8001'};
  const result = loadEnvironment({projectRoot: root, env});
  assert.equal(env.DATABASE_URL, 'postgresql://example.invalid/test');
  assert.equal(env.PORT, '8001');
  assert.equal(result.configured, true);
  assert.equal(result.fileStatus, 'loaded');
  assert.equal(result.envPath, path.join(root, '.env'));
  assert.ok(!JSON.stringify(result).includes('postgresql://'));
});
test('.env 누락·빈 값과 배포 환경변수를 구분한다', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-env-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  assert.equal(loadEnvironment({projectRoot: root, env: {}}).fileStatus, 'missing');
  assert.equal(loadEnvironment({projectRoot: root, env: {}}).configured, false);
  assert.equal(loadEnvironment({projectRoot: root, env: {DATABASE_URL: 'external-test-value'}}).configured, true);
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=\n');
  assert.equal(loadEnvironment({projectRoot: root, env: {}}).configured, false);
});
