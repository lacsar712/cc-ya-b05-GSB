# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 交班简报

顶栏「交班简报」页用于技师交班签出：

- **生成**：技师点「生成交班简报」，后端在一个 `REPEATABLE READ` 事务内取按下瞬间的快照——待处理 / 合格 / 偏航超差三笔计数与最近 5 笔已办结记录提要——渲染成正文后**整体落库冻结**。此后在线记录（含 worker 办结）再变化，已生成简报的计数与正文逐字不变。
- **历史与预览**：左侧历史列表（编号、时间、生成人、三笔计数），点条目调 `GET /api/briefings/<id>` 读取落库正文展示在右侧预览。
- **权限**：仅 `technician`（writer）能生成；`observer`（reader）只读历史简报与正文，页面无生成键，直接调接口返回 403。

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/briefings` | writer | 按当前快照生成并冻结一份简报，返回落库行 |
| GET | `/api/briefings` | 登录 | 历史列表（id 倒序） |
| GET | `/api/briefings/<id>` | 登录 | 单份简报的冻结正文 |

简报落在 `shift_briefings` 表（`pending_count` / `ok_count` / `over_count` / `recent_done` jsonb / `body` 文本），表随服务启动 `CREATE TABLE IF NOT EXISTS` 自动建立。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. technician 切到「交班简报」点生成：正文写入当时的待处理/合格/偏航超差计数与最近办结提要；随后再提交一笔新单（待处理或被 worker 办结为超差），重新打开第一份旧简报，其计数与正文仍停在生成那一刻；历史列表计数同样不变。
5. observer 进入「交班简报」只看到历史与只读正文，无生成键；对 `POST /api/briefings` 直接发请求返回 403。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
