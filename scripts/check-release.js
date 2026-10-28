'use strict';
// 업로드 직전 Git 인덱스의 실제 내용을 검사합니다. 비밀값/일치 문자열은 출력하지 않습니다.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const denied = /(^|\/)(?:\.env(?:\..*)?|node_modules|\.vercel|backups|coverage|test-results|playwright-report|artifacts|\.npmrc)(?:\/|$)|(?:\.log|\.dump|\.backup|\.pem|\.key|\.p12|\.pfx)$|(^|\/)(?:cookies[^/]*\.(?:txt|json)|sessions[^/]*\.json|moa-localStorage-backup-[^/]*\.json)$/i;
const fixtures = new Set(['postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require', 'postgresql://user:secret@private/db', 'postgresql://example.invalid/test']);
const sensitive = [];
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(envPath)))) {
    if (/DATABASE_URL|SECRET|TOKEN|PASSWORD|SESSION/i.test(key) && value.length >= 8) sensitive.push(value);
    if (key === 'DATABASE_URL') {
      try {
        const url = new URL(value);
        for (const part of [url.password, decodeURIComponent(url.password), url.hostname]) if (part.length >= 8) sensitive.push(part);
      } catch { /* 값은 출력하지 않습니다. */ }
    }
  }
}
try {
  if (path.resolve(git('rev-parse', '--show-toplevel').trim()).normalize('NFC') !== root.normalize('NFC')) throw new Error('wrong root');
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  if (!tracked.length) throw new Error('empty');
  const findings = [];
  for (const file of tracked) {
    if (file !== '.env.example' && denied.test(file)) { findings.push(`${file}: 업로드 금지 파일`); continue; }
    const mode = git('ls-files', '--stage', '--', file).split(' ')[0];
    if (mode === '120000' || mode === '160000') { findings.push(`${file}: 외부 파일 연결/하위 저장소`); continue; }
    const content = git('show', `:${file}`);
    if (sensitive.some(value => content.includes(value))) findings.push(`${file}: 로컬 비밀값과 일치`);
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b|scrypt\$\d+\$\d+\$\d+\$[a-f0-9]{32}\$[a-f0-9]{128}/.test(content)) findings.push(`${file}: 인증 정보 형식 감지`);
    for (const match of content.matchAll(/postgres(?:ql)?:\/\/[^\s'"`<>\\]+/g)) if (!fixtures.has(match[0])) findings.push(`${file}: 예시로 허용되지 않은 DB URL`);
    if (/project_session=[a-f0-9]{64}\b|["'](?:token_hash|password_hash)["']\s*:\s*["'][a-f0-9]{64,}["']/.test(content)) findings.push(`${file}: 저장된 세션/인증 값 형식 감지`);
  }
  if (!tracked.includes('.env.example') || !tracked.includes('package-lock.json')) findings.push('필수 예시 환경변수/잠금 파일 누락');
  if (!git('check-ignore', '.env').trim()) findings.push('.env Git 제외 규칙 누락');
  const example = dotenv.parse(git('show', ':.env.example'));
  if (example.DATABASE_URL !== 'postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require') findings.push('.env.example: 예시 외 값');
  if (findings.length) {
    console.error([...new Set(findings)].join('\n'));
    console.error('업로드 점검 실패. 비밀값은 출력하지 않았습니다.'); process.exitCode = 1;
  } else {
    console.log(`업로드 대상 ${tracked.length}개 파일 점검 통과. .env·비밀 연결 정보·저장된 비밀번호/세션 정보는 포함되지 않았습니다.`);
    console.log('검사는 현재 Git 인덱스에 저장된 내용과 로컬 .env 값을 메모리에서 비교했습니다.');
  }
} catch {
  console.error('업로드 점검을 완료하지 못했습니다. 앱 폴더에서 Git 저장소와 업로드 대상 파일을 먼저 준비하세요. 비밀값은 출력하지 않았습니다.');
  process.exitCode = 1;
}
