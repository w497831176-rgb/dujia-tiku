#!/bin/bash
set -e

# 在 NAS 上执行，创建独立的测试环境
# 测试环境目录与生产环境完全隔离

TEST_DIR="${TEST_DIR:-/volume1/docker/dujia-tiku-test}"
PROD_DIR="${PROD_DIR:-/volume1/docker/dujia-tiku}"
REPO_URL="${REPO_URL:?Please set REPO_URL to your fork or clone URL}"

echo ">>> Creating test environment at $TEST_DIR"

# Clone repo if not exists, otherwise pull
if [ -d "$TEST_DIR/.git" ]; then
    cd "$TEST_DIR"
    git pull origin main
else
    git clone "$REPO_URL" "$TEST_DIR"
    cd "$TEST_DIR"
fi

# Create test-specific directories
mkdir -p data logs

# Copy production env template if no .env exists
if [ ! -f ".env" ]; then
    if [ -f ".env.test.example" ]; then
        cp .env.test.example .env
        echo "!!! Please edit $TEST_DIR/.env with your test API key and JWT secret"
    elif [ -f "$PROD_DIR/.env" ]; then
        cp "$PROD_DIR/.env" .env
        # Change port to test port
        sed -i 's/HOST_PORT=.*/HOST_PORT=18082/' .env
        sed -i 's/JWT_SECRET=.*/JWT_SECRET=dujia-tiku-test-secret/' .env
    fi
fi

# If database doesn't exist, copy structure from production (no user data)
if [ ! -f "data/du-tiku.db" ] && [ -f "$PROD_DIR/data/du-tiku.db" ]; then
    echo ">>> Copying database schema from production (structure only, no user data)"
    sqlite3 "$PROD_DIR/data/du-tiku.db" ".schema" > /tmp/dujia-tiku-schema.sql
    sqlite3 data/du-tiku.db < /tmp/dujia-tiku-schema.sql
    rm -f /tmp/dujia-tiku-schema.sql
fi

# Start test environment
docker compose -f docker-compose.test.yml up -d --build

echo ">>> Test environment started at the HOST_PORT configured in .env"
echo ">>> To stop: cd $TEST_DIR && docker compose -f docker-compose.test.yml down"
