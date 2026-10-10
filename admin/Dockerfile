FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000
CMD ["npm", "start"]
