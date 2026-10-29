#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

# 优先使用本机已有的 Java 21 和 Node 22；仅影响本次启动。
if [[ -x '/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home/bin/java' ]]; then
  export JAVA_HOME='/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home'
fi
if [[ -d /opt/homebrew/opt/node@22/bin ]]; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"

if [[ ! -f .env || ! -f docker/.env ]]; then
  echo '请先参照 .env.example 配置 .env 和 docker/.env。' >&2
  exit 1
fi

docker compose --env-file docker/.env \
  -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d

JAR=interview-gateway/target/interview-gateway-1.0.0-SNAPSHOT.jar
if [[ ! -f "$JAR" || "${1:-}" == '--build' ]]; then
  if command -v mvn >/dev/null 2>&1; then
    MAVEN="$(command -v mvn)"
  elif [[ -x '/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn' ]]; then
    MAVEN='/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn'
  else
    echo '未找到 Maven，请安装 Maven 3.9+。' >&2
    exit 1
  fi
  "$MAVEN" -B -ntp package -DskipTests > logs/backend-build.log 2>&1
fi

if ! lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup java -jar "$JAR" > logs/backend.log 2>&1 < /dev/null &
  echo "$!" > logs/backend.pid
fi

if ! lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  (
    cd frontend
    PNPM="$(command -v pnpm || true)"
    if [[ -z "$PNPM" ]]; then
      PNPM="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
    fi
    if [[ ! -x "$PNPM" ]]; then
      echo '未找到 pnpm，请先安装 pnpm。' >&2
      exit 1
    fi
    if [[ ! -d node_modules ]]; then
      "$PNPM" install --frozen-lockfile --store-dir ../.local/pnpm-store
    fi
    nohup "$PNPM" dev --host 127.0.0.1 > ../logs/frontend.log 2>&1 < /dev/null &
    echo "$!" > ../logs/frontend.pid
  )
fi

echo '前端：http://localhost:5173'
echo '后端：http://localhost:8080/actuator/health'
echo '启动日志：logs/backend.log、logs/frontend.log'
