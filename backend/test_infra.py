"""测试 Redis / MinIO / RabbitMQ 连接和基本操作"""

import asyncio
import sys
import time

results = []


def log(category: str, step: str, status: str, detail: str = ""):
    icon = "PASS" if status == "ok" else "FAIL"
    msg = f"  [{icon}] {category} - {step}"
    if detail:
        msg += f": {detail}"
    print(msg)
    results.append({"category": category, "step": step, "status": status, "detail": detail})


# ═══════════════════════════════════════
# 1. Redis 测试
# ═══════════════════════════════════════
def test_redis():
    print("\n" + "=" * 50)
    print("  Redis 测试")
    print("=" * 50)

    try:
        import redis
    except ImportError:
        log("Redis", "import redis", "fail", "redis 包未安装")
        return

    # 1.1 连接
    try:
        r = redis.Redis(host="192.168.10.76", port=6379, db=0, socket_timeout=5)
        pong = r.ping()
        log("Redis", "连接 (db=0)", "ok", f"ping={pong}")
    except Exception as e:
        log("Redis", "连接 (db=0)", "fail", str(e))
        return

    # 1.2 SET/GET
    try:
        test_key = f"test:canvas_flow:{int(time.time())}"
        r.set(test_key, "hello_redis", ex=60)
        val = r.get(test_key)
        log("Redis", "SET/GET", "ok", f"key={test_key} value={val}")
        r.delete(test_key)
    except Exception as e:
        log("Redis", "SET/GET", "fail", str(e))

    # 1.3 HASH
    try:
        h_key = f"test:hash:{int(time.time())}"
        r.hset(h_key, mapping={"name": "test_project", "status": "pending", "progress": "0.5"})
        h_val = r.hgetall(h_key)
        log("Redis", "HSET/HGETALL", "ok", f"fields={len(h_val)}")
        r.delete(h_key)
    except Exception as e:
        log("Redis", "HSET/HGETALL", "fail", str(e))

    # 1.4 LIST
    try:
        l_key = f"test:list:{int(time.time())}"
        r.rpush(l_key, "task1", "task2", "task3")
        l_len = r.llen(l_key)
        l_val = r.lrange(l_key, 0, -1)
        log("Redis", "RPUSH/LRANGE", "ok", f"len={l_len} items={l_val}")
        r.delete(l_key)
    except Exception as e:
        log("Redis", "RPUSH/LRANGE", "fail", str(e))

    # 1.5 EXPIRE / TTL
    try:
        e_key = f"test:expire:{int(time.time())}"
        r.set(e_key, "will_expire", ex=120)
        ttl = r.ttl(e_key)
        log("Redis", "EXPIRE/TTL", "ok", f"ttl={ttl}s")
        r.delete(e_key)
    except Exception as e:
        log("Redis", "EXPIRE/TTL", "fail", str(e))

    # 1.6 Celery 结果后端 (db=1)
    try:
        r1 = redis.Redis(host="192.168.10.76", port=6379, db=1, socket_timeout=5)
        r1.ping()
        log("Redis", "Celery 后端 (db=1)", "ok", "ping= True")
        r1.close()
    except Exception as e:
        log("Redis", "Celery 后端 (db=1)", "fail", str(e))

    # 1.7 服务器信息
    try:
        info = r.info("server")
        log("Redis", "服务器信息", "ok", f"version={info.get('redis_version')} uptime={info.get('uptime_in_days')}d")
        mem_info = r.info("memory")
        log("Redis", "内存使用", "ok", f"used_memory_human={mem_info.get('used_memory_human')} maxmemory_human={mem_info.get('maxmemory_human', 'unlimited')}")
        r.close()
    except Exception as e:
        log("Redis", "服务器信息", "fail", str(e))


