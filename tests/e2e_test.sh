#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# AI Canvas Flow — 端到端测试脚本
# 覆盖：健康检查 → 注册 → 登录 → 项目CRUD → 媒体上传 → 渲染任务 → 协作WebSocket
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

API="http://localhost:8000"
V1="${API}/api/v1"
PASS=0
FAIL=0
TOTAL=0

# ── 工具函数 ──

log_test() {
  local name="$1" status="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1))
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ [$TOTAL] $name"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ [$TOTAL] $name — $detail"
  fi
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    log_test "$name" "PASS"
  else
    log_test "$name" "FAIL" "expected=$expected actual=$actual"
  fi
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    log_test "$name" "PASS"
  else
    log_test "$name" "FAIL" "'$needle' not found in response"
  fi
}

assert_not_empty() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    log_test "$name" "PASS"
  else
    log_test "$name" "FAIL" "value is empty"
  fi
}

# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  AI Canvas Flow — 端到端测试"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── T1: 健康检查 ──
echo "── T1: 健康检查 ──"
HEALTH=$(curl -s "${API}/health")
assert_eq "健康检查状态" "ok" "$(echo "$HEALTH" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null || echo 'PARSE_ERROR')"
assert_contains "健康检查版本字段" "$HEALTH" "version"

# ── T2: 用户注册 ──
echo ""
echo "── T2: 用户注册 ──"
TIMESTAMP=$(date +%s)
TEST_USER="e2e_user_${TIMESTAMP}"
TEST_EMAIL="e2e_${TIMESTAMP}@test.com"
TEST_PASS="Test123456"

REGISTER_RES=$(curl -s -w "\n%{http_code}" -X POST "${V1}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_USER}\",\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASS}\"}")
REGISTER_CODE=$(echo "$REGISTER_RES" | tail -1)
REGISTER_BODY=$(echo "$REGISTER_RES" | sed '$d')

assert_eq "注册返回200" "200" "$REGISTER_CODE"
assert_contains "注册返回用户名" "$REGISTER_BODY" "$TEST_USER"

# 重复注册应失败
DUP_RES=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${V1}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_USER}\",\"email\":\"${TEST_EMAIL}2@test.com\",\"password\":\"${TEST_PASS}\"}")
assert_eq "重复注册返回400" "400" "$DUP_RES"

# ── T3: 用户登录 ──
echo ""
echo "── T3: 用户登录 ──"
LOGIN_RES=$(curl -s -w "\n%{http_code}" -X POST "${V1}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_PASS}\"}")
LOGIN_CODE=$(echo "$LOGIN_RES" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RES" | sed '$d')

assert_eq "登录返回200" "200" "$LOGIN_CODE"
assert_contains "登录返回access_token" "$LOGIN_BODY" "access_token"
assert_contains "登录返回refresh_token" "$LOGIN_BODY" "refresh_token"

ACCESS_TOKEN=$(echo "$LOGIN_BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])' 2>/dev/null || echo "")
assert_not_empty "提取access_token" "$ACCESS_TOKEN"

# 错误密码应失败
BAD_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${V1}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_USER}\",\"password\":\"wrong\"}")
assert_eq "错误密码返回401" "401" "$BAD_LOGIN"

# ── T4: 项目 CRUD ──
echo ""
echo "── T4: 项目 CRUD ──"
AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"

# 创建项目
CREATE_RES=$(curl -s -w "\n%{http_code}" -X POST "${V1}/projects/" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"E2E测试项目","description":"端到端测试"}')
CREATE_CODE=$(echo "$CREATE_RES" | tail -1)
CREATE_BODY=$(echo "$CREATE_RES" | sed '$d')

assert_eq "创建项目返回200" "200" "$CREATE_CODE"
assert_contains "创建项目返回name" "$CREATE_BODY" "E2E测试项目"

