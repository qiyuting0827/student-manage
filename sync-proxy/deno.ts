/* 乐智托管 · 同步中转（Deno Deploy 版）
 * 部署：https://dash.deno.com → New Playground → 粘贴本文件 → Save & Deploy
 * 得到 https://<name>.deno.dev ，然后 App 里把同步口指向：
 *   https://<name>.deno.dev/?p=/rest/v1/...
 * 自检：https://<name>.deno.dev/?p=/health
 */

const SUPABASE = 'https://ruscbaukapxxlzwburre.supabase.co';
const KEY = Deno.env.get('SUPABASE_KEY') ?? 'sb_publishable_XSUF6UfFcymamNqBdJwWkQ_YPieFolG';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, apikey, authorization, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

  const p = new URL(req.url).searchParams.get('p') ?? '';

  if (p === '/health') {
    return json({ ok: true, supabase: SUPABASE, keyTail: KEY.slice(-4), at: new Date().toISOString() });
  }
  if (!p.startsWith('/rest/v1/')) return json({ message: 'bad path' }, 400);

  const headers: Record<string, string> = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };
  const prefer = req.headers.get('prefer');
  if (prefer) headers.Prefer = prefer;

  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
    const r = await fetch(SUPABASE + p, { method: req.method, headers, body });
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ message: 'proxy failed: ' + msg + ' -> ' + SUPABASE }, 502);
  }
});
