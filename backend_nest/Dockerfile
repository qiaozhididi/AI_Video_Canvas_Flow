# 多阶段构建：builder 阶段安装全部依赖并编译，production 阶段只保留生产依赖+dist
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 8000
CMD ["node", "dist/main.js"]
