'use strict';
const express = require('express');
const path = require('node:path');
const {loadEnvironment} = require('./config/env');
const environment = loadEnvironment();
const {createApiRouter} = require('./api-router');
const {repository} = require('./db/repository');
function createApp(store = repository, authOptions) {
const app = express();

app.disable('x-powered-by');
if (process.env.VERCEL) app.set('trust proxy', 1);
app.use(express.json({limit: '32kb'}));
app.use('/api', createApiRouter(store, authOptions));

// 프론트엔드 파일만 제공합니다. 서버 소스나 node_modules는 공개하지 않습니다.
app.use(express.static(path.join(__dirname, 'public'), {dotfiles: 'deny'}));
app.use((req, res) => res.status(404).type('text').send('페이지를 찾을 수 없습니다.'));
app.use((error, req, res, next) => {
  // DB 오류 메시지는 접속 정보/쿼리를 포함할 수 있으므로 응답과 로그에 노출하지 않습니다.
  const allowed = [400, 401, 403, 409, 413, 415, 429, 503];
  const status = error.type === 'entity.parse.failed' ? 400 : allowed.includes(error.status) ? error.status : 500;
  res.status(status).json({success: false, message: error.publicMessage || (status === 400 ? '올바른 JSON을 보내 주세요.' : status === 413 ? '요청 데이터가 너무 큽니다.' : status === 503 ? 'DATABASE_URL이 설정되지 않았습니다. 서버 환경변수를 확인해 주세요.' : '데이터베이스 요청에 실패했습니다. 연결 설정과 테이블 생성을 확인해 주세요.')});
});
return app;
}
const app = createApp();

if (require.main === module && !process.env.VERCEL) {
  if (!environment.configured) {
    console.warn(`DATABASE_URL 미설정: ${environment.envPath} 파일에 Neon 연결 문자열을 입력하고 서버를 재시작하세요.`);
  }
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT는 1~65535 사이의 정수여야 합니다.');
    process.exit(1);
  }
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`팀 프로젝트 도우미: http://localhost:${port}`);
    console.log(`테스트 API: http://localhost:${port}/api/test`);
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `${port}번 포트가 사용 중입니다. 기존 서버를 종료하거나 PORT=8001 npm start로 실행하세요.`
      : `서버 실행 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
module.exports = app;
module.exports.createApp = createApp;
