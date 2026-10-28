'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const app = require('./server');

test('Express HTTP 통신과 프론트엔드 제공', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test('테스트 API는 JSON 성공 응답과 시간을 반환한다', async () => {
    const response = await fetch(`${base}/api/test`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.success, true);
    assert.match(result.message, /Express/);
    assert.ok(Number.isFinite(Date.parse(result.timestamp)));
  });
  await t.test('기존 화면과 스크립트를 제공한다', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="test-server"/);
    for (const file of ['style.css', 'model.js', 'app.js']) {
      const asset = await fetch(`${base}/${file}`);
      assert.equal(asset.status, 200);
      assert.ok((await asset.text()).length > 0);
    }
  });
  await t.test('서버 내부 파일을 공개하지 않고 잘못된 API는 404를 반환한다', async () => {
    for (const file of ['server.js', 'package.json', '.env', '.env.example', 'db/schema.sql', 'db/repository.js', 'node_modules/express/package.json']) {
      assert.equal((await fetch(`${base}/${file}`)).status, 404);
    }
    const response = await fetch(`${base}/api/missing`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).success, false);
  });
});
