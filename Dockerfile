# Built by GitHub Actions (.github/workflows/image.yml), pulled by Coolify on Jinx.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4351
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/server server
COPY --from=build /app/shared shared
USER node
CMD ["node", "server/index.ts"]
