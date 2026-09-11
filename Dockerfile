FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY src ./src
COPY bin ./bin
COPY contracts ./contracts
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8013 \
    HOST=0.0.0.0 \
    MCP_TRANSPORT=sse \
    CUCM_MOCK=true \
    CUCM_SEED_PROFILE=lab-small

COPY package.json ./
COPY contracts ./contracts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 8013
CMD ["node", "dist/bin/cucm-emulator-mcp.js"]
