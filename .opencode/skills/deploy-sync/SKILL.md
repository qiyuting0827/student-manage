---
name: deploy-sync
description: 给静态应用接入跨设备云同步（Supabase + 中转），覆盖建表授权、Cloudflare Pages/Worker 与 Netlify 中转部署、同步码与加密、启动拉取与自动上传、验收与排错。用于"加云同步/跨设备同步/同步码/连不上 Supabase/部署中转/换设备恢复/同步又坏了"等请求。
---

# 静态应用云同步：部署与排错手册

适用于**纯前端 / 单文件应用**（GitHub Pages、Cloudflare Pages、Netlify、对象存储）需要多设备共享一份数据的场景。

三条铁律：

1. **应用托管与同步中转分离**，中转单独部署。
2. **先测网络可达性，再选平台**；国内网络下 `supabase.co`、`workers.dev` 常常不可达。
3. **同步码就是密钥**，丢了无法恢复；改动前先确认本机有完整数据。

---

## 0. 开工前的四个判断

### 0.1 目标网络能否直连 Supabase

在**用户的实际设备**上打开：

```
https://<project-ref>.supabase.co/rest/v1/
```

| 返回 | 结论 |
|---|---|
| JSON `{"message":"No API key found in request"}` | 可达，可直连（少见） |
| `PR_CONNECT_RESET_ERROR` / `Connection was reset` / 一直转圈 | **被 SNI 拦截**，必须走中转 |
| DNS 解析失败 | 域名被污染，同样走中转 |

### 0.2 中转平台是否可达

依次在浏览器或 `curl` 里试，**不要假设**：

```
https://<你的服务>.pages.dev          # Cloudflare Pages
https://<你的服务>.workers.dev        # Cloudflare Workers
https://<你的服务>.netlify.app        # Netlify
https://<你的服务>.vercel.app         # Vercel
```

经验值（2026-11，国内常见家宽）：

- `supabase.co`：**被重置**
- `workers.dev`：**被拦截（超时/无法连接）**
- `netlify.app`：通常可达，但**免费额度按团队计费周期计**，用尽后连新建站点都会被拒
- `pages.dev`：通常可达 → **首选**
- `vercel.app`：时通时断

### 0.3 数据是否敏感

学生姓名、成绩、家长电话属于个人信息。最低要求：**客户端加密后再上传**，同步码派生密钥；密文进库，明文不出设备。

### 0.4 是否要能删除

整包快照同步最简单，但"旧设备覆盖新数据"是真事故。必须规定：**打开应用先拉取**，写入走同一个快照键，删除靠整包覆盖而不是并集合并。

---

## 1. 架构

```text
应用（GitHub Pages / 本地文件）
  │  localStorage 为唯一数据源
  │  fetch  →  只请求中转，绝不直连被墙域名
  ▼
中转（Cloudflare Pages `_worker.js` / Netlify Function / Worker）
  │  服务端持 publishable key，补齐 apikey / Authorization
  ▼
Supabase REST  public.sync(code, payload, updated_at)
```

设计约定：

- 浏览器发 `?p=/rest/v1/...`，中转只放行 `/rest/v1/` 前缀，**不要做任意路径的开放代理**。
- 前端只用 publishable / anon key；`service_role` 永不进前端、仓库、日志。
- 中转只做"透传 + 补 header"，不做业务判断，换库少改代码。

---

## 2. Supabase 侧（一次做完）

在 Supabase 项目 → **SQL Editor** 整段运行（可重复执行，幂等）：

```sql
create table if not exists public.sync (
  code text primary key,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.sync enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.sync to anon, authenticated;

drop policy if exists sync_read on public.sync;
drop policy if exists sync_insert on public.sync;
drop policy if exists sync_update on public.sync;

create policy sync_read   on public.sync for select using (true);
create policy sync_insert on public.sync for insert with check (true);
create policy sync_update on public.sync for update using (true);
```

要点：

- **`grant` 不能漏**。只建表不授权，接口会报 `42501 permission denied for table sync`，提示里会直接写 `GRANT SELECT ON public.sync TO anon`。
- 该表按 `code` 分行，`code` 即同步码；payload 存密文。
- 取 `Project URL` 与 `anon public / publishable key`（Project Settings → API）。**不要用 service_role**。
- 免费项目长时间不活动会被暂停（HTTP 540 / 项目睡着），同步失败先去看项目是否 Active。
- **重建表会清空数据**。重建前先确认某一台设备本地有完整数据，否则不可恢复。

自检（直连或经中转均可）：

```
GET /rest/v1/sync?select=code&limit=1
→ 200 数组；401 或 42501 说明 key/权限不对
```

