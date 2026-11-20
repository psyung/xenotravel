// 배포 식별자: 지금 빌드의 커밋 해시(7자리)를 public/version.json에 쓰고 index.html의 <meta name="build-commit">에 넣는다.
// Vercel 빌드(vercel.json buildCommand)에서 실행한다. 로컬 `npm start`는 server.js가 같은 값을 그때그때 넣어 주므로 실행할 필요 없다.
// 커밋은 VERCEL_GIT_COMMIT_SHA → git rev-parse HEAD 순서로 찾고, 둘 다 없으면 'dev'.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildCommit(env = process.env) {
  const fromEnv = String(env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT ?? '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 7).toLowerCase();
  try {
    const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'], cwd: fileURLToPath(new URL('..', import.meta.url)) }).toString().trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha.slice(0, 7);
  } catch {}
  return 'dev';
}

/** index.html의 build-commit 메타 값을 바꾼다 */
export const withBuildMeta = (html, commit) => html.replace(/<meta name="build-commit" content="[^"]*">/, `<meta name="build-commit" content="${commit}">`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = buildCommit();
  const pub = new URL('../public/', import.meta.url);
  writeFileSync(new URL('version.json', pub), `${JSON.stringify({ commit, builtAt: new Date().toISOString() })}\n`);
  const index = new URL('index.html', pub);
  writeFileSync(index, withBuildMeta(readFileSync(index, 'utf8'), commit));
  console.log(`build-commit: ${commit}`);
}
