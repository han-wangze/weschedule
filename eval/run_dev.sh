#!/usr/bin/env bash
# 一键运行 eval：自动读取项目根 .env 注入 DEEPSEEK_API_KEY 后执行 run_eval.py
# 用法：bash eval/run_dev.sh [参数]   例如：bash eval/run_dev.sh --dataset dev
set -a
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
fi
set +a

cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python}"
exec "$PYTHON" eval/run_eval.py "$@"
