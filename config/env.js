'use strict';
const path = require('node:path');
const dotenv = require('dotenv');

// 터미널의 현재 위치가 아니라 package.json/server.js가 있는 프로젝트 루트 기준입니다.
function loadEnvironment({projectRoot = path.resolve(__dirname, '..'), env = process.env} = {}) {
  const envPath = path.join(projectRoot, '.env');
  const result = dotenv.config({path: envPath, processEnv: env, override: false, quiet: true});
  return {
    envPath,
    configured: Boolean(env.DATABASE_URL && env.DATABASE_URL.trim()),
    // 원래 오류/파싱 결과에는 비밀값이 포함될 수 있으므로 반환하지 않습니다.
    fileStatus: result.error ? (result.error.code === 'ENOENT' ? 'missing' : 'unreadable') : 'loaded'
  };
}
module.exports = {loadEnvironment};
