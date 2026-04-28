FROM node:18-alpine

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar o restante dos arquivos
COPY . .

# Expor porta
EXPOSE 5000

# Comando para rodar a aplicação
CMD ["node", "src/server.js"]