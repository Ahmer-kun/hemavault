FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --include-workspace-root
COPY apps/api apps/api
ENV DATABASE_URL=postgresql://build:build@localhost:5432/blood_ops?schema=public
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build
WORKDIR /app

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace @blood-ops/api --include-workspace-root
ENV DATABASE_URL=postgresql://build:build@localhost:5432/blood_ops?schema=public
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/api/.env.example apps/api/.env.example
WORKDIR /app/apps/api
RUN npx prisma generate
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]