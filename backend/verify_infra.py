"""验证 Redis/MinIO/RabbitMQ 中持久化数据是否存在"""

import json
import sys
import urllib.parse
import urllib.request
import base64

RESULTS = []


def log(category, step, status, detail=""):
    icon = "PASS" if status == "ok" else "FAIL"
    msg = f"  [{icon}] {category} - {step}"
    if detail:
        msg += f": {detail}"
    print(msg)
    RESULTS.append({"category": category, "step": step, "status": status, "detail": detail})


def verify_redis():
    print("\n=== Redis 持久化数据验证 ===")
    import redis as rlib

    r = None
    try:
        r = rlib.Redis(host="192.168.10.76", port=6379, db=0, socket_timeout=10, socket_connect_timeout=10, decode_responses=True)
        r.ping()
        log("Redis", "连接", "ok")
    except Exception as e:
        log("Redis", "连接", "fail", str(e)[:200])
        return

    try:
        # 用户会话
        keys = r.keys("session:user:*")
        log("Redis", "用户会话", "ok", f"{len(keys)} 条")
        for k in keys:
            data = r.hgetall(k)
            log("Redis", f"  {k}", "ok", str(data))

        # 项目缓存
        keys = r.keys("cache:project:*")
        log("Redis", "项目缓存", "ok", f"{len(keys)} 条")
        for k in keys:
            data = r.hgetall(k)
            log("Redis", f"  {k}", "ok", str(data))

        # 渲染任务
        keys = r.keys("task:render:*")
        log("Redis", "渲染任务", "ok", f"{len(keys)} 条")
        for k in keys:
            data = r.hgetall(k)
            log("Redis", f"  {k}", "ok", str(data))

        # 在线用户
        members = r.smembers("collab:online_users")
        log("Redis", "在线用户", "ok", f"{len(members)} 人: {members}")

        # 操作日志
        keys = r.keys("logs:project:*")
        log("Redis", "操作日志", "ok", f"{len(keys)} 个")
        for k in keys:
            length = r.llen(k)
            items = r.lrange(k, 0, 2)
            actions = []
            for item in items:
                try:
                    actions.append(json.loads(item).get("action", "unknown"))
                except (json.JSONDecodeError, AttributeError):
                    actions.append("<parse_error>")
            log("Redis", f"  {k}", "ok", f"{length} 条 (前3条: {actions})")

        # 速率限制
        keys = r.keys("ratelimit:*")
        log("Redis", "速率限制", "ok", f"{len(keys)} 个")
        for k in keys:
            val = r.get(k)
            log("Redis", f"  {k}", "ok", f"count={val}")

    except Exception as e:
        log("Redis", "查询异常", "fail", str(e)[:200])
    finally:
        try:
            r.close()
        except Exception:
            pass


def verify_minio():
    print("\n=== MinIO 持久化数据验证 ===")
    from minio import Minio

    client = None
    try:
        client = Minio("192.168.10.76:9000", access_key="minioadmin", secret_key="minioadmin", secure=False)
        # 验证连接
        if not client.bucket_exists("ai-canvas-flow"):
            log("MinIO", "桶检查", "fail", "ai-canvas-flow 桶不存在")
            return
        log("MinIO", "连接", "ok")
    except Exception as e:
        log("MinIO", "连接", "fail", str(e)[:200])
        return

    bucket = "ai-canvas-flow"

    try:
        # 项目文件
        proj_files = list(client.list_objects(bucket, prefix="projects/", recursive=True))
        log("MinIO", "项目文件", "ok", f"{len(proj_files)} 个")
        for obj in proj_files:
            log("MinIO", f"  {obj.object_name}", "ok",
                f"size={obj.size or '?'} modified={obj.last_modified or '?'}")

        # 媒体文件
        media_files = list(client.list_objects(bucket, prefix="media/", recursive=True))
        log("MinIO", "媒体文件", "ok", f"{len(media_files)} 个")
        for obj in media_files:
            log("MinIO", f"  {obj.object_name}", "ok",
                f"size={obj.size or '?'} modified={obj.last_modified or '?'}")

        # 桶列表
        buckets = client.list_buckets()
        log("MinIO", "桶列表", "ok", f"{[b.name for b in buckets]}")

    except Exception as e:
        log("MinIO", "查询异常", "fail", str(e)[:200])


