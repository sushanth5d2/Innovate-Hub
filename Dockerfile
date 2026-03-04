# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# ---- Production Stage ----
FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY server.js ./
COPY config/ ./config/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY services/ ./services/
COPY public/ ./public/
COPY db/ ./db/

# Create required directories
RUN mkdir -p uploads database logs && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Environment
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
