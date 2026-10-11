FROM node:20-alpine AS frontend-build
WORKDIR /build
# Versão exibida no rodapé da Landing (injetada pelo deploy; ver deploy.yml)
ARG GIT_SHA=dev
ARG BUILD_DATE=dev
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN VITE_GIT_SHA=$GIT_SHA VITE_BUILD_DATE=$BUILD_DATE npm run build

FROM nginx:alpine-slim
COPY --from=frontend-build /build/dist /usr/share/nginx/html
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
