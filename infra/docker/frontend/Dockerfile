FROM node:24-alpine AS build

WORKDIR /app

COPY frontend/package.json ./package.json
RUN npm install --no-audit --no-fund

COPY frontend ./
RUN npm run build

FROM nginx:1.28-alpine

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