# ═══════════════════════════════════════
# 2. MinIO 测试
# ═══════════════════════════════════════
def test_minio():
    print("\n" + "=" * 50)
    print("  MinIO 测试")
    print("=" * 50)

    try:
        from minio import Minio
    except ImportError:
        log("MinIO", "import minio", "fail", "minio 包未安装")
        return

    # 2.1 连接
    try:
        client = Minio(
            "192.168.10.76:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
            secure=False,
        )
        log("MinIO", "连接", "ok", "endpoint=192.168.10.76:9000")
    except Exception as e:
        log("MinIO", "连接", "fail", str(e))
        return

    # 2.2 检查/创建桶
    bucket_name = "ai-canvas-flow"
    try:
        exists = client.bucket_exists(bucket_name)
        if not exists:
            client.make_bucket(bucket_name)
            log("MinIO", f"创建桶 {bucket_name}", "ok", "桶不存在，已创建")
        else:
            log("MinIO", f"桶 {bucket_name}", "ok", "桶已存在")
    except Exception as e:
        log("MinIO", f"桶 {bucket_name}", "fail", str(e))

    # 2.3 上传文件
    try:
        test_data = b"AI Canvas Flow - MinIO test file content"
        test_object = f"test/upload_test_{int(time.time())}.txt"
        from io import BytesIO
        client.put_object(
            bucket_name,
            test_object,
            BytesIO(test_data),
            length=len(test_data),
            content_type="text/plain",
        )
        log("MinIO", "上传文件", "ok", f"object={test_object} size={len(test_data)}")
    except Exception as e:
        log("MinIO", "上传文件", "fail", str(e))
        return

    # 2.4 获取文件（stat）
    try:
        stat = client.stat_object(bucket_name, test_object)
        log("MinIO", "获取文件信息", "ok", f"size={stat.size} content_type={stat.content_type}")
    except Exception as e:
        log("MinIO", "获取文件信息", "fail", str(e))

    # 2.5 下载文件
    try:
        response = client.get_object(bucket_name, test_object)
        downloaded = response.read()
        response.close()
        response.release_conn()
        match = downloaded == test_data
        log("MinIO", "下载文件", "ok" if match else "fail", f"size={len(downloaded)} match={match}")
    except Exception as e:
        log("MinIO", "下载文件", "fail", str(e))

    # 2.6 预签名 URL
    try:
        from datetime import timedelta
        url = client.presigned_get_object(bucket_name, test_object, expires=timedelta(hours=1))
        log("MinIO", "预签名 URL", "ok", f"url_len={len(url)} expires=1h")
    except Exception as e:
        log("MinIO", "预签名 URL", "fail", str(e))

    # 2.7 列出文件
    try:
        objects = list(client.list_objects(bucket_name, prefix="test/", recursive=True))
        log("MinIO", "列出文件", "ok", f"test/ 下共 {len(objects)} 个对象")
    except Exception as e:
        log("MinIO", "列出文件", "fail", str(e))

    # 2.8 删除文件
    try:
        client.remove_object(bucket_name, test_object)
        log("MinIO", "删除文件", "ok", f"object={test_object}")
    except Exception as e:
        log("MinIO", "删除文件", "fail", str(e))

    # 2.9 服务器信息
    try:
        # MinIO 没有直接的 info API，通过列出所有桶来验证
        buckets = client.list_buckets()
        bucket_names = [b.name for b in buckets]
        log("MinIO", "桶列表", "ok", f"buckets={bucket_names}")
    except Exception as e:
        log("MinIO", "桶列表", "fail", str(e))


