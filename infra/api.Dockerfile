FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm install
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build -w @natacao/domain && npm run build -w @natacao/api
CMD ["npm", "run", "start", "-w", "@natacao/api"]
