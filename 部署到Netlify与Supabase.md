# 用 Netlify + Supabase 部署和同步

这套方案把「网页」和「数据」分开：

- **Netlify**：托管网页（打开网址就能用，和现在的 GitHub Pages 一样）
- **Supabase**：存同步数据（免费的 PostgreSQL + 自动 API）
- **同步码**：你在 App 里的一串 8 位字母数字，多台设备填同一个码就共用一份数据

数据在离开设备前会用同步码派生的密钥加密（PBKDF2 + AES-GCM），Supabase 里看到的是乱码。

---

## 一、建 Supabase（约 5 分钟）

1. 打开 https://supabase.com 注册，New project
2. 名称随意，数据库密码记好（本方案用不到，但重设麻烦），区域选 Singapore 或 Tokyo
3. 等 1–2 分钟初始化完成
4. 左侧 **SQL Editor** → New query，粘贴执行：

```sql
create table if not exists public.sync (
  code text primary key,
  payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.sync enable row level security;

create policy "sync read" on public.sync
  for select using (true);

create policy "sync insert" on public.sync
  for insert with check (true);

create policy "sync update" on public.sync
  for update using (true);
```

5. 左侧 **Project Settings → API**，记下两个值：
   - `Project URL`，形如 `https://abcdefgh.supabase.co`
   - `anon public` key，形如 `eyJhbGciOi...`

> anon key 是公开的，会写进网页；数据安全靠同步码加密，**同步码不要外传**。

---

## 二、部署到 Netlify（约 2 分钟）

**方式 A：拖拽上传（最简单）**

1. 打开 https://app.netlify.com/drop
2. 把 `workstation-teacher` 文件夹整个拖进去
3. 完成，得到形如 `https://随机名.netlify.app` 的地址
4. 可在 Site settings → Change site name 改成好记的名字

**方式 B：连 Git 仓库**

1. Netlify → Add new site → Import an existing project → GitHub → 选 `student-manage`
2. Build command 留空，Publish directory 填 `.`
3. Deploy

仓库里已有 `netlify.toml`，会自动按「不构建、直接发布根目录」处理。

---

## 三、在 App 里开启同步

1. 打开 Netlify 网址（或原来的 GitHub Pages 地址）
2. 设置 → 数据与备份 → 云端同步
3. 填 Supabase 地址、anon key
4. 点「生成」得到同步码，**抄下来**（比如 `k7m2p9qd`）
5. 点「上传到云端」

换设备时：填同样的地址、key、同步码 → 点「从云端恢复」。

---

## 四、注意事项

| 事项 | 说明 |
|---|---|
| 同步码丢失 | 无法解密云端数据，只能从旧设备重新生成并上传 |
| 同时编辑 | 自动上传是整份覆盖，两台设备同时改会互相覆盖，建议只在一台设备上编辑 |
| 免费额度 | Supabase 免费版 500 MB 数据库，整套数据通常不到 1 MB，够用很久 |
| 隐私 | 云端只存密文；但同步码只有 8 位，别公开分享 |
| 备份 | 云端同步不等于备份，仍建议每周导出一次 JSON |

---

## 五、和 GitHub Pages 的关系

两套地址可以并存：

- GitHub Pages：`https://qiyuting0827.github.io/student-manage/`
- Netlify：`https://你的名字.netlify.app`

**注意**：不同域名是不同浏览器存储，数据不互通。选一个作为日常入口，另一台设备用同步码恢复即可。
