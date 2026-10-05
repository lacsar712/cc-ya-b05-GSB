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

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。
4. 顶栏「交班签出简报」专页：
   - technician 点「生成简报」，后端在 `REPEATABLE READ` 单事务内取当时的合格/偏航超差/待处理计数与最近 5 笔办结提要，渲染正文并冻结落库（`shift_briefings`）；左侧历史列表与右侧正文预览均读自已落库记录。
   - 生成后再提交新单（含 worker 办结），重新打开旧简报，计数与正文仍停在生成那一刻；历史列表按生成时间倒序。
   - observer 只见历史与正文，无生成键；直接调 `POST /api/briefings` 返回 403。

## 接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/briefings` | writer | 生成并冻结一份交班简报 |
| GET | `/api/briefings` | 登录 | 历史简报列表（id 倒序） |
| GET | `/api/briefings/{id}` | 登录 | 单份简报的冻结正文与计数 |

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
