# 部署与云端同步 · 完整配置流程

> 目标：得到一个能在手机、平板、电脑上打开，并且多设备数据自动同步的乐智托管。
> 全程只需要三个账号：GitHub（放代码）、Supabase（存数据）、Netlify（放网页 + 中转）。

---

## 0. 先看懂这张图

```
        ┌──────────────┐
        │  浏览器/手机  │
        └──────┬───────┘
               │ 打开网页（HTTPS）
        ┌──────▼───────────────┐
        │ Netlify：网页 + /supa │  ← 网页从这里加载
        │  /supa/* 转发到 ↓      │
        └──────┬───────────────┘
               │ 服务器之间转发（绕开国内直连限制）
        ┌──────▼───────────────┐
        │ Supabase：sync 表     │  ← 只存加密后的整包数据
        └──────────────────────┘
```

三个要点：
1. **网页必须从 Netlify 打开**，不要用 `github.io`（那边没有 `/supa` 中转）。
2. **Supabase 里必须有 `public.sync` 这张表**，否则同步一定失败。
3. **同步码就是钥匙**：同一串 8 位码 = 同一份数据，丢了就只能重新生成。

---

## 1. 准备账号

| 账号 | 用途 | 费用 |
|---|---|---|
| GitHub | 存放代码（已有：`qiyuting0827/student-manage`） | 免费 |
| Supabase | 存同步数据 | 免费额度足够 |
| Netlify | 托管网页 + 中转 | 免费额度足够 |

三个都用 GitHub 账号登录最省事。

---

## 2. Supabase：建项目、建表

### 2.1 新建项目
1. 打开 https://supabase.com/dashboard
2. 点 **New project**
3. 填写：
   - **Name**：`lezhituoguan`（随意）
   - **Database Password**：点 Generate，**复制保存**（以后一般用不到，但别丢）
   - **Region**：选 **Southeast Asia (Singapore)** 或 **Northeast Asia (Tokyo)**，国内延迟最低
   - **Plan**：Free
4. 点 **Create new project**，等 1–2 分钟初始化

### 2.2 拿到两个值
进入项目 → 左下 **Project Settings** → **API**：

| 名称 | 长什么样 | 填到哪 |
|---|---|---|
| Project URL | `https://xxxx.supabase.co` | App 的「地址」 |
| anon / publishable key | `sb_publishable_...` 或 `eyJhbGci...` | App 的「anon key」 |

> 只复制 **publishable / anon**，绝对不要用 `service_role`（那是管理员钥匙，泄露等于数据库全开）。

本项目已内置：
- 地址：`https://msokovolvvxgtzlccpim.supabase.co`
- key：`sb_publishable_8DoVAMeL3IvLJSRwceKnZg_py5chG8h`

如果你用的就是这个项目，第 2.2 步可以跳过。

### 2.3 建表（关键一步）
左侧 **SQL Editor** → **New query** → 粘贴下面全部内容 → 点 **Run**（或 Ctrl+Enter）：

```sql
create table if not exists public.sync (
  code text primary key,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.sync enable row level security;

drop policy if exists "sync read" on public.sync;
drop policy if exists "sync insert" on public.sync;
drop policy if exists "sync update" on public.sync;

create policy "sync read" on public.sync
  for select using (true);

create policy "sync insert" on public.sync
  for insert with check (true);

create policy "sync update" on public.sync
  for update using (true);
```

期望结果：下方出现 `Success. No rows returned`。

> 这段 SQL 可以重复执行，不会报错（表已存在就跳过，策略先删再建）。

### 2.4 自检：表是否建好
左侧 **Table Editor** → 左侧列表里应该出现 **sync**，字段为 `code / payload / updated_at`。

或者再开一个 SQL Editor 窗口执行：

```sql
select count(*) from public.sync;
```

返回一个数字（0 也行）就说明表和权限都正常。