PROJECT_ID=$(echo "$CREATE_BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null || echo "")
assert_not_empty "提取项目ID" "$PROJECT_ID"

# 获取项目列表
LIST_RES=$(curl -s -w "\n%{http_code}" "${V1}/projects/" -H "$AUTH_HEADER")
LIST_CODE=$(echo "$LIST_RES" | tail -1)
LIST_BODY=$(echo "$LIST_RES" | sed '$d')

assert_eq "项目列表返回200" "200" "$LIST_CODE"
assert_contains "项目列表包含测试项目" "$LIST_BODY" "$PROJECT_ID"

# 获取项目详情
DETAIL_RES=$(curl -s -w "\n%{http_code}" "${V1}/projects/${PROJECT_ID}" -H "$AUTH_HEADER")
DETAIL_CODE=$(echo "$DETAIL_RES" | tail -1)

assert_eq "项目详情返回200" "200" "$DETAIL_CODE"

# 删除项目
DEL_RES=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${V1}/projects/${PROJECT_ID}" -H "$AUTH_HEADER")
assert_eq "删除项目返回204" "204" "$DEL_RES"

# 删除后再获取应404
GET_DELETED=$(curl -s -o /dev/null -w "%{http_code}" "${V1}/projects/${PROJECT_ID}" -H "$AUTH_HEADER")
assert_eq "已删除项目返回404" "404" "$GET_DELETED"

# ── T5: 媒体资产 ──
echo ""
echo "── T5: 媒体资产 ──"

# 获取媒体列表（空）
MEDIA_LIST=$(curl -s -w "\n%{http_code}" "${V1}/media/" -H "$AUTH_HEADER")
MEDIA_LIST_CODE=$(echo "$MEDIA_LIST" | tail -1)
assert_eq "媒体列表返回200" "200" "$MEDIA_LIST_CODE"

# 创建测试文件并上传
TEST_FILE="/tmp/e2e_test_image_${TIMESTAMP}.png"
python3 -c "
import struct, zlib
# 生成一个最小的有效 PNG 文件 (1x1 红色像素)
def create_png():
    sig = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    raw = zlib.compress(b'\\x00\\xff\\x00\\x00')
    idat_crc = zlib.crc32(b'IDAT' + raw) & 0xffffffff
    idat = struct.pack('>I', len(raw)) + b'IDAT' + raw + struct.pack('>I', idat_crc)
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    return sig + ihdr + idat + iend
with open('${TEST_FILE}', 'wb') as f:
    f.write(create_png())
" 2>/dev/null

if [ -f "$TEST_FILE" ]; then
  UPLOAD_RES=$(curl -s -w "\n%{http_code}" -X POST "${V1}/media/upload" \
    -H "$AUTH_HEADER" \
    -F "file=@${TEST_FILE}")
  UPLOAD_CODE=$(echo "$UPLOAD_RES" | tail -1)
  UPLOAD_BODY=$(echo "$UPLOAD_RES" | sed '$d')

  if [ "$UPLOAD_CODE" = "200" ] || [ "$UPLOAD_CODE" = "201" ]; then
    log_test "媒体上传返回成功" "PASS"
    ASSET_ID=$(echo "$UPLOAD_BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")

    if [ -n "$ASSET_ID" ] && [ "$ASSET_ID" != "None" ]; then
      log_test "提取媒体资产ID" "PASS"

      # 获取预签名URL
      PRESIGN_RES=$(curl -s -w "\n%{http_code}" "${V1}/media/${ASSET_ID}/presign" -H "$AUTH_HEADER")
      PRESIGN_CODE=$(echo "$PRESIGN_RES" | tail -1)
      assert_eq "预签名URL返回200" "200" "$PRESIGN_CODE"

      # 删除媒体
      DEL_MEDIA=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${V1}/media/${ASSET_ID}" -H "$AUTH_HEADER")
      assert_eq "删除媒体返回204" "204" "$DEL_MEDIA"
    else
      log_test "提取媒体资产ID" "FAIL" "id为空或None"
    fi
  else
    log_test "媒体上传返回成功" "FAIL" "code=$UPLOAD_CODE body=$UPLOAD_BODY"
  fi
  rm -f "$TEST_FILE"
else
  log_test "创建测试文件" "FAIL" "文件未生成"
fi

# ── T6: 渲染任务 ──
echo ""
echo "── T6: 渲染任务 ──"

# 先创建一个项目用于渲染
RENDER_PROJ=$(curl -s -X POST "${V1}/projects/" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{"name":"渲染测试项目"}')
RENDER_PROJ_ID=$(echo "$RENDER_PROJ" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' 2>/dev/null || echo "")

if [ -n "$RENDER_PROJ_ID" ]; then
  # 创建渲染任务
  RENDER_CREATE=$(curl -s -w "\n%{http_code}" -X POST "${V1}/render/" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "{\"project_id\":\"${RENDER_PROJ_ID}\",\"output_format\":\"mp4\"}")
  RENDER_CREATE_CODE=$(echo "$RENDER_CREATE" | tail -1)
  RENDER_CREATE_BODY=$(echo "$RENDER_CREATE" | sed '$d')

  if [ "$RENDER_CREATE_CODE" = "200" ] || [ "$RENDER_CREATE_CODE" = "201" ]; then
    log_test "创建渲染任务" "PASS"
    TASK_ID=$(echo "$RENDER_CREATE_BODY" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id",d.get("task_id","")))' 2>/dev/null || echo "")

    if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "None" ]; then
      # 查询渲染任务
      RENDER_STATUS=$(curl -s -w "\n%{http_code}" "${V1}/render/${TASK_ID}" -H "$AUTH_HEADER")
      RENDER_STATUS_CODE=$(echo "$RENDER_STATUS" | tail -1)
      assert_eq "查询渲染任务返回200" "200" "$RENDER_STATUS_CODE"

      # 取消渲染任务
      CANCEL_RES=$(curl -s -w "\n%{http_code}" -X POST "${V1}/render/${TASK_ID}/cancel" -H "$AUTH_HEADER")
      CANCEL_CODE=$(echo "$CANCEL_RES" | tail -1)
      # 取消可能返回200或409（任务已完成/不存在）
      if [ "$CANCEL_CODE" = "200" ] || [ "$CANCEL_CODE" = "409" ]; then
        log_test "取消渲染任务" "PASS"
      else
        log_test "取消渲染任务" "FAIL" "code=$CANCEL_CODE"
      fi
    else
      log_test "提取渲染任务ID" "FAIL" "id为空"
    fi
  else
    log_test "创建渲染任务" "FAIL" "code=$RENDER_CREATE_CODE"
  fi
else
  log_test "创建渲染测试项目" "FAIL"
fi

# ── T7: API 文档可访问 ──
echo ""
echo "── T7: API 文档 ──"
DOCS_RES=$(curl -s -o /dev/null -w "%{http_code}" "${API}/docs")
assert_eq "Swagger文档可访问" "200" "$DOCS_RES"

OPENAPI_RES=$(curl -s -o /dev/null -w "%{http_code}" "${API}/openapi.json")
assert_eq "OpenAPI Schema可访问" "200" "$OPENAPI_RES"

# ── T8: 协作 WebSocket 连通性 ──
echo ""
echo "── T8: 协作 WebSocket ──"
# 检查 Socket.IO 端点是否响应
WS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${API}/socket.io/?EIO=4&transport=polling")
# Socket.IO polling 模式应返回200
if [ "$WS_CHECK" = "200" ]; then
  log_test "Socket.IO polling端点可访问" "PASS"
else
  log_test "Socket.IO polling端点" "FAIL" "code=$WS_CHECK"
fi

# Socket.IO 握手验证
WS_HANDSHAKE=$(curl -s "${API}/socket.io/?EIO=4&transport=polling")
assert_contains "Socket.IO握手包含sid" "$WS_HANDSHAKE" "sid"
assert_contains "Socket.IO握手支持websocket升级" "$WS_HANDSHAKE" "websocket"

# 完整 Socket.IO polling 会话测试
WS_SID=$(echo "$WS_HANDSHAKE" | sed 's/^0//' | python3 -c 'import sys,json; print(json.load(sys.stdin)["sid"])' 2>/dev/null || echo "")
if [ -n "$WS_SID" ]; then
  log_test "提取Socket.IO会话SID" "PASS"

  # 发送 connect 包 (Engine.IO 4 格式: 40 = CONNECT)
  WS_POST=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/socket.io/?EIO=4&transport=polling&sid=${WS_SID}" \
    -H "Content-Type: text/plain" -d "40")
  if [ "$WS_POST" = "200" ]; then
    log_test "Socket.IO POST连接包" "PASS"

    # 发送 join_project 事件 (42["join_project",{...}])
    JOIN_PAYLOAD="42[\"join_project\",{\"project_id\":\"e2e-shell-test\",\"user_id\":\"shell_tester\"}]"
    WS_EMIT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/socket.io/?EIO=4&transport=polling&sid=${WS_SID}" \
      -H "Content-Type: text/plain" -d "$JOIN_PAYLOAD")
    if [ "$WS_EMIT" = "200" ]; then
      log_test "Socket.IO发送join_project事件" "PASS"
    else
      log_test "Socket.IO发送join_project事件" "FAIL" "code=$WS_EMIT"
    fi

    # 发送 ping 测量延迟
    PING_PAYLOAD="42[\"ping\",{\"client_time\":$(date +%s%3N)}]"
    WS_PING=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API}/socket.io/?EIO=4&transport=polling&sid=${WS_SID}" \
      -H "Content-Type: text/plain" -d "$PING_PAYLOAD")
    if [ "$WS_PING" = "200" ]; then
      log_test "Socket.IO发送ping事件" "PASS"
    else
      log_test "Socket.IO发送ping事件" "FAIL" "code=$WS_PING"
    fi
  else
    log_test "Socket.IO POST连接包" "FAIL" "code=$WS_POST"
  fi
else
  log_test "提取Socket.IO会话SID" "FAIL" "SID为空"
fi

# 协作状态 API
COLLAB_RES=$(curl -s -w "\n%{http_code}" "${V1}/collab/status")
COLLAB_CODE=$(echo "$COLLAB_RES" | tail -1)
assert_eq "协作状态API返回200" "200" "$COLLAB_CODE"

# ── T9: Vite 代理联调 ──
echo ""
echo "── T9: Vite 代理联调 ──"
VITE_BASE="http://localhost:5173"

# 通过 Vite 代理访问后端 API
PROXY_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${VITE_BASE}/api/v1/collab/status")
assert_eq "Vite代理转发API请求" "200" "$PROXY_HEALTH"

PROXY_SIO=$(curl -s -o /dev/null -w "%{http_code}" "${VITE_BASE}/socket.io/?EIO=4&transport=polling")
assert_eq "Vite代理转发Socket.IO" "200" "$PROXY_SIO"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  测试结果: ${PASS}/${TOTAL} 通过, ${FAIL} 失败"
echo "═══════════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
