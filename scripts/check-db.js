'use strict';
const {loadEnvironment} = require('../config/env');
const environment = loadEnvironment();
const {repository} = require('../db/repository');
(async () => {
  try {
    if (!environment.configured) {
      console.error(`DATABASE_URL 미설정: ${environment.envPath} 파일에 실제 Neon 연결 문자열을 입력하세요.`);
      process.exitCode = 1;
      return;
    }
    await repository.health();
    for (const type of ['events', 'todos', 'feedback']) {
      const count = await repository.countForCheck(type);
      console.log(`${type}: ${count}개 조회 성공`);
    }
    console.log('Neon 연결과 세 테이블 조회를 확인했습니다. 데이터는 변경하지 않았습니다.');
  } catch {
    console.error('DB 확인 실패: .env의 DATABASE_URL, Neon 연결 상태, npm run db:migrate 실행 여부를 확인해 주세요.');
    process.exitCode = 1;
  }
})();