---

## 3. 中转：Cloudflare Pages（首选，免构建）

### 3.1 为什么是它

- 不需要 CI、不需要连 Git、不需要构建命令，**拖一个文件夹就上线**。
- `pages.dev` 在国内普遍可达（`workers.dev` 多数不可达）。
- 免费额度宽松：请求不限、500 次构建/月、100 个站点。

### 3.2 目录与代码

```
sync-proxy/public/
  index.html      # 随便一个说明页
  _worker.js      # advanced mode：接管全站请求
```

`_worker.js`（完整可用）：

```js
const SUPABASE = 'https://<project-ref>.supabase.co';
const DEFAULT_KEY = '<publishable key>';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, apikey, authorization, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });

    const p = new URL(request.url).searchParams.get('p') || '';
    const KEY = (env && env.SUPABASE_KEY) || DEFAULT_KEY;

    if (p === '/health') {
      return json({ ok: true, supabase: SUPABASE, keyTail: KEY.slice(-4), at: new Date().toISOString() });
    }
    if (!p.startsWith('/rest/v1/')) return json({ message: 'bad path' }, 400);

    const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
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
  },
};
```

### 3.3 部署步骤

1. Cloudflare 控制台 → Workers & Pages → **Create application**
2. 切到 **Pages** 标签 → **Upload assets** → **Get started**
3. 项目名（决定 `https://<name>.pages.dev`，全局唯一，只能小写字母/数字/连字符）
4. 把 **`public` 文件夹整体**拖进去（确认里面有 `_worker.js`）
5. **Deploy site**

### 3.4 部署后立刻验证

```
https://<name>.pages.dev/?p=/health
→ {"ok":true,"supabase":"https://xxx.supabase.co","keyTail":"...","at":"..."}
https://<name>.pages.dev/?p=/rest/v1/sync?select=code&limit=3
→ 200 数组（空表就是 []）
```

- 返回 `bad path` = 少了 `?p=` 参数，**不是故障**。
- 502 = 中转通了但连不上 Supabase（地址写错 / 项目被暂停 / key 失效）。
- 404 HTML = `_worker.js` 没上传或不在根目录。
- 打不开 = 该域名被墙，换平台。

### 3.5 改代码后

重新上传同一文件夹（Deploy → 拖入新文件）即可，秒级生效，不需要 GitHub、不需要构建。

---

## 4. 中转：其他平台

### 4.1 Netlify（可用但别放关键路径）

- `netlify/functions/sync.js`，导出 `exports.handler`，`?p=` 形式同上。
- `netlify.toml` 配 `[functions] directory`。
- 风险：**免费额度按团队计费周期**，用尽后 `Production deploys are paused`，连新建站点都被拒，且**已部署站点不会更新**（会一直跑旧版函数 → 502）。
- 若必须用：只部署一个"中转专用"小站点（publish 一个占位页），不要为了同步把整个应用再部署一遍。

### 4.2 Cloudflare Worker（注意 workers.dev 常被墙）

`export default { fetch }`，与上面 `_worker.js` 同构。绑定自定义域名后才稳定；只靠 `*.workers.dev` 往往打不开。

### 4.3 其他

Vercel Functions / Deno Deploy / 自建反代，保持同一契约（`?p=` 透传 + 补 header + CORS）即可。选型只看：**目标网络可达 > 免费额度 > 部署门槛**。

---

## 5. 客户端接入

### 5.1 地址常量

```js
var SYNC_FN_FIXED = 'https://<name>.pages.dev';

function syncProxyBase() {
  if (location.protocol !== 'https:') return '';                 // 本地调试直连
  var h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return '';
  return SYNC_FN_FIXED;                                          // 所有线上站点统一走中转
}
```

- 中转地址写死常量：**不要**从 UI 让用户填，也不要依赖"同域函数"（应用在 github.io，函数在 pages.dev）。
- 换中转域名只需改这一行。

### 5.2 拼 URL

```js
var isProxy = /\.(workers|pages)\.dev(\/.*)?$/.test(base) || /\/\.netlify\/functions\/sync$/.test(base);
var url = isProxy ? base + '?p=' + encodeURIComponent(path) : base + path;
```

`path` 必须**整段** `encodeURIComponent`（含 `?select=...&limit=1`），否则查询参数会被中转函数吃掉。

### 5.3 数据流

- 客户端：8–25 位同步码 → PBKDF2 派生密钥 → AES-GCM 加密 → 上传 `{code, payload: {iv, ct}}`。
- 上传：`POST /rest/v1/sync?on_conflict=code`，头 `Prefer: resolution=merge-duplicates,return=minimal`。
- 下载：`GET /rest/v1/sync?code=eq.<code>&select=payload,updated_at` → 解密 → 整包替换。
- 自动上传：保存后防抖 6–8 秒，静默失败不打断用户。
- 用户在界面上只看到：同步码、自动上传开关、上传/恢复/测试连接。**不显示数据库地址和 key**。

