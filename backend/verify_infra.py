"""验证 Redis/MinIO/RabbitMQ 中持久化数据是否存在"""
import redis
import json
import urllib.request
import base64

def verify_redis():
    print("\n=== Redis 持久化数据验证 ===")
    r = redis.Redis(host="192.168.10.76", port=6379, db=0, decode_responses=True)

    # 用户会话
    keys = r.keys("session:user:*")
    print(f"\n用户会话 (session:user:*): {len(keys)} 条")
    for k in keys:
        data = r.hgetall(k)
        print(f"  {k}: {data}")

    # 项目缓存
    keys = r.keys("cache:project:*")
    print(f"\n项目缓存 (cache:project:*): {len(keys)} 条")
    for k in keys:
        data = r.hgetall(k)
        print(f"  {k}: {data}")

    # 渲染任务
    keys = r.keys("task:render:*")
    print(f"\n渲染任务 (task:render:*): {len(keys)} 条")
    for k in keys:
        data = r.hgetall(k)
        print(f"  {k}: {data}")

    # 在线用户
    members = r.smembers("collab:online_users")
    print(f"\n在线用户 (collab:online_users): {members}")

    # 操作日志
    keys = r.keys("logs:project:*")
    print(f"\n操作日志 (logs:project:*): {len(keys)} 个")
    for k in keys:
        length = r.llen(k)
        items = r.lrange(k, 0, 2)
        print(f"  {k}: {length} 条日志 (前3条: {[json.loads(i)['action'] for i in items]})")

    # 速率限制
    keys = r.keys("ratelimit:*")
    print(f"\n速率限制 (ratelimit:*): {len(keys)} 个")
    for k in keys:
        print(f"  {k}: count={r.get(k)}")

    r.close()


def verify_minio():
    print("\n=== MinIO 持久化数据验证 ===")
    from minio import Minio

    client = Minio("192.168.10.76:9000", access_key="minioadmin", secret_key="minioadmin", secure=False)
    bucket = "ai-canvas-flow"

    # 列出所有项目文件
    proj_files = list(client.list_objects(bucket, prefix="projects/", recursive=True))
    print(f"\n项目文件 (projects/*): {len(proj_files)} 个")
    for obj in proj_files:
        print(f"  {obj.object_name}  size={obj.size}  modified={obj.last_modified}")

    # 列出所有媒体文件
    media_files = list(client.list_objects(bucket, prefix="media/", recursive=True))
    print(f"\n媒体文件 (media/*): {len(media_files)} 个")
    for obj in media_files:
        print(f"  {obj.object_name}  size={obj.size}  modified={obj.last_modified}")

    # 桶列表
    buckets = client.list_buckets()
    print(f"\n桶列表: {[b.name for b in buckets]}")


def verify_rabbitmq():
    print("\n=== RabbitMQ 持久化数据验证 ===")
    cred = base64.b64encode(b"qzfrato:QWE123asd..").decode()
    headers_func = lambda: {"Authorization": f"Basic {cred}"}

    # 队列
    req = urllib.request.Request("http://192.168.10.76:15672/api/queues", headers=headers_func())
    with urllib.request.urlopen(req, timeout=10) as resp:
        queues = json.loads(resp.read().decode())
    canvas_q = [q for q in queues if q["name"].startswith("canvas.")]
    print(f"\ncanvas.* 队列: {len(canvas_q)} 个")
    for q in canvas_q:
        print(f"  {q['name']}: messages={q['messages']} durable={q['durable']} consumers={q['consumers']}")

    # 交换机
    req = urllib.request.Request("http://192.168.10.76:15672/api/exchanges", headers=headers_func())
    with urllib.request.urlopen(req, timeout=10) as resp:
        exchanges = json.loads(resp.read().decode())
    canvas_e = [e for e in exchanges if e["name"].startswith("canvas.")]
    print(f"\ncanvas.* 交换机: {len(canvas_e)} 个")
    for e in canvas_e:
        print(f"  {e['name']}: type={e['type']} durable={e['durable']}")

    # 绑定
    req = urllib.request.Request("http://192.168.10.76:15672/api/bindings", headers=headers_func())
    with urllib.request.urlopen(req, timeout=10) as resp:
        bindings = json.loads(resp.read().decode())
    canvas_b = [b for b in bindings if b.get("source", "").startswith("canvas.")]
    print(f"\ncanvas.* 绑定: {len(canvas_b)} 个")
    for b in canvas_b:
        print(f"  {b['source']} → {b['destination']} (routing_key={b.get('routing_key', '')})")

    # 队列中的消息
    for q in canvas_q:
        if q["messages"] > 0:
            req = urllib.request.Request(
                f"http://192.168.10.76:15672/api/queues/%2F/{q['name']}/get",
                data=json.dumps({"count": 5, "ackmode": "ack_requeue_false", "encoding": "auto"}).encode(),
                headers={**headers_func(), "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                msgs = json.loads(resp.read().decode())
            print(f"\n  {q['name']} 中的消息:")
            for m in msgs:
                print(f"    payload: {m.get('payload', '')[:200]}")


if __name__ == "__main__":
    verify_redis()
    verify_minio()
    verify_rabbitmq()
