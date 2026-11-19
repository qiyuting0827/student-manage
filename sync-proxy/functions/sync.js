/* 乐智托管 · 同步中转（Cloudflare Pages Functions 版）
 * 部署：Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接到 Git
 *   仓库：qiyuting0827/student-manage
 *   分支：master
 *   根目录（Root directory）：sync-proxy
 *   构建命令：留空
 *   输出目录：public
 * 部署后的中转地址：https://<项目名>.pages.dev/sync
 * 自检：https://<项目名>.pages.dev/sync?p=/health
 */

const SUPABASE = 'https://ruscbaukapxxlzwburre.supabase.co';
const DEFAULT_KEY = 'sb_publishable_XSUF6UfFcymamNqBdJwWkQ_YPieFolG';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, apikey, authorization, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const p = new URL(request.url).searchParams.get('p') || '';
  const KEY = (env && env.SUPABASE_KEY) || DEFAULT_KEY;

  if (p === '/health') {
    return json({ ok: true, supabase: SUPABASE, keyTail: KEY.slice(-4), at: new Date().toISOString() });
  }
  if (!p.startsWith('/rest/v1/')) return json({ message: 'bad path' }, 400);

  const headers = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };
  const prefer = request.headers.get('prefer');
  if (prefer) headers.Prefer = prefer;

  try {
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    const r = await fetch(SUPABASE + p, { method: request.method, headers, body });
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return json({ message: 'proxy failed: ' + ((e && e.message) || e) + ' -> ' + SUPABASE }, 502);
  }
}
