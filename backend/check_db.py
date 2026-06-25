"""数据库验证脚本 — 查询各表行数和最新数据"""
import asyncio, asyncpg

DB_URL = "postgresql://postgres:QWE123asd..@192.168.10.76:5432/ai_canvas_flow"

async def check(label=""):
    conn = await asyncpg.connect(DB_URL)
    if label:
        print(f"\n=== {label} ===")
    for t in ["users", "projects", "media_assets", "render_tasks", "workflow_nodes", "workflow_edges"]:
        c = await conn.fetchval(f"SELECT count(*) FROM {t}")
        print(f"  {t}: {c}")

    # 最新用户
    rows = await conn.fetch("SELECT id, username, email FROM users ORDER BY id DESC LIMIT 3")
    for r in rows:
        print(f"  [user] {r['id']} | {r['username']} | {r['email']}")

    # 最新项目
    rows = await conn.fetch("SELECT id, name, owner_id FROM projects ORDER BY created_at DESC LIMIT 3")
    for r in rows:
        print(f"  [project] {r['id']} | {r['name']} | owner={r['owner_id']}")

    # 最新媒体
    rows = await conn.fetch("SELECT id, file_name, owner_id, file_size FROM media_assets ORDER BY created_at DESC LIMIT 3")
    for r in rows:
        print(f"  [media] {r['id']} | {r['file_name']} | owner={r['owner_id']} | size={r['file_size']}")

    # 最新渲染
    rows = await conn.fetch("SELECT id, project_id, status, task_type FROM render_tasks ORDER BY created_at DESC LIMIT 3")
    for r in rows:
        print(f"  [render] {r['id']} | project={r['project_id']} | status={r['status']} | type={r['task_type']}")

    await conn.close()

if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "数据库状态"
    asyncio.run(check(label))
