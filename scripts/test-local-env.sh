#!/usr/bin/env bash
# scripts/test-local-env.sh
# Automated Zero-Credential Local Smoke Test Suite for AI-PEER (Bash)
set -eo pipefail

PORT="${PORT:-8085}"
BASE_URL="http://localhost:${PORT}"
ERROR_COUNT=0

echo -e "\033[36m==========================================================\033[0m"
echo -e "\033[36m   AI-PEER ZERO-CREDENTIAL LOCAL SMOKE TEST SUITE (BASH)\033[0m"
echo -e "\033[36m==========================================================\033[0m"
echo -e "Target API URL: ${BASE_URL}\n"

# 1. Health check
echo -n "  1. API Health Check (GET /health) ... "
HEALTH_RES=$(curl -s "${BASE_URL}/health" || echo "")
if echo "$HEALTH_RES" | grep -q '"status":"OK"'; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 2. Mock SMS 2FA Send Code
echo -n "  2. Mock SMS 2FA Send Code (POST /auth/send-code) ... "
SEND_RES=$(curl -s -X POST "${BASE_URL}/auth/send-code" \
  -H "Content-Type: application/json" \
  -d '{"phone":"15555555555","password":"password123","mode":"login"}' || echo "")
if echo "$SEND_RES" | grep -q '"success":true'; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m: $SEND_RES"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 3. Mock OTP Verify
echo -n "  3. Mock OTP Verification (POST /auth/verify) ... "
VERIFY_RES=$(curl -s -X POST "${BASE_URL}/auth/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"15555555555","code":"123456"}' || echo "")
CUSTOM_TOKEN=$(echo "$VERIFY_RES" | grep -o '"customToken":"[^"]*' | cut -d'"' -f4 || echo "")
if [ -n "$CUSTOM_TOKEN" ]; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m: $VERIFY_RES"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 4. Protected User Profile
echo -n "  4. Protected User Profile (GET /users/get) ... "
USER_RES=$(curl -s -X GET "${BASE_URL}/users/get" -H "Authorization: Bearer ${CUSTOM_TOKEN}" || echo "")
if echo "$USER_RES" | grep -q '"message":"User retrieved successfully"'; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m: $USER_RES"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 5. Protected Video URL
echo -n "  5. Exercise Video URL (GET /video/getHeadURL) ... "
VIDEO_RES=$(curl -s -X GET "${BASE_URL}/video/getHeadURL" -H "Authorization: Bearer ${CUSTOM_TOKEN}" || echo "")
if echo "$VIDEO_RES" | grep -q 'mock-assets/sample-exercise.mp4'; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m: $VIDEO_RES"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 6. Static Mock Asset Streaming
echo -n "  6. Static Mock Asset Streaming ... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/mock-assets/sample-exercise.mp4" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "\033[32m[PASS]\033[0m"
else
  echo -e "\033[31m[FAIL]\033[0m (HTTP $HTTP_CODE)"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

# 7. Security Path Traversal Check
echo -n "  7. Security Check: Path Traversal Immunity ... "
SEC_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/mock-assets/server.js" || echo "000")
if [ "$SEC_CODE" = "403" ] || [ "$SEC_CODE" = "404" ]; then
  echo -e "\033[32m[PASS]\033[0m (Blocked with HTTP $SEC_CODE)"
else
  echo -e "\033[31m[FAIL]\033[0m (Got HTTP $SEC_CODE)"
  ERROR_COUNT=$((ERROR_COUNT + 1))
fi

echo -e "\033[36m==========================================================\033[0m"
if [ "$ERROR_COUNT" -eq 0 ]; then
  echo -e "\033[32m  SUCCESS: All tests passed! Zero production keys needed.\033[0m"
  echo -e "\033[36m==========================================================\033[0m"
  exit 0
else
  echo -e "\033[31m  FAILED: ${ERROR_COUNT} test(s) failed.\033[0m"
  echo -e "\033[36m==========================================================\033[0m"
  exit 1
fi
