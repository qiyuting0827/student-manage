---
name: deploy-sync
description: 乐智托管的数据同步部署与排错：Supabase 建表、Netlify 部署、Netlify Function 中转、同步码上传/恢复、github.io 与 netlify 双入口。用于"部署/上线/同步不了/连不上 Supabase/换设备恢复数据"等请求。
---

# 乐智托管 · 云端同步部署手册

本手册对应 **v2.12.3+**，已在 2026-11-19 实测跑通。执行时把完整步骤和勾选清单展示给用户，不要只说结论。

## 0. 架构（先理解，再动手）

```
任意 https 站点（github.io / netlify.app / 自定义域名）
          │  fetch
          ▼
https://lezhituoguan.netlify.app/.netlify/functions/sync?p=/rest/v1/sync
          │
   Netlify Function（netlify/functions/sync.js）
          │  服务端带 apikey / Authorization / Prefer
          ▼
https://msokovolvvxgtzlccpim.supabase.co/rest/v1/...
```

关键点：

- 用户网络经常对 `*.supabase.co` 做 SNI 重置（`PR_CONNECT_RESET_ERROR` / `Connection was reset`），**直连必失败**，所以浏览器只连 Netlify。
- `netlify/functions/sync.js` 是通用 REST 代理：`?p=` 必须是 `/rest/v1/` 开头，透传 method / body / `Prefer`，CORS 全开（含 OPTIONS 204）。
- **v2.12.3 起，任何 https 站点都走同一个绝对函数地址**（`SYNC_FN_FIXED`）：
  - `*.netlify.app` / `*.netlify.com` → 同域 `/.netlify/functions/sync`
  - 其他 https（含 `github.io`、自定义域名）→ `https://lezhituoguan.netlify.app/.netlify/functions/sync`
  - `localhost` / `127.0.0.1` / `http:` → 不中转（本地调试直连）
- 因此 **github.io 和 netlify.app 都能同步**。若只有 github.io 失败，先确认线上版本 ≥ 2.12.3。

> 历史坑：v2.12.2 之前用的是相对路径 `/.netlify/functions/sync`，在 github.io 上会拼成 `qiyuting0827.github.io/.netlify/functions/sync` → 404。这是"单词默写能同步、这个不能"的真正原因——那个 App 用的是写死的绝对地址。

## 1. 判断网络是否能直连 Supabase

浏览器直接打开：

```
https://msokovolvvxgtzlccpim.supabase.co/rest/v1/
```

- 返回 JSON（401 `No API key found` 也算通）→ 可达
- `PR_CONNECT_RESET_ERROR` / 转圈 → 被拦，必须走中转（默认就是中转，无需额外设置）

## 2. Supabase 建表（幂等，可重复执行）

项目：`msokovolvvxgtzlccpim` → SQL Editor → 粘贴全部 → Run：

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

**两条 grant 不能漏**：缺了会报 `42501 permission denied for table sync`（不是 RLS 报错，别混淆）。

App 里「设置 → 数据与备份 → 云端同步 → 建表 SQL」可直接复制同一段。

## 3. Netlify 部署

1. app.netlify.com → **Add new site → Import an existing project → GitHub**
2. 首次授权：只勾 `student-manage` 仓库
3. 参数：
   - Branch to deploy：`master`
   - Base directory：留空
   - Build command：**留空**
   - Publish directory：`.`
4. Deploy → 20–60 秒 → 得到 `https://xxx.netlify.app`
5. 改站点名：Site configuration → General → Site details → **Change site name**

当前生产站点：**https://lezhituoguan.netlify.app**（改名会让旧地址失效，且 `SYNC_FN_FIXED` 里写死了这个名字——改名必须同步改 `index.html` 的常量并重新部署）。

`netlify.toml` 必须包含：

```toml
[build]
  publish = "."

[functions]
  directory = "netlify/functions"

[[redirects]]
  from = "/supa/*"
  to = "https://msokovolvvxgtzlccpim.supabase.co/:splat"
  status = 200
  force = true
```

- `[functions]` 缺了 → `/.netlify/functions/sync` 404
- `/supa/*` 是备用通道（redirect 代理），主用 Function
- 改完 `netlify.toml`：Deploys → **Clear cache and deploy**

## 4. 关掉 Netlify 访问保护（最容易卡住的一步）

新站点若开了 Visitor access，外部访问返回 **401 + `Login Redirect`**，跳 `app.netlify.com/edge-access`。