### 2.5 关于 RLS
`enable row level security` 打开了行级安全，后面三条 policy 是「允许任何人用 publishable key 读写这张表」。
**安全性靠同步码加密**：表里只有密文，没有同步码的人就算读到也解不开。

---

## 3. Netlify：从 GitHub 部署

### 3.1 登录
打开 https://app.netlify.com → **Sign up** → 选 **GitHub** → 授权。

### 3.2 导入仓库
1. 顶部 **Add new site** → **Import an existing project**
2. 选 **Deploy with GitHub**
3. 第一次会跳转到 GitHub 授权页：
   - 选 **Only select repositories**
   - 只勾 `student-manage`
   - 点 **Install / Authorize**
4. 回到 Netlify，在列表里点 `qiyuting0827/student-manage`

### 3.3 部署参数（照抄）

| 字段 | 填什么 | 说明 |
|---|---|---|
| Branch to deploy | `master` | 仓库默认分支是 master |
| Base directory | 留空 | 项目在根目录 |
| Build command | **留空** | 纯静态，没有构建 |
| Publish directory | `.` | 根目录就是站点根 |

仓库里已有 `netlify.toml`，会自动带上这些设置。如果界面已经自动填好，直接点 **Deploy site**。

### 3.4 等部署完成
- 页面跳到站点概览，进度从 Building → **Published**
- 顶部得到地址：`https://随机名.netlify.app`
- 点 **Open production deploy** 打开看一眼，标题应是「乐智托管」

### 3.5 改成好记的域名
**Site configuration → General → Site details → Change site name** → 填 `lezhituoguan` → 保存。
地址变成：`https://lezhituoguan.netlify.app`（如果被占用就换一个，比如 `lezhituoguan-app`）。

### 3.6 打开强制 HTTPS
**Domain management → HTTPS**：
- 确认 **SSL/TLS certificate** 已签发（Let's Encrypt，通常 1–5 分钟）
- 打开 **Force HTTPS**

### 3.7 验证中转是否生效（重要）
浏览器打开：

```
https://你的站点.netlify.app/supa/rest/v1/
```

- 返回一段 JSON（例如 `{"message":"..."}` 或 `[]`）→ **中转正常**
- 返回 Netlify 的 404 页面 → `netlify.toml` 没生效，去 **Deploys → Trigger deploy → Clear cache and deploy site**

### 3.8 以后怎么更新
改完代码 `git push` → Netlify 自动重新部署（约 20 秒）。
**Deploys** 里能看到每次记录；想回滚：选一个旧版本 → **Publish deploy**。

---

## 4. App 内配置同步

### 4.1 用 Netlify 地址打开
```
https://你的站点.netlify.app
```
⚠️ 不要用 `qiyuting0827.github.io/student-manage/`——那里没有 `/supa` 中转，同步会连不上。

### 4.2 进设置
左上角头像/设置 → **设置** → 左侧 **数据与备份** → 找到 **云端同步** 面板。

### 4.3 填三项

| 字段 | 填什么 |
|---|---|
| 地址 | **自动填好**：`https://你的站点.netlify.app/supa`（在 Netlify 域名下会自动切换，不要手改回 supabase.co） |
| anon key | 已内置，不用动 |
| 同步码 | 点 **生成**，得到一个 8 位码，例如 `k7m3pq2x` |

**把同步码抄到备忘录**。它是解密的唯一钥匙，丢了数据就找不回来。

### 4.4 测试连接
点 **测试连接**，会分别检查：
1. 能不能连到中转地址
2. 表在不在
3. 有没有读写权限

期望提示：**连接正常**。

### 4.5 上传
点 **上传到云端** → 显示「已上传 · 刚刚」。

去 Supabase 的 **Table Editor → sync** 看，应该多了一行：
- `code` = 你的同步码
- `payload` = 一长串看不懂的字符（密文，正常）

### 4.6 打开自动同步（可选）
勾选 **自动上传**：之后每次改动保存，8 秒后静默上传一次。

