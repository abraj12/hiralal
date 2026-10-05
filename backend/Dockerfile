# Production Multi-Stage Dockerfile for Hiralal & Sons Rewards Backend
# Optimized for linux/arm64 (AWS Graviton2 t4g.medium) and linux/amd64

FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules and Prisma
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

# Generate Prisma Client
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat dumb-init

ENV NODE_ENV=production
ENV PORT=5000

COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy generated Prisma Client and compiled application
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# Create uploads directory and set permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 5000

# Use dumb-init for proper PID 1 signal forwarding (graceful shutdown)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]
