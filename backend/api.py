import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from psycopg.types.json import Json
from quart import Quart, jsonify, request

from db import SCHEMA, connect
from rules import judge

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

BRIEFING_COLS = (
    "id, created_by, created_at, pending_count, ok_count, over_count, "
    "recent_done, body"
)

# 生成瞬间取一次快照：三笔计数 + 最近 5 笔已办结记录的提要。
# 两条查询必须在同一个 REPEATABLE READ 事务里执行，共享同一快照。
STATS_SQL = """
SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'done' AND verdict = '合格') AS ok_count,
    COUNT(*) FILTER (WHERE status = 'done' AND verdict = '偏航超差') AS over_count
FROM yaw_logs
"""

RECENT_DONE_SQL = """
SELECT id, turbine_code, yaw_err_deg, verdict, reason, created_by, processed_at
FROM yaw_logs
WHERE status = 'done'
ORDER BY id DESC
LIMIT 5
"""


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
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


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


def _iso(dt):
    return dt.isoformat() if dt is not None else None


def serialize_briefing(row):
    """落库行转 JSON；时间戳转 ISO，recent_done 已是 jsonb 反序列化结果。"""
    return {
        "id": row["id"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat(),
        "pending_count": row["pending_count"],
        "ok_count": row["ok_count"],
        "over_count": row["over_count"],
        "recent_done": row["recent_done"],
        "body": row["body"],
    }


def render_briefing_body(created_at, username, counts, recent_done):
    """根据按下瞬间的快照渲染冻结正文，之后不再重算。"""
    total = (
        counts["pending_count"] + counts["ok_count"] + counts["over_count"]
    )
    lines = [
        "交班签出简报",
        f"生成时间：{created_at.isoformat()}",
        f"交班技师：{username}",
        "",
        (
            f"截至生成时刻，对中记录共 {total} 笔：待处理 "
            f"{counts['pending_count']} 笔、合格 {counts['ok_count']} 笔、"
            f"偏航超差 {counts['over_count']} 笔。"
        ),
        "",
        "最近办结提要：",
    ]
    if recent_done:
        for idx, rec in enumerate(recent_done, 1):
            lines.append(
                f"{idx}. #{rec['id']} 机组 {rec['turbine_code']}，"
                f"误差 {rec['yaw_err_deg']}°，结论 {rec['verdict']}"
                f"（{rec['reason']}），办结于 {rec['processed_at']}"
            )
    else:
        lines.append("（暂无已办结记录）")
    return "\n".join(lines)


@app.post("/api/briefings")
@require_writer
async def create_briefing(user):
    now = datetime.now(timezone.utc)

    def generate():
        with connect() as conn:
            with conn.transaction():
                # 同一事务、同一快照内统计并写正文，确保落库的是“按下瞬间”。
                conn.execute(
                    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
                )
                counts = conn.execute(STATS_SQL).fetchone()
                rows = conn.execute(RECENT_DONE_SQL).fetchall()
                recent_done = [
                    {
                        "id": r["id"],
                        "turbine_code": r["turbine_code"],
                        "yaw_err_deg": r["yaw_err_deg"],
                        "verdict": r["verdict"],
                        "reason": r["reason"],
                        "created_by": r["created_by"],
                        "processed_at": _iso(r["processed_at"]),
                    }
                    for r in rows
                ]
                body = render_briefing_body(
                    now, user["username"], counts, recent_done
                )
                row = conn.execute(
                    f"""INSERT INTO shift_briefings
                        (created_by, created_at, pending_count, ok_count,
                         over_count, recent_done, body)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        RETURNING {BRIEFING_COLS}""",
                    (
                        user["username"],
                        now,
                        counts["pending_count"],
                        counts["ok_count"],
                        counts["over_count"],
                        Json(recent_done),
                        body,
                    ),
                ).fetchone()
            conn.commit()
            return row

    row = await run_db(generate)
    return jsonify(serialize_briefing(row)), 201


@app.get("/api/briefings")
@require_login
async def list_briefings(user):
    def query():
        with connect() as conn:
            return conn.execute(
                f"SELECT {BRIEFING_COLS} FROM shift_briefings ORDER BY id DESC"
            ).fetchall()

    rows = await run_db(query)
    return jsonify([serialize_briefing(r) for r in rows])


@app.get("/api/briefings/<int:briefing_id>")
@require_login
async def get_briefing(user, briefing_id):
    def query():
        with connect() as conn:
            return conn.execute(
                f"SELECT {BRIEFING_COLS} FROM shift_briefings WHERE id = %s",
                (briefing_id,),
            ).fetchone()

    row = await run_db(query)
    if row is None:
        return jsonify({"detail": "简报不存在"}), 404
    return jsonify(serialize_briefing(row))
