"""向 Redis / MinIO / RabbitMQ 写入持久化测试数据，并验证数据存在"""

import asyncio
import json
import time
import sys

TS = int(time.time())
RESULTS = []


def log(category, step, status, detail=""):
    icon = "PASS" if status == "ok" else "FAIL"
    msg = f"  [{icon}] {category} - {step}"
    if detail:
        msg += f": {detail}"
    print(msg)
    RESULTS.append({"category": category, "step": step, "status": status, "detail": detail})


# ═══════════════════════════════════════
# 1. Redis — 写入持久化测试数据
# ═══════════════════════════════════════
def test_redis():
    print("\n" + "=" * 50)
    print("  Redis — 写入持久化测试数据")
    print("=" * 50)

    import redis as rlib
    r = rlib.Redis(host="192.168.10.76", port=6379, db=0, socket_timeout=10, decode_responses=True)

    # 1.1 用户会话缓存
    try:
        session_key = f"session:user:fulltest_{TS}"
        session_data = {
            "user_id": f"fulltest_{TS}",
            "username": f"fulltest_{TS}",
            "email": f"fulltest_{TS}@test.com",
            "login_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        r.hset(session_key, mapping=session_data)
        r.expire(session_key, 86400 * 7)  # 7天过期
        log("Redis", "用户会话缓存", "ok", f"key={session_key} ttl=7d")
    except Exception as e:
        log("Redis", "用户会话缓存", "fail", str(e)[:200])

    # 1.2 项目缓存
    try:
        proj_key = f"cache:project:proj_{TS}"
        proj_data = {
            "id": f"proj_{TS}",
            "name": f"Redis测试项目_{TS}",
            "owner_id": f"fulltest_{TS}",
            "status": "active",
            "node_count": "5",
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        r.hset(proj_key, mapping=proj_data)
        r.expire(proj_key, 86400 * 3)  # 3天过期
        log("Redis", "项目缓存", "ok", f"key={proj_key} ttl=3d")
    except Exception as e:
        log("Redis", "项目缓存", "fail", str(e)[:200])

    # 1.3 渲染任务状态
    try:
        task_key = f"task:render:task_{TS}"
        task_data = {
            "task_id": f"task_{TS}",
            "project_id": f"proj_{TS}",
            "status": "pending",
            "progress": "0.0",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        r.hset(task_key, mapping=task_data)
        r.expire(task_key, 86400)  # 1天过期
        log("Redis", "渲染任务状态", "ok", f"key={task_key} ttl=1d")
    except Exception as e:
        log("Redis", "渲染任务状态", "fail", str(e)[:200])

    # 1.4 在线用户列表
    try:
        online_key = "collab:online_users"
        r.sadd(online_key, f"fulltest_{TS}", f"editor_{TS}", f"viewer_{TS}")
        log("Redis", "在线用户集合", "ok", f"key={online_key} members={r.scard(online_key)}")
    except Exception as e:
        log("Redis", "在线用户集合", "fail", str(e)[:200])

    # 1.5 操作日志列表
    try:
        log_key = f"logs:project:proj_{TS}"
        for i in range(5):
            r.rpush(log_key, json.dumps({
                "action": "node_update",
                "node_id": f"node_{i}",
                "user": f"fulltest_{TS}",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            }))
        r.expire(log_key, 86400)
        log("Redis", "操作日志列表", "ok", f"key={log_key} len={r.llen(log_key)}")
    except Exception as e:
        log("Redis", "操作日志列表", "fail", str(e)[:200])

    # 1.6 速率限制计数器
    try:
        rate_key = f"ratelimit:fulltest_{TS}:api"
        for _ in range(10):
            r.incr(rate_key)
        r.expire(rate_key, 60)
        log("Redis", "速率限制计数器", "ok", f"key={rate_key} count={r.get(rate_key)}")
    except Exception as e:
        log("Redis", "速率限制计数器", "fail", str(e)[:200])

    # 1.7 验证所有 key 存在
    try:
        keys = r.keys(f"*{TS}*")
        log("Redis", "验证数据存在", "ok", f"匹配 {TS} 的 key 数量: {len(keys)}")
        for k in keys:
            ttl = r.ttl(k)
            log("Redis", f"  key: {k}", "ok", f"ttl={ttl}s")
    except Exception as e:
        log("Redis", "验证数据存在", "fail", str(e)[:200])

    r.close()


# ═══════════════════════════════════════
# 2. MinIO — 上传持久化测试文件
# ═══════════════════════════════════════
def test_minio():
    print("\n" + "=" * 50)
    print("  MinIO — 上传持久化测试文件")
    print("=" * 50)

    from minio import Minio
    from io import BytesIO
    from app.config import settings

    client = Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )
    bucket = settings.MINIO_BUCKET

    # 2.1 上传项目封面
    try:
        cover_data = b"PNG_FAKE_HEADER" + b"\x89PNG\r\n\x1a\n" + b"project cover image data " * 100
        cover_path = f"projects/proj_{TS}/cover.png"
        client.put_object(bucket, cover_path, BytesIO(cover_data), len(cover_data), content_type="image/png")
        stat = client.stat_object(bucket, cover_path)
        log("MinIO", "上传项目封面", "ok", f"path={cover_path} size={stat.size}")
    except Exception as e:
        log("MinIO", "上传项目封面", "fail", str(e)[:200])

    # 2.2 上传媒体资产
    try:
        media_data = b"FAKE_PNG_DATA" + b"\x00" * 1024 + b"test media asset content"
        media_path = f"media/fulltest_{TS}/asset_{TS}.png"
        client.put_object(bucket, media_path, BytesIO(media_data), len(media_data), content_type="image/png")
        stat = client.stat_object(bucket, media_path)
        log("MinIO", "上传媒体资产", "ok", f"path={media_path} size={stat.size}")
    except Exception as e:
        log("MinIO", "上传媒体资产", "fail", str(e)[:200])

    # 2.3 上传缩略图
    try:
        thumb_data = b"THUMB_DATA" + b"\x00" * 256
        thumb_path = f"media/fulltest_{TS}/thumb_{TS}.png"
        client.put_object(bucket, thumb_path, BytesIO(thumb_data), len(thumb_data), content_type="image/png")
        stat = client.stat_object(bucket, thumb_path)
        log("MinIO", "上传缩略图", "ok", f"path={thumb_path} size={stat.size}")
    except Exception as e:
        log("MinIO", "上传缩略图", "fail", str(e)[:200])

    # 2.4 上传工作流配置 JSON
    try:
        workflow_config = json.dumps({
            "project_id": f"proj_{TS}",
            "nodes": [
                {"id": "node_0", "type": "text2img", "position": {"x": 100, "y": 200}},
                {"id": "node_1", "type": "img2video", "position": {"x": 400, "y": 200}},
                {"id": "node_2", "type": "tts", "position": {"x": 100, "y": 400}},
            ],
            "edges": [
                {"source": "node_0", "target": "node_1"},
                {"source": "node_2", "target": "node_1"},
            ],
        }, indent=2).encode()
        config_path = f"projects/proj_{TS}/workflow.json"
        client.put_object(bucket, config_path, BytesIO(workflow_config), len(workflow_config), content_type="application/json")
        stat = client.stat_object(bucket, config_path)
        log("MinIO", "上传工作流配置", "ok", f"path={config_path} size={stat.size}")
    except Exception as e:
        log("MinIO", "上传工作流配置", "fail", str(e)[:200])

    # 2.5 验证所有文件
    try:
        prefix = f"projects/proj_{TS}/"
        proj_files = list(client.list_objects(bucket, prefix=prefix, recursive=True))
        log("MinIO", f"项目文件列表 ({prefix})", "ok", f"{len(proj_files)} 个文件")

        prefix2 = f"media/fulltest_{TS}/"
        media_files = list(client.list_objects(bucket, prefix=prefix2, recursive=True))
        log("MinIO", f"媒体文件列表 ({prefix2})", "ok", f"{len(media_files)} 个文件")

        total = len(proj_files) + len(media_files)
        log("MinIO", "总计持久化文件", "ok", f"{total} 个")
    except Exception as e:
        log("MinIO", "验证文件列表", "fail", str(e)[:200])


# ═══════════════════════════════════════
# 3. RabbitMQ — 创建持久化队列和交换机
# ═══════════════════════════════════════
def test_rabbitmq():
    print("\n" + "=" * 50)
    print("  RabbitMQ — 创建持久化队列和交换机")
    print("=" * 50)

    import pika

    params = pika.ConnectionParameters(
        host="192.168.10.76",
        port=5672,
        credentials=pika.PlainCredentials("qzfrato", "QWE123asd.."),
        connection_attempts=3,
        socket_timeout=10,
    )
    connection = pika.BlockingConnection(params)
    channel = connection.channel()

    # 3.1 创建 render 任务队列
    try:
        channel.queue_declare(queue="canvas.render", durable=True)
        log("RabbitMQ", "创建渲染队列", "ok", "queue=canvas.render durable=True")
    except Exception as e:
        log("RabbitMQ", "创建渲染队列", "fail", str(e)[:200])

    # 3.2 创建 AI 推理任务队列
    try:
        channel.queue_declare(queue="canvas.ai_inference", durable=True)
        log("RabbitMQ", "创建AI推理队列", "ok", "queue=canvas.ai_inference durable=True")
    except Exception as e:
        log("RabbitMQ", "创建AI推理队列", "fail", str(e)[:200])

    # 3.3 创建通知队列
    try:
        channel.queue_declare(queue="canvas.notifications", durable=True)
        log("RabbitMQ", "创建通知队列", "ok", "queue=canvas.notifications durable=True")
    except Exception as e:
        log("RabbitMQ", "创建通知队列", "fail", str(e)[:200])

    # 3.4 创建任务交换机
    try:
        channel.exchange_declare(exchange="canvas.tasks", exchange_type="direct", durable=True)
        log("RabbitMQ", "创建任务交换机", "ok", "exchange=canvas.tasks type=direct durable=True")
    except Exception as e:
        log("RabbitMQ", "创建任务交换机", "fail", str(e)[:200])

    # 3.5 创建事件交换机
    try:
        channel.exchange_declare(exchange="canvas.events", exchange_type="topic", durable=True)
        log("RabbitMQ", "创建事件交换机", "ok", "exchange=canvas.events type=topic durable=True")
    except Exception as e:
        log("RabbitMQ", "创建事件交换机", "fail", str(e)[:200])

    # 3.6 绑定队列到交换机
    try:
        channel.queue_bind(queue="canvas.render", exchange="canvas.tasks", routing_key="render")
        log("RabbitMQ", "绑定渲染队列", "ok", "canvas.render ← canvas.tasks (routing_key=render)")
    except Exception as e:
        log("RabbitMQ", "绑定渲染队列", "fail", str(e)[:200])

    try:
        channel.queue_bind(queue="canvas.ai_inference", exchange="canvas.tasks", routing_key="ai")
        log("RabbitMQ", "绑定AI队列", "ok", "canvas.ai_inference ← canvas.tasks (routing_key=ai)")
    except Exception as e:
        log("RabbitMQ", "绑定AI队列", "fail", str(e)[:200])

    try:
        channel.queue_bind(queue="canvas.notifications", exchange="canvas.events", routing_key="event.#")
        log("RabbitMQ", "绑定通知队列", "ok", "canvas.notifications ← canvas.events (routing_key=event.#)")
    except Exception as e:
        log("RabbitMQ", "绑定通知队列", "fail", str(e)[:200])

    # 3.7 发布测试消息
    try:
        channel.basic_publish(
            exchange="canvas.tasks",
            routing_key="render",
            body=json.dumps({
                "task_id": f"task_{TS}",
                "project_id": f"proj_{TS}",
                "type": "render",
                "status": "pending",
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }),
            properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
        )
        log("RabbitMQ", "发布渲染任务消息", "ok", "exchange=canvas.tasks routing_key=render")
    except Exception as e:
        log("RabbitMQ", "发布渲染任务消息", "fail", str(e)[:200])

    try:
        channel.basic_publish(
            exchange="canvas.events",
            routing_key="event.project.created",
            body=json.dumps({
                "event": "project.created",
                "project_id": f"proj_{TS}",
                "user": f"fulltest_{TS}",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            }),
            properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
        )
        log("RabbitMQ", "发布项目事件消息", "ok", "exchange=canvas.events routing_key=event.project.created")
    except Exception as e:
        log("RabbitMQ", "发布项目事件消息", "fail", str(e)[:200])

    try:
        connection.close()
    except Exception:
        pass

    # 3.8 通过 Management API 验证
    try:
        import urllib.request
        import base64

        cred = base64.b64encode(b"qzfrato:QWE123asd..").decode()

        # 队列
        req = urllib.request.Request(
            "http://192.168.10.76:15672/api/queues",
            headers={"Authorization": f"Basic {cred}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            queues = json.loads(resp.read().decode())
            canvas_queues = [q for q in queues if q["name"].startswith("canvas.")]
            log("RabbitMQ", "验证队列", "ok", f"canvas.* 队列: {[q['name'] for q in canvas_queues]}")
            for q in canvas_queues:
                log("RabbitMQ", f"  队列 {q['name']}", "ok",
                    f"messages={q.get('messages', 0)} consumers={q.get('consumers', 0)} durable={q.get('durable')}")

        # 交换机
        req = urllib.request.Request(
            "http://192.168.10.76:15672/api/exchanges",
            headers={"Authorization": f"Basic {cred}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            exchanges = json.loads(resp.read().decode())
            canvas_exchanges = [e for e in exchanges if e["name"].startswith("canvas.")]
            log("RabbitMQ", "验证交换机", "ok", f"canvas.* 交换机: {[e['name'] for e in canvas_exchanges]}")
            for e in canvas_exchanges:
                log("RabbitMQ", f"  交换机 {e['name']}", "ok",
                    f"type={e.get('type')} durable={e.get('durable')}")

        # 绑定
        req = urllib.request.Request(
            "http://192.168.10.76:15672/api/bindings",
            headers={"Authorization": f"Basic {cred}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            bindings = json.loads(resp.read().decode())
            canvas_bindings = [b for b in bindings if b.get("source", "").startswith("canvas.")]
            log("RabbitMQ", "验证绑定", "ok", f"canvas.* 绑定数: {len(canvas_bindings)}")
            for b in canvas_bindings:
                log("RabbitMQ", f"  绑定", "ok",
                    f"{b['source']} → {b['destination']} (routing_key={b.get('routing_key', '')})")

    except Exception as e:
        log("RabbitMQ", "Management API 验证", "fail", str(e)[:200])


# ═══════════════════════════════════════
# 主函数
# ═══════════════════════════════════════
if __name__ == "__main__":
    print("=" * 50)
    print("  AI Canvas Flow - 持久化测试数据写入")
    print(f"  时间戳: {TS}")
    print("=" * 50)

    test_redis()
    test_minio()
    test_rabbitmq()

    # 汇总
    print("\n" + "=" * 50)
    print("  汇总")
    print("=" * 50)
    passed = sum(1 for r in RESULTS if r["status"] == "ok")
    failed = sum(1 for r in RESULTS if r["status"] == "fail")
    print(f"  通过: {passed}  失败: {failed}  总计: {len(RESULTS)}")

    if failed > 0:
        print("\n  失败项:")
        for r in RESULTS:
            if r["status"] == "fail":
                print(f"    - [{r['category']}] {r['step']}: {r['detail']}")

    sys.exit(0 if failed == 0 else 1)
