FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
RUN npm install --workspace=packages/server --workspace=packages/shared
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
RUN mkdir -p logs
EXPOSE 3001
CMD ["node", "packages/server/src/app.js"]
