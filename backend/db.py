import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS shift_briefings (
    id serial PRIMARY KEY,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    pending_count integer NOT NULL,
    ok_count integer NOT NULL,
    over_count integer NOT NULL,
    recent_done jsonb NOT NULL,
    body text NOT NULL
);
"""
