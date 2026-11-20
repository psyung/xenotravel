// 의존성 없는 서버: node server.js → http://localhost:5173
// - public/ 정적 파일
// - 짧은 공유 링크: GET /api/share(서버가 있는지 확인) · POST /api/share → /s/<id> · GET /api/share/<id>
//   앱은 GET /api/share가 {ok:true}일 때만 일정 사본을 POST한다 (정적 호스팅에서는 서버로 보내지 않고 긴 링크를 만든다)
//   /s/<id> 페이지에는 여행 제목·요약을 미리보기 태그(og:*)로 넣어 카톡·메신저에 카드로 보이게 한다.
//   공유 데이터는 SHARE_DIR(기본 data/shares)에 파일 하나씩 저장한다.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeShare, shareSummary, SHORT_ID, CODE_RE } from './public/lib/share.js';
import { buildCommit, withBuildMeta } from './scripts/build-version.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const shareDir = path.resolve(process.env.SHARE_DIR || path.join(here, 'data', 'shares'));
const port = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// 배포 식별자 (빌드 커밋 7자리): index.html 메타와 /version.json에 넣는다 (Vercel은 scripts/build-version.mjs가 파일로 만든다)
const COMMIT = buildCommit();
const BUILT_AT = new Date().toISOString();

const MAX_BODY = 200 * 1024; // 공유 코드 최대 크기 (장소 수천 곳도 들어간다)
const RATE_MAX = 30; // IP당 시간당 공유 링크 생성 수
const rate = new Map();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function newId() {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => ABC[randomInt(ABC.length)]).join('');
}

/**
 * IP당 시간당 공유 링크 생성 수 제한 (GPT 3차 #12).
 * 막힌 요청은 기록에 더하지 않고, 한 시간 지난 주소는 지워 메모리가 늘지 않게 한다.
 */
function limited(ip) {
  const now = Date.now();
  const hits = (rate.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= RATE_MAX) {
    rate.set(ip, hits);
    return true;
  }
  hits.push(now);
  rate.set(ip, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rate) if (!hits.some((t) => now - t < 3600_000)) rate.delete(ip);
}, 10 * 60_000).unref();

/** 요청 주소. 역방향 프록시 뒤에서는 TRUST_PROXY=1일 때만 X-Forwarded-For 첫 주소를 믿는다 (아니면 누구나 위조 가능) */
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress;
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function createShare(req, res) {
  if (limited(clientIp(req))) return json(res, 429, { error: '잠시 후 다시 시도해 주세요' });
  let code;
  try {
    code = JSON.parse(await readBody(req)).code;
  } catch (err) {
    return json(res, err.status ?? 400, { error: '올바르지 않은 요청' });
  }
  if (typeof code !== 'string' || !CODE_RE.test(code)) return json(res, 400, { error: '올바르지 않은 공유 코드' });
  let summary;
  try {
    summary = shareSummary(await decodeShare(code)); // 열리는 코드인지 미리 확인
  } catch {
    return json(res, 400, { error: '올바르지 않은 공유 코드' });
  }
  await mkdir(shareDir, { recursive: true });
  for (let i = 0; i < 5; i++) {
    const id = newId();
    try {
      await writeFile(path.join(shareDir, `${id}.json`), JSON.stringify({ code, ...summary, createdAt: new Date().toISOString() }), { flag: 'wx' });
      return json(res, 201, { id, path: `/s/${id}` });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return json(res, 500, { error: '링크를 만들지 못했어요' });
}

async function loadShare(id) {
  if (!SHORT_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(shareDir, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** /s/<id>: 앱 화면 그대로에 미리보기 태그만 바꿔 넣는다. */
async function sharePage(req, res, id) {
  const share = await loadShare(id);
  let html = await readFile(path.join(root, 'index.html'), 'utf8');
  const title = share ? share.title : '공유 링크를 찾을 수 없어요';
  const desc = share ? `${share.line} · 앱 설치 없이 바로 보기` : 'XenoTravel 여행 일정';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const meta = [
    `<base href="/">`, // /s/<id> 아래에서도 styles.css·app.js를 루트에서 찾게
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="XenoTravel">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(`${proto}://${host}/s/${id}`)}">`,
    `<meta property="og:image" content="${esc(`${proto}://${host}/og.png`)}">`,
    `<meta name="twitter:card" content="summary">`,
  ].join('\n  ');
  html = withBuildMeta(html, COMMIT)
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)} · XenoTravel</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/^[ \t]*<meta property="og:[^"]+"[^>]*>\r?\n/gm, '')
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${meta}`);
  res.writeHead(share ? 200 : 404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
  res.end(html);
}

async function notFound(res) {
  // 없는 주소(잘못된 공유 링크 포함): 네 언어 안내가 든 404 페이지 (Vercel도 같은 public/404.html을 쓴다)
  try {
    const body = await readFile(path.join(root, '404.html'));
    res.writeHead(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

async function staticFile(res, pathname) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (pathname === '/version.json') {
    try {
      await readFile(file); // 빌드 산출물이 있으면 그대로
    } catch {
      return json(res, 200, { commit: COMMIT, builtAt: BUILT_AT });
    }
  }
  try {
    let body = await readFile(file);
    if (pathname === '/index.html') body = withBuildMeta(body.toString('utf8'), COMMIT);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    await notFound(res);
  }
}

http
  .createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    try {
      if (pathname === '/api/share' && req.method === 'POST') return await createShare(req, res);
      if (pathname === '/api/share' && req.method === 'GET') return json(res, 200, { ok: true });
      let m = /^\/api\/share\/([^/]+)$/.exec(pathname);
      if (m && req.method === 'GET') {
        const share = await loadShare(m[1]);
        return share ? json(res, 200, { code: share.code }) : json(res, 404, { error: '공유 링크를 찾을 수 없어요' });
      }
      m = /^\/s\/([^/]+)\/?$/.exec(pathname);
      if (m) return SHORT_ID.test(m[1]) ? await sharePage(req, res, m[1]) : await notFound(res); // 형식부터 틀린 공유 주소는 바로 404 페이지
      await staticFile(res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: '서버 오류' });
    }
  })
  .listen(port, () => console.log(`XenoTravel → http://localhost:${port}`));
