/* 乐智托管 · 同步中转函数
 * 浏览器只访问 https://<你的站点>/ .netlify/functions/sync?p=/rest/v1/...
 * 由 Netlify 服务器转发到 Supabase，避免国内网络对 *.supabase.co 的连接重置。
 * 与「单词默写」那套 Netlify Functions 做法一致。
 */

const SUPABASE = 'https://msokovolvvxgtzlccpim.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_8DoVAMeL3IvLJSRwceKnZg_py5chG8h';

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
    return {
      statusCode: 502,
      headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: 'proxy failed: ' + ((e && e.message) || e) })
    };
  }
};
