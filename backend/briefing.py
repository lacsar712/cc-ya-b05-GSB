"""交班签出简报正文渲染。

正文在「按下生成键」的瞬间由后端依据当时的数据库快照一次性渲染并冻结落库；
之后在线数据再变化也不会改写已生成的正文，因此本模块只接受已取定的快照，
绝不自行访问数据库。
"""

RECENT_LIMIT = 5


def render_body(snapshot: dict) -> str:
    """根据快照渲染简报正文（纯文本）。

    snapshot 字段：
      generated_at: 生成时刻（datetime）
      generated_by: 生成人用户名
      pass_count / fail_count / pending_count: 生成瞬间的计数
      recent_done: 最近办结记录列表，元素含
                   turbine_code / yaw_err_deg / verdict / processed_at
    """
    lines = [
        "交班签出简报",
        f"生成时间：{snapshot['generated_at'].strftime('%Y-%m-%d %H:%M:%S %Z').strip()}",
        f"生成人：{snapshot['generated_by']}",
        "",
        "当班计数（生成瞬间冻结）：",
        f"  合格：{snapshot['pass_count']} 笔",
        f"  偏航超差：{snapshot['fail_count']} 笔",
        f"  待处理：{snapshot['pending_count']} 笔",
        "",
        f"最近办结提要（最多 {RECENT_LIMIT} 笔）：",
    ]
    recent = snapshot["recent_done"]
    if not recent:
        lines.append("  （暂无已办结记录）")
    else:
        for item in recent:
            processed_at = item["processed_at"]
            if hasattr(processed_at, "strftime"):
                when = processed_at.strftime("%Y-%m-%d %H:%M:%S")
            else:
                when = str(processed_at)
            lines.append(
                f"  · {item['turbine_code']}　误差 {item['yaw_err_deg']}°"
                f"　结论：{item['verdict']}　办结：{when}"
            )
    return "\n".join(lines)
