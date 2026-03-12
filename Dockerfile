# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies (better caching - package files first)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ---- Production Stage ----
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache wget

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY server.js ./
COPY config/*.js ./config/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/
COPY public/ ./public/
COPY db/ ./db/

# Create required directories with correct ownership
RUN mkdir -p uploads database logs config && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
