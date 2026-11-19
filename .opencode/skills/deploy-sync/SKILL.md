---
name: deploy-sync
description: 乐智托管的数据同步部署与排错：Supabase 建表、Netlify 从 GitHub 部署、/supa 同域中转、同步码上传/恢复。用于"部署/上线/同步不了/连不上 Supabase/换设备恢复数据"等请求。
---

# 乐智托管 · 云端同步部署手册

这套流程在本项目里**已经跑通并验证过**（2026-11-19）。以后任何部署/同步问题，按本手册顺序执行，并**把完整步骤和勾选清单展示给用户**，不要只说结论。

## 0. 架构（先理解，再动手）

```
浏览器 ──https──> lezhituoguan.netlify.app/.netlify/functions/sync?p=/rest/v1/...
                                   │
                            Netlify Function（netlify/functions/sync.js）
                                   │
                                   └──> msoko…supabase.co/rest/v1/...
```

> 优先用 **Netlify Function**（与「单词默写」同款，`vocab-drill-sync.netlify.app/.netlify/functions/sync`）。
> `netlify.toml` 里的 `/supa/*` redirect 保留作备用。

- 用户网络经常对 `*.supabase.co` 做 SNI 重置（`PR_CONNECT_RESET_ERROR`），**直连必失败**。
- 所以浏览器只连 Netlify 自己的域名，由 Netlify 服务器转发。
- 因此：**必须用 netlify.app（或绑定到该站点的自定义域名）打开 App**，用 `github.io` 打开没有中转，同步一定失败。

## 1. 判断当前网络能不能直连 Supabase

让用户或自己执行（浏览器直接开）：

```
https://msokovolvvxgtzlccpim.supabase.co/rest/v1/
```

- 返回 JSON（401 `No API key found` 也算通）→ 网络可达
- `PR_CONNECT_RESET_ERROR` / `Connection was reset` / 转圈 → **被拦，必须走 Netlify 中转**

## 2. Supabase 建表（幂等，可重复执行）

项目：`msokovolvvxgtzlccpim`  
SQL Editor → New query → 粘贴全部 → Run：

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

create policy sync_read on public.sync for select using (true);
create policy sync_insert on public.sync for insert with check (true);
create policy sync_update on public.sync for update using (true);
```

**两条 grant 是关键**：老项目里 `anon` 默认没有表权限，缺了会报
`42501 permission denied for table sync`（不是 RLS 报错，别混淆）。

## 3. Netlify 从 GitHub 部署

1. app.netlify.com → **Add new site → Import an existing project → GitHub**
2. 首次授权：只勾 `student-manage` 这个仓库
3. 参数：
   - Branch to deploy：`master`
   - Base directory：留空
   - Build command：**留空**
   - Publish directory：`.`
4. Deploy → 约 20–60 秒 → 得到 `https://xxx.netlify.app`
5. 改站点名：Site configuration → General → Site details → **Change site name**（建议 `lezhituoguan`）

`netlify.toml` 必须包含（仓库里已有）：

```toml
[build]
  publish = "."

[[redirects]]
  from = "/supa/*"
  to = "https://msokovolvvxgtzlccpim.supabase.co/:splat"
  status = 200
  force = true
```

改了 `netlify.toml` 要 Deploys → **Clear cache and deploy** 才会生效。

## 4. 关掉 Netlify 访问保护（最容易卡住的一步）

新站点若开了 Visitor access，外部访问会返回 **401 + 页面标题 `Login Redirect`**，并跳 `app.netlify.com/edge-access`。

处理：**Project configuration → Visitor access → 改为 Public（Applies to: Production and previews）→ 保存**。

判断方法：`curl -I https://站点/` 若 401 且 body 含 `edge-access`，就是没公开。

## 5. 验证中转是否生效（三条命令，必须都过）

