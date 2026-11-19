/* 乐智托管 · 同步中转函数
 * 浏览器只访问 https://<你的站点>/ .netlify/functions/sync?p=/rest/v1/...
 * 由 Netlify 服务器转发到 Supabase，避免国内网络对 *.supabase.co 的连接重置。
 * 与「单词默写」那套 Netlify Functions 做法一致。
 */

const SUPABASE = 'https://ruscbaukapxxlzwburre.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_XSUF6UfFcymamNqBdJwWkQ_YPieFolG';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, apikey, authorization, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const q = event.queryStringParameters || {};
  const p = q.p || '';

  /* 自检：确认线上函数实际在用哪个 Supabase 项目（部署后访问 ?p=/health 即可） */
  if (p === '/health') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ ok: true, supabase: SUPABASE, keyTail: KEY.slice(-4), at: new Date().toISOString() })
    };
  }

  if (!/^\/rest\/v1\//.test(p)) {
    return { statusCode: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'bad path' }) };
  }

  const headers = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json'
  };
  const prefer = (event.headers && (event.headers.prefer || event.headers.Prefer)) || '';
  if (prefer) headers.Prefer = prefer;

  try {
    const r = await fetch(SUPABASE + p, {
      method: event.httpMethod,
      headers,
      body: ['GET', 'HEAD'].indexOf(event.httpMethod) >= 0 ? undefined : event.body
    });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: text
    };
  } catch (e) {
    const cause = (e && e.cause) ? ((e.cause.code || e.cause.message || e.cause) + '') : '';
    return {
      statusCode: 502,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: 'proxy failed: ' + ((e && e.message) || e) + ' -> ' + SUPABASE + (cause ? ' (' + cause + ')' : '') })
    };
  }
};