# ═══════════════════════════════════════
# 3. RabbitMQ 测试
# ═══════════════════════════════════════
def test_rabbitmq():
    print("\n" + "=" * 50)
    print("  RabbitMQ 测试")
    print("=" * 50)

    # 3.1 AMQP 连接
    try:
        import pika
    except ImportError:
        log("RabbitMQ", "import pika", "fail", "pika 包未安装，尝试 HTTP API")
        test_rabbitmq_http()
        return

    try:
        params = pika.ConnectionParameters(
            host="192.168.10.76",
            port=5672,
            credentials=pika.PlainCredentials("qzfrato", "QWE123asd.."),
            connection_attempts=3,
            socket_timeout=5,
        )
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        log("RabbitMQ", "AMQP 连接", "ok", "host=192.168.10.76:5672")
    except Exception as e:
        log("RabbitMQ", "AMQP 连接", "fail", str(e))
        test_rabbitmq_http()
        return

    # 3.2 声明队列（durable=True 兼容 RabbitMQ 4.x）
    try:
        test_queue = "test_canvas_flow_queue"
        channel.queue_declare(queue=test_queue, durable=True)
        log("RabbitMQ", "声明队列", "ok", f"queue={test_queue} durable=True")
    except Exception as e:
        log("RabbitMQ", "声明队列", "fail", str(e)[:200])

    # 3.3 发布消息
    try:
        channel.basic_publish(
            exchange="",
            routing_key=test_queue,
            body="AI Canvas Flow - RabbitMQ test message",
            properties=pika.BasicProperties(delivery_mode=2),
        )
        log("RabbitMQ", "发布消息", "ok", f"queue={test_queue}")
    except Exception as e:
        log("RabbitMQ", "发布消息", "fail", str(e)[:200])

    # 3.4 消费消息
    try:
        method, properties, body = channel.basic_get(queue=test_queue, auto_ack=True)
        if body:
            log("RabbitMQ", "消费消息", "ok", f"body={body.decode()}")
        else:
            log("RabbitMQ", "消费消息", "fail", "队列为空")
    except Exception as e:
        log("RabbitMQ", "消费消息", "fail", str(e)[:200])

    # 3.5 删除测试队列
    try:
        channel.queue_delete(queue=test_queue)
        log("RabbitMQ", "删除队列", "ok", f"queue={test_queue}")
    except Exception as e:
        log("RabbitMQ", "删除队列", "fail", str(e)[:200])

    # 3.6 Exchange 声明
    try:
        test_exchange = "test_canvas_flow_exchange"
        channel.exchange_declare(exchange=test_exchange, exchange_type="direct", durable=True)
        log("RabbitMQ", "声明 Exchange", "ok", f"exchange={test_exchange} type=direct")
        channel.exchange_delete(exchange=test_exchange)
        log("RabbitMQ", "删除 Exchange", "ok", f"exchange={test_exchange}")
    except Exception as e:
        log("RabbitMQ", "Exchange 操作", "fail", str(e)[:200])

    try:
        connection.close()
    except Exception:
        pass

    # 3.7 HTTP Management API
    test_rabbitmq_http()


def test_rabbitmq_http():
    """通过 HTTP Management API 获取 RabbitMQ 状态"""
    try:
        import urllib.request
        import base64
        import json

        url = "http://192.168.10.76:15672/api/overview"
        credentials = base64.b64encode(b"qzfrato:QWE123asd..").decode()
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {credentials}"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            log("RabbitMQ", "Management API", "ok",
                f"version={data.get('rabbitmq_version')} "
                f"cluster_name={data.get('cluster_name')} "
                f"msg_ready={data.get('queue_totals', {}).get('messages_ready', 0)}")

        # 获取队列列表
        url_queues = "http://192.168.10.76:15672/api/queues"
        req_queues = urllib.request.Request(url_queues, headers={"Authorization": f"Basic {credentials}"})
        with urllib.request.urlopen(req_queues, timeout=5) as resp:
            queues = json.loads(resp.read().decode())
            queue_names = [q["name"] for q in queues]
            log("RabbitMQ", "队列列表", "ok", f"queues={queue_names if queue_names else '(空)'}")

        # 获取 Exchange 列表
        url_exchanges = "http://192.168.10.76:15672/api/exchanges"
        req_exchanges = urllib.request.Request(url_exchanges, headers={"Authorization": f"Basic {credentials}"})
        with urllib.request.urlopen(req_exchanges, timeout=5) as resp:
            exchanges = json.loads(resp.read().decode())
            user_exchanges = [e["name"] for e in exchanges if e["name"] and not e["name"].startswith("amq.")]
            log("RabbitMQ", "Exchange 列表", "ok", f"user_exchanges={user_exchanges if user_exchanges else '(空)'}")

    except Exception as e:
        log("RabbitMQ", "Management API", "fail", str(e))


# ═══════════════════════════════════════
# 主函数
# ═══════════════════════════════════════
if __name__ == "__main__":
    print("=" * 50)
    print("  AI Canvas Flow - 基础设施测试")
    print("=" * 50)

    test_redis()
    test_minio()
    test_rabbitmq()

    # 汇总
    print("\n" + "=" * 50)
    print("  测试汇总")
    print("=" * 50)
    passed = sum(1 for r in results if r["status"] == "ok")
    failed = sum(1 for r in results if r["status"] == "fail")
    print(f"  通过: {passed}  失败: {failed}  总计: {len(results)}")

    if failed > 0:
        print("\n  失败项:")
        for r in results:
            if r["status"] == "fail":
                print(f"    - [{r['category']}] {r['step']}: {r['detail']}")

    sys.exit(0 if failed == 0 else 1)
