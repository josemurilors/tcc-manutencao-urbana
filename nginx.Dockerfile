# O site é o build web do app Expo (mobile/): a mesma interface de quem
# instala o app no celular. Páginas estáticas da loja (privacidade e exclusão
# de conta) vêm de mobile/public/.
FROM node:22-alpine AS app-build
WORKDIR /build
COPY mobile/package*.json ./
RUN npm ci
COPY mobile/ ./
# Versão do rodapé: o deploy exporta COMMIT_SHA/COMMIT_DATE (o contexto não tem .git).
ARG COMMIT_SHA
ARG COMMIT_DATE
ENV COMMIT_SHA=$COMMIT_SHA COMMIT_DATE=$COMMIT_DATE
RUN npx expo export --platform web --output-dir dist

FROM nginx:alpine-slim
COPY --from=app-build /build/dist /usr/share/nginx/html
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