> 建议只在一台设备上开自动上传。多台同时编辑会互相覆盖（后传的赢）。

---

## 5. 第二台设备（手机 / 平板 / 另一台电脑）

1. 用同一地址打开：`https://你的站点.netlify.app`
2. 进 **设置 → 数据与备份 → 云端同步**
3. 地址和 key 会自动填好（同一站点）
4. 输入**同一个同步码**
5. 点 **从云端恢复** → 确认覆盖
6. 数据就过来了

> 第一次在新设备上打开是空工作台，这是正常的——数据在云端，恢复一次即可。

### 装成 App（iPhone / iPad）
Safari 打开 → 底部 **分享** → **添加到主屏幕** → 桌面出现「乐智托管」图标，全屏运行。

---

## 6. 验收清单

- [ ] `https://站点.netlify.app` 能打开，标题「乐智托管」
- [ ] `https://站点.netlify.app/supa/rest/v1/` 返回 JSON（不是 404）
- [ ] Supabase Table Editor 里能看到 `sync` 表
- [ ] App 里「测试连接」显示正常
- [ ] 「上传到云端」成功，sync 表出现一行，payload 是密文
- [ ] 另一台设备用同一同步码「从云端恢复」成功
- [ ] 手机添加到主屏幕后能全屏打开

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `NetworkError` / `PR_CONNECT_RESET_ERROR` | 用的是 github.io 地址，直连 supabase.co 被重置 | 换 Netlify 地址打开 |
| `relation "sync" does not exist` | 表没建 | 跑第 2.3 步的 SQL |
| `new row violates row-level security` | 只建了表，没建 policy | 重新跑完整 SQL（含三条 policy） |
| `Invalid API key` | key 复制不全 / 用了 service_role | 重新复制 publishable key |
| 测试连接 200 但上传 401 | key 与项目不匹配 | 确认 URL 和 key 来自同一个项目 |
| `/supa/rest/v1/` 返回 404 | `netlify.toml` 未生效 | Clear cache and deploy |
| `/supa/rest/v1/` 502 / 504 | Netlify 到 Supabase 超时 | 稍等重试；或换 Supabase 区域 |
| 恢复了但数据没变 | 点的是「上传」而不是「恢复」 | 注意按钮方向：上传=本地→云，恢复=云→本地 |
| 两台设备数据不一致 | 自动上传同时开着 | 只留一台开自动；另一台手动恢复 |
| 同步码丢了 | 无法解密 | 只能重新生成新码并重新上传（旧数据作废） |

---

## 8. 安全与备份

- 表里存的是 **AES-GCM 密文**，密钥由同步码经 PBKDF2（12 万次）派生。
- publishable key 是公开的，可以出现在网页里；真正保密的是同步码。
- 同步码建议 8 位随机，不要用生日、手机号。
- **仍然要定期导出备份**：设置 → 数据与备份 → 导出备份（JSON 文件存到「文件」App 或网盘）。
- 云端同步是「整包覆盖」，不是逐条合并；误删后恢复只能回到上一次上传的版本。

---

## 9. 为什么非要 Netlify 中转

国内多数网络访问 `*.supabase.co` 会被 **SNI 阻断 / 连接重置**（`PR_CONNECT_RESET_ERROR`），表现为：
- 浏览器直接打开项目地址 → 连接被重置
- App 里点测试连接 → `NetworkError` / `Failed to fetch`

而 `*.netlify.app` 可访问。所以让浏览器只连 Netlify，由 Netlify 的服务器（在境外）去访问 Supabase，就绕开了这个限制。

`netlify.toml` 里这段就是干这个的：

```toml
[[redirects]]
  from = "/supa/*"
  to = "https://msokovolvvxgtzlccpim.supabase.co/:splat"
  status = 200
  force = true
```

> 如果哪天 Netlify 也不通了，可以把这段换成 Cloudflare Worker 或自己的服务器，App 里的地址改成对应前缀即可，逻辑不变。
