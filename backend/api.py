import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import psycopg
from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from briefing import RECENT_LIMIT, render_body
from db import SCHEMA, connect
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    conn.execute(SCHEMA)
    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    return require_role("writer", "仅现场技师可提交偏航记录")(handler)


def require_role(role, denied_detail):
    def decorator(handler):
        @wraps(handler)
        async def wrapper(*args, **kwargs):
            user = await current_user()
            if user is None:
                return jsonify({"detail": "未登录"}), 401
            if user["role"] != role:
                return jsonify({"detail": denied_detail}), 403
            return await handler(user, *args, **kwargs)

        return wrapper

    return decorator


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, turbine_code, yaw_err_deg, status, verdict, reason,
                          created_by, created_at, processed_at
                   FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400
    try:
        yaw_err_deg = float(body.get("yaw_err_deg"))
    except (TypeError, ValueError):
        return jsonify({"detail": "偏航误差必须是数字"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            row = conn.execute(
                """INSERT INTO yaw_logs
                   (turbine_code, yaw_err_deg, status, verdict, reason,
                    created_by, created_at)
                   VALUES (%s, %s, 'pending', NULL, NULL, %s, %s)
                   RETURNING id, turbine_code, yaw_err_deg, status, verdict, reason,
                             created_by, created_at, processed_at""",
                (turbine_code, yaw_err_deg, user["username"], now),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(insert)
    return jsonify(row), 201


def _serialize_briefing(row):
    return {
        "id": row["id"],
        "generated_by": row["generated_by"],
        "generated_at": row["generated_at"].isoformat(),
        "pass_count": row["pass_count"],
        "fail_count": row["fail_count"],
        "pending_count": row["pending_count"],
        "recent_done": row["recent_done"],
        "body": row["body"],
    }


@app.get("/api/briefings")
@require_login
async def list_briefings(user):
    """历史简报列表：任何登录用户（含观察员）只读。"""

    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, generated_by, generated_at,
                          pass_count, fail_count, pending_count, recent_done, body
                   FROM shift_briefings
                   ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify([_serialize_briefing(row) for row in rows])


@app.get("/api/briefings/<int:briefing_id>")
@require_login
async def get_briefing(user, briefing_id):
    """打开某份旧简报：返回的是生成瞬间冻结的正文与计数。"""

    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, generated_by, generated_at,
                          pass_count, fail_count, pending_count, recent_done, body
                   FROM shift_briefings
                   WHERE id = %s""",
                (briefing_id,),
            ).fetchone()

    row = await run_db(query)
    if row is None:
        return jsonify({"detail": "简报不存在"}), 404
    return jsonify(_serialize_briefing(row))


@app.post("/api/briefings")
@require_role("writer", "观察员只能查阅旧简报，不能生成交班简报")
async def create_briefing(user):
    """技师按下「生成」键：在同一事务快照内取当班统计与最近办结提要，
    渲染正文并冻结落库；此后在线数据再变化也不会改动这条正文。"""

    now = datetime.now(timezone.utc)

    def generate():
        with connect() as conn:
            # REPEATABLE READ：计数、最近办结取自按下瞬间的同一个数据库快照，
            # 与随后 INSERT 的冻结正文在同一事务提交，互不被在线变化插入。
            conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            counts = conn.execute(
                """SELECT
                       COUNT(*) FILTER (WHERE status = 'done' AND verdict = '合格') AS pass_count,
                       COUNT(*) FILTER (WHERE status = 'done' AND verdict = '偏航超差') AS fail_count,
                       COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
                   FROM yaw_logs"""
            ).fetchone()
            recent_rows = conn.execute(
                """SELECT turbine_code, yaw_err_deg, verdict, processed_at
                   FROM yaw_logs
                   WHERE status = 'done'
                   ORDER BY processed_at DESC NULLS LAST, id DESC
                   LIMIT %s""",
                (RECENT_LIMIT,),
            ).fetchall()
            recent_done = [
                {
                    "turbine_code": r["turbine_code"],
                    "yaw_err_deg": r["yaw_err_deg"],
                    "verdict": r["verdict"],
                    "processed_at": r["processed_at"].isoformat()
                    if r["processed_at"]
                    else None,
                }
                for r in recent_rows
            ]
            recent_for_render = [
                {
                    "turbine_code": r["turbine_code"],
                    "yaw_err_deg": r["yaw_err_deg"],
                    "verdict": r["verdict"],
                    "processed_at": r["processed_at"],
                }
                for r in recent_rows
            ]
            snapshot = {
                "generated_at": now,
                "generated_by": user["username"],
                "pass_count": int(counts["pass_count"]),
                "fail_count": int(counts["fail_count"]),
                "pending_count": int(counts["pending_count"]),
                "recent_done": recent_for_render,
            }
            body = render_body(snapshot)
            row = conn.execute(
                """INSERT INTO shift_briefings
                   (generated_by, generated_at, pass_count, fail_count,
                    pending_count, recent_done, body)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id, generated_by, generated_at,
                             pass_count, fail_count, pending_count, recent_done, body""",
                (
                    user["username"],
                    now,
                    snapshot["pass_count"],
                    snapshot["fail_count"],
                    snapshot["pending_count"],
                    psycopg.types.json.Json(recent_done),
                    body,
                ),
            ).fetchone()
            conn.commit()
            return row

    row = await run_db(generate)
    return jsonify(_serialize_briefing(row)), 201
