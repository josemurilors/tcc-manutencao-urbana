FROM node:18-alpine

WORKDIR /app

# Copiar package.json e package-lock.json
COPY backend/package*.json ./

# Instalar dependências
RUN npm install

# Copiar o restante dos arquivos
COPY backend/ .

# Expor porta
EXPOSE 5000

# Comando para rodar a aplicação
CMD ["node", "src/server.js"]