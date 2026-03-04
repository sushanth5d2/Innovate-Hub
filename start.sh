#!/bin/bash
# ==============================================
# Innovate Hub - Start Script
# ==============================================
# Usage:
#   ./start.sh              # Start development (default)
#   ./start.sh dev          # Start development
#   ./start.sh prod         # Start production (Node.js direct)
#   ./start.sh docker       # Start production (Docker)
#   ./start.sh docker-down  # Stop Docker services
#   ./start.sh pm2-dev      # Start dev with PM2
#   ./start.sh pm2-prod     # Start prod with PM2
# ==============================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════╗"
    echo "║        Innovate Hub Platform         ║"
    echo "╚══════════════════════════════════════╝"
    echo -e "${NC}"
}

check_env_file() {
    local env_file=$1
    if [ ! -f "$env_file" ]; then
        echo -e "${RED}✗ Missing $env_file${NC}"
        echo -e "${YELLOW}  Copy from .env.example: cp .env.example $env_file${NC}"
        return 1
    fi
    echo -e "${GREEN}✓ $env_file found${NC}"
    return 0
}

start_dev() {
    echo -e "${GREEN}▶ Starting DEVELOPMENT environment${NC}"
    echo ""

    check_env_file ".env" || exit 1

    echo -e "${YELLOW}Starting Node.js server (port 3000)...${NC}"
    echo -e "${YELLOW}  Database: SQLite${NC}"
    echo -e "${YELLOW}  Hot-reload: nodemon${NC}"
    echo ""

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi

    # Start with nodemon for hot-reload
    if command -v npx &> /dev/null; then
        npx nodemon server.js
    else
        node server.js
    fi
}

start_prod() {
    echo -e "${GREEN}▶ Starting PRODUCTION environment${NC}"
    echo ""

    check_env_file ".env" || exit 1

    # Validate critical production settings from .env
    source .env 2>/dev/null || true

    if [ "$NODE_ENV" != "production" ]; then
        echo -e "${RED}✗ NODE_ENV is not 'production' in .env! Change it first.${NC}"
        exit 1
    fi

    if [ "$JWT_SECRET" = "CHANGE_ME_TO_A_STRONG_RANDOM_SECRET" ] || [ -z "$JWT_SECRET" ]; then
        echo -e "${RED}✗ JWT_SECRET not set! Generate one:${NC}"
        echo -e "${YELLOW}  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"${NC}"
        exit 1
    fi

    if [ "$PG_PASSWORD" = "CHANGE_ME_TO_STRONG_PASSWORD" ] || [ "$PG_PASSWORD" = "changeme" ]; then
        echo -e "${RED}✗ PG_PASSWORD still has default value! Change it in .env.production${NC}"
        exit 1
    fi

    echo -e "${YELLOW}Starting Node.js server (production mode)...${NC}"
    echo -e "${YELLOW}  Database: ${DB_TYPE:-sqlite}${NC}"
    echo -e "${YELLOW}  Port: ${PORT:-3000}${NC}"
    echo ""

    node server.js
}

start_docker() {
    echo -e "${GREEN}▶ Starting DOCKER production stack${NC}"
    echo ""

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not found. Install Docker first.${NC}"
        exit 1
    fi

    check_env_file ".env" || exit 1

    echo -e "${YELLOW}Building and starting containers...${NC}"
    echo -e "${YELLOW}  Services: app, postgres, redis, ml-service, nginx${NC}"
    echo ""

    docker compose up --build -d

    echo ""
    echo -e "${GREEN}✓ All services started!${NC}"
    echo -e "${YELLOW}  App:      http://localhost:${PORT:-3000}${NC}"
    echo -e "${YELLOW}  Nginx:    http://localhost:80${NC}"
    echo -e "${YELLOW}  Postgres: localhost:5432${NC}"
    echo -e "${YELLOW}  Redis:    localhost:6379${NC}"
    echo ""
    echo -e "${BLUE}View logs: docker compose logs -f${NC}"
    echo -e "${BLUE}Stop:      docker compose down${NC}"
}

stop_docker() {
    echo -e "${YELLOW}▶ Stopping Docker services...${NC}"
    docker compose down
    echo -e "${GREEN}✓ All services stopped${NC}"
}

start_pm2_dev() {
    echo -e "${GREEN}▶ Starting DEVELOPMENT with PM2${NC}"

    if ! command -v pm2 &> /dev/null; then
        echo -e "${YELLOW}Installing PM2...${NC}"
        npm install -g pm2
    fi

    check_env_file ".env" || exit 1

    pm2 start ecosystem.config.js --only innovate-hub-dev
    pm2 logs innovate-hub-dev
}

start_pm2_prod() {
    echo -e "${GREEN}▶ Starting PRODUCTION with PM2${NC}"

    if ! command -v pm2 &> /dev/null; then
        echo -e "${YELLOW}Installing PM2...${NC}"
        npm install -g pm2
    fi

    check_env_file ".env" || exit 1

    pm2 start ecosystem.config.js --only innovate-hub-prod
    pm2 save

    echo ""
    echo -e "${GREEN}✓ Production started with PM2 (clustered)${NC}"
    echo -e "${BLUE}Status:  pm2 status${NC}"
    echo -e "${BLUE}Logs:    pm2 logs${NC}"
    echo -e "${BLUE}Monitor: pm2 monit${NC}"
    echo -e "${BLUE}Stop:    pm2 stop innovate-hub-prod${NC}"
}

# ==========================================
# MAIN
# ==========================================
print_banner

MODE=${1:-dev}

case "$MODE" in
    dev|development)
        start_dev
        ;;
    prod|production)
        start_prod
        ;;
    docker)
        start_docker
        ;;
    docker-down|docker-stop)
        stop_docker
        ;;
    pm2-dev)
        start_pm2_dev
        ;;
    pm2-prod)
        start_pm2_prod
        ;;
    *)
        echo "Usage: $0 {dev|prod|docker|docker-down|pm2-dev|pm2-prod}"
        echo ""
        echo "  dev          Development mode (SQLite, nodemon, port 3000)"
        echo "  prod         Production mode (PostgreSQL, node, port 3000)"
        echo "  docker       Docker production stack (all services)"
        echo "  docker-down  Stop Docker services"
        echo "  pm2-dev      Development with PM2 process manager"
        echo "  pm2-prod     Production with PM2 clustering"
        exit 1
        ;;
esac