```powershell
# 1) 首页：应 200，且能搜到 VERSION
(Invoke-WebRequest "https://lezhituoguan.netlify.app/").StatusCode

# 2) 中转：应返回 Supabase 的 JSON，而不是 404/HTML
(Invoke-WebRequest "https://lezhituoguan.netlify.app/supa/rest/v1/").Content

# 3) 带 key 读表：应返回 [] 或数据，不能是 permission denied
(Invoke-WebRequest "https://lezhituoguan.netlify.app/supa/rest/v1/sync?select=code&limit=1" -Headers @{
  apikey='sb_publishable_8DoVAMeL3IvLJSRwceKnZg_py5chG8h'
  Authorization='Bearer sb_publishable_8DoVAMeL3IvLJSRwceKnZg_py5chG8h'
}).Content
```

## 6. App 内配置

用 `https://lezhituoguan.netlify.app` 打开（**不要用 github.io**）：

设置 → 数据与备份 → 云端同步：
1. 地址应**自动**变成 `https://lezhituoguan.netlify.app/supa`（若没变，手动填）
2. key 已内置，不用改
3. 点「测试连接」→ 必须显示「连接正常」
4. 点「生成」→ 8 位同步码，**让用户抄下来**
5. 点「上传到云端」→ 显示「已上传 · 刚刚」

## 7. 第二台设备

同一地址（netlify）+ 已内置的 key + **同一个同步码** → 「从云端恢复」。

设备之间**不共享 localStorage**，换域名/换浏览器都算新设备，必须靠同步码恢复。

## 8. 故障排查表

| 现象 | 原因 | 处理 |
|---|---|---|
| `PR_CONNECT_RESET_ERROR` 打开 supabase.co | 网络拦 SNI | 正常现象，改用 netlify 地址 |
| App 里 `Failed to fetch` / `NetworkError` | 用了 github.io 或直连地址 | 换 netlify 地址，地址栏改成 `/supa` |
| 站点 401 `Login Redirect` | Netlify 访问保护 | Visitor access → Public |
| `relation "sync" does not exist` / `schema cache` | 没建表 | 跑第 2 步 SQL |
| `42501 permission denied for table sync` | 缺 grant | 跑第 2 步的两条 grant |
| `new row violates row-level security` | 缺 policy | 跑第 2 步的 policy 部分 |
| `No API key found in request` | key 没带上（多见于直接访问 `/supa/rest/v1/`） | 正常，App 内会自动带 |
| `/supa/...` 返回 404 或 HTML | 中转规则没生效 | 检查 `netlify.toml`；Clear cache and deploy |
| `/.netlify/functions/sync` 返回 404 | Functions 目录没识别 | `netlify.toml` 里加 `[functions] directory = "netlify/functions"`，重新部署 |
| 函数返回 502 `proxy failed` | Netlify 到 Supabase 也不通 | 极少见，检查 Supabase 项目是否被暂停 |
| 改了代码但页面没变 | Service Worker 缓存 | 关页重开 / 加 `?v=2` / 清站点数据 |
| 上传成功但另一台恢复旧数据 | 自动上传互相覆盖 | 只在一台设备开启自动上传 |

## 9. 注意事项（必须主动提醒用户）

1. **同步码就是密钥**：8 位码经 PBKDF2+AES-GCM 派生密钥，丢了只能重新生成、重新上传；不要发到群里。
2. Supabase 里存的是**密文**（`payload` 是一串 base64），但仍建议不要把项目 URL/key 公开张贴——key 本身是公开的 publishable key，安全性靠同步码。
3. 同步是**整包覆盖**：两台设备同时编辑会互相盖掉。建议一台主用，另一台只恢复。
4. `anon` key 不是密码，别写进截图；`service_role` key 绝对不能进前端。
5. 每次改完代码：`git push` → Netlify 自动部署 → 线上版本号要核对。
6. GitHub Pages 与 Netlify 可并存，但**只有 netlify 域名有中转**，两边的 localStorage 也互不相通。
7. 免费额度：Supabase 500MB 数据库 / 5GB 月流量，Netlify 100GB 月流量，够用。

## 10. 回复用户的格式要求

部署/排错时，**完整展示步骤**，用编号 + 可勾选清单，包含：
1. 为什么（一句根因）
2. 具体点哪里（路径写全：Site configuration → …）
3. 预期结果（成功时看到什么）
4. 失败时对应的排查项（查上表）
5. 最后给出验证命令或版本号

不要只说「已修复」，要给用户可复现的步骤。
