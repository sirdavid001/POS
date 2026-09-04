FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
RUN npm ci --omit=dev --workspace=packages/server --workspace=packages/shared

FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node packages/server ./packages/server
RUN mkdir -p logs && chown node:node logs
USER node
EXPOSE 3001
CMD ["node", "packages/server/src/app.js"]