---

## 6. 验收清单

- [ ] `?p=/health` 返回 200 `{ok:true, supabase:...}`
- [ ] `?p=/rest/v1/sync?select=code` 返回 200（空表为 `[]`，权限错为 42501）
- [ ] App 里「测试连接」成功
- [ ] 设备 A 上传后，库里能查到 1 行，`payload` 是 `{"iv":...,"ct":...}` 而不是明文
- [ ] 设备 B（或清空 localStorage 后）用同一同步码能完整恢复
- [ ] 断网时应用照常可用，仅同步报错
- [ ] 双设备并发写：后写覆盖为预期行为，且不会互相把数据清空

---

## 7. 排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| `PR_CONNECT_RESET_ERROR` / reset | 直连 supabase.co 被拦 | 改走中转，前端不要留直连分支 |
| `proxy failed: fetch failed` | 中转连不上库（地址错 / 项目暂停 / 旧函数还指向已删项目） | 查 `?p=/health` 里的 supabase 地址；重新部署最新代码 |
| `bad path` (400) | 请求没带 `?p=`，或路径不以 `/rest/v1/` 开头 | 补参数；确认 encodeURIComponent |
| `42501 permission denied` | 没 grant / RLS 无 policy | 重跑第 2 节 SQL |
| `relation "sync" does not exist` | 没建表 | 跑建表 SQL |
| 返回 `[]` 但用户以为有数据 | 表被重建/清了，或换了项目 | 以本机数据为准重新上传；不要让用户先"恢复" |
| 23505 duplicate key | 同步码已存在但客户端当成新插入 | 改用 `on_conflict=code` + merge-duplicates |
| 手机上还是旧版本 | Service Worker / 强缓存 | 注销 SW、清 Cache Storage、加 `?v=` 强刷 |
| 两台设备同时开，一边改了没保存 | 应用自带的多标签只读锁 | 先接管编辑或关掉另一个标签 |
| 中转 404 HTML | `_worker.js` 不在发布根目录 | 重新上传 `public` 整个文件夹 |
| `workers.dev` 打不开 | 域名被墙 | 换 `pages.dev` 或绑自定义域名 |
| Netlify 报暂停 | 团队额度用尽 | 换平台；额度恢复前连新建站点都不行 |

---

## 8. 安全与运维

- 同步码是唯一凭据：≥8 位、随机、去易混字符（0/o/1/l/i）；建议 12–25 位。
- 明码丢失不可恢复：换设备前先在旧设备确认能登录/能上传。
- 密文入库：payload 里不能出现姓名、分数等明文。
- 中转是"带钥匙的代理"：只允许 `/rest/v1/`，禁止透传任意 URL；CORS 可放宽（同步码即凭据），但不要加 cookie。
- publishable key 泄露风险可控（受 RLS 限制），**service_role 泄露=全库裸奔**。
- 每次改动同步链路后：先 `?p=/health`，再 `?p=/rest/v1/sync?select=code`，最后才动用户数据。

---

## 9. 已验证参考实现

- **student-manage（乐智托管，当前方案）**
  - 应用：`https://qiyuting0827.github.io/student-manage/`（单文件 `index.html`）
  - 中转：`https://lz-sync.pages.dev`（Cloudflare Pages 直传 `_worker.js`，代码在仓库 `sync-proxy/public/_worker.js`）
  - 库：Supabase `ruscbaukapxxlzwburre` 的 `public.sync`，8 位同步码 + AES-GCM
  - 失败过的路线：`supabase.co` 直连（被重置）→ Netlify `/supa/*` redirect（额度用尽后无法更新）→ Netlify Function（同）→ Cloudflare Worker `lz-sync.860787450.workers.dev`（域名被墙）→ **Pages**
- **vocab-drill（单词默写）**：GitHub Pages + Netlify relay-only + Supabase RPC（`vocab_sync_get/put`），25 位同步码，Build Hook + GitHub Actions 只在函数变更时部署。

---

## 10. 回复格式

1. **先给结论**：能不能直连、用哪个中转、会不会影响现有功能。
2. **再给点击路径**（写全菜单层级）和每一步的预期结果。
3. **给验证命令**（`?p=/health`、`?p=/rest/v1/sync?select=code`）。
4. **失败对号入座**：先查表，再让用户操作；涉及建表/重建时先提醒"本机必须有完整数据"。