def _rabbitmq_api(url, cred, method="GET", data=None):
    """RabbitMQ Management API 请求封装，返回 (status_code, body) 或 (None, error)"""
    headers = {"Authorization": f"Basic {cred}"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode()[:200]
        except Exception:
            err_body = str(e)
        return e.code, err_body
    except Exception as e:
        return None, str(e)[:200]


def verify_rabbitmq():
    print("\n=== RabbitMQ 持久化数据验证 ===")
    cred = base64.b64encode(b"qzfrato:QWE123asd..").decode()
    base_url = "http://192.168.10.76:15672/api"

    # 连接检查
    status, body = _rabbitmq_api(f"{base_url}/overview", cred)
    if status != 200:
        log("RabbitMQ", "连接", "fail", f"HTTP {status}: {body}")
        return
    log("RabbitMQ", "连接", "ok", f"version={body.get('rabbitmq_version', '?')}")

    # 队列
    status, queues = _rabbitmq_api(f"{base_url}/queues", cred)
    if status != 200:
        log("RabbitMQ", "队列查询", "fail", f"HTTP {status}: {queues}")
    else:
        canvas_q = [q for q in queues if q.get("name", "").startswith("canvas.")]
        log("RabbitMQ", "canvas.* 队列", "ok", f"{len(canvas_q)} 个")
        for q in canvas_q:
            log("RabbitMQ", f"  队列 {q['name']}", "ok",
                f"messages={q.get('messages', 0)} durable={q.get('durable')} consumers={q.get('consumers', 0)}")

        # 队列中的消息
        for q in canvas_q:
            if q.get("messages", 0) > 0:
                vhost = urllib.parse.quote(q.get("vhost", "/"), safe="")
                qname = urllib.parse.quote(q["name"], safe="")
                s, msgs = _rabbitmq_api(
                    f"{base_url}/queues/{vhost}/{qname}/get",
                    cred,
                    method="POST",
                    data={"count": 5, "ackmode": "ack_requeue_false", "encoding": "auto"},
                )
                if s != 200 or not isinstance(msgs, list):
                    log("RabbitMQ", f"  {q['name']} 消息", "fail", f"HTTP {s}")
                else:
                    log("RabbitMQ", f"  {q['name']} 消息", "ok", f"{len(msgs)} 条")
                    for m in msgs:
                        log("RabbitMQ", f"    payload", "ok", m.get("payload", "")[:200])

    # 交换机
    status, exchanges = _rabbitmq_api(f"{base_url}/exchanges", cred)
    if status != 200:
        log("RabbitMQ", "交换机查询", "fail", f"HTTP {status}: {exchanges}")
    else:
        canvas_e = [e for e in exchanges if e.get("name", "").startswith("canvas.")]
        log("RabbitMQ", "canvas.* 交换机", "ok", f"{len(canvas_e)} 个")
        for e in canvas_e:
            log("RabbitMQ", f"  交换机 {e['name']}", "ok",
                f"type={e.get('type')} durable={e.get('durable')}")

    # 绑定
    status, bindings = _rabbitmq_api(f"{base_url}/bindings", cred)
    if status != 200:
        log("RabbitMQ", "绑定查询", "fail", f"HTTP {status}: {bindings}")
    else:
        canvas_b = [b for b in bindings if b.get("source", "").startswith("canvas.")]
        log("RabbitMQ", "canvas.* 绑定", "ok", f"{len(canvas_b)} 个")
        for b in canvas_b:
            log("RabbitMQ", f"  绑定", "ok",
                f"{b.get('source', '?')} → {b.get('destination', '?')} (routing_key={b.get('routing_key', '')})")


if __name__ == "__main__":
    verify_redis()
    verify_minio()
    verify_rabbitmq()

    # 汇总
    print("\n" + "=" * 50)
    passed = sum(1 for r in RESULTS if r["status"] == "ok")
    failed = sum(1 for r in RESULTS if r["status"] == "fail")
    print(f"  通过: {passed}  失败: {failed}  总计: {len(RESULTS)}")
    if failed > 0:
        print("\n  失败项:")
        for r in RESULTS:
            if r["status"] == "fail":
                print(f"    - [{r['category']}] {r['step']}: {r['detail']}")
    sys.exit(0 if failed == 0 else 1)