处理：**Project configuration → Visitor access → Public（Applies to: Production and previews）→ 保存**。

## 5. 验证（三条命令，必须都过）

```powershell
# 1) 首页 200 且版本号正确
$r = Invoke-WebRequest -UseBasicParsing "https://lezhituoguan.netlify.app/"
[regex]::Match($r.Content,"var VERSION = '([^']+)'").Groups[1].Value

# 2) 函数在线：应返回 Supabase 的 JSON（401 No API key / 200 数据都算通）
(Invoke-WebRequest -UseBasicParsing "https://lezhituoguan.netlify.app/.netlify/functions/sync?p=%2Frest%2Fv1%2F").Content

# 3) 读表：应返回 [{"code":"..."}]
(Invoke-WebRequest -UseBasicParsing "https://lezhituoguan.netlify.app/.netlify/functions/sync?p=%2Frest%2Fv1%2Fsync%3Fselect%3Dcode%26limit%3D1").Content
```

再用 github.io 验证跨域（可选）：

```powershell
(Invoke-WebRequest -UseBasicParsing "https://qiyuting0827.github.io/student-manage/index.html").Content -match 'SYNC_FN_FIXED'
```

## 6. App 内配置

任意一个 https 地址打开都可以（github.io / netlify 均可，v2.12.3+）：

设置 → 数据与备份 → 云端同步：

1. 地址应自动变成 `https://lezhituoguan.netlify.app/.netlify/functions/sync`
2. key 已内置，不用改
3. 「测试连接」→ 显示「连接正常」
4. 「生成」→ 8 位同步码，**让用户抄下来**
5. 「上传到云端」→ 显示「已上传 · 刚刚」

当前用户同步码：`p8tsm5as`（2026-11-19 上传，表内 payload 为 `{"iv":…,"ct":…}` 密文）。

## 7. 第二台设备

同一同步码 + 已内置地址/key → 「从云端恢复」。

设备之间不共享 localStorage；换域名、换浏览器、换设备都算新设备，必须靠同步码恢复。

## 8. 故障排查表

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开 supabase.co 报 `PR_CONNECT_RESET_ERROR` | 网络拦 SNI | 正常现象，App 默认走中转 |
| `Failed to fetch` / `NetworkError` | 页面版本 < 2.12.3（相对路径）或函数 404 | 确认版本 ≥ 2.12.3；检查 `[functions]` 目录 |
| github.io 能开、同步失败 | 同上，旧版拼错地址 | 升级到 2.12.3+，或直接用 netlify 地址 |
| 站点 401 `Login Redirect` | Netlify 访问保护 | Visitor access → Public |
| `relation "sync" does not exist` / `schema cache` | 没建表 | 跑第 2 步 SQL |
| `42501 permission denied for table sync` | 缺 grant | 跑两条 grant |
| `new row violates row-level security` | 缺 policy | 跑三条 policy |
| `/supa/...` 404 或 HTML | redirect 没生效 | Clear cache and deploy（备用通道，主用函数时不影响） |
| `/.netlify/functions/sync` 404 | 函数目录没识别 | `netlify.toml` 加 `[functions] directory`，重新部署 |
| 函数 502 `proxy failed` | Netlify 到 Supabase 也不通 | 检查 Supabase 项目是否被暂停 |
| 改了代码页面没变 | Service Worker 缓存 | 关页重开 / `?v=2` / 清站点数据 |
| 恢复后是旧数据 | 自动上传互相覆盖 | 只在一台设备开自动上传 |

## 9. 注意事项

1. **同步码就是密钥**：PBKDF2 + AES-GCM 派生，丢了只能重新生成、重新上传；不要外传。
2. Supabase 只存密文；publishable key 本身公开，安全靠同步码。
3. 同步是整包覆盖，两台设备同改会互相盖掉。
4. `service_role` key 绝不能进前端。
5. 改代码 → `git push` → Netlify 自动部署（函数跟着更新）→ 核对线上 `VERSION`。
6. 若 `git push` 被重置，用 `C:\Users\Administrator\AppData\Local\Temp\opencode\push-api4.js "<message>"` 走 GitHub API。
7. 免费额度：Supabase 500MB / 5GB 月流量；Netlify 100GB 月流量。

## 10. 回复格式

1. 一句根因
2. 具体点哪里（路径写全）
3. 预期结果
4. 失败对应排查项
5. 验证命令或版本号
