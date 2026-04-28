# Manutenção Urbana PWA

Sistema completo de Gestão de Manutenção Urbana como Progressive Web App (PWA) com backend, banco de dados geoespacial e microserviço de IA.

## Arquitetura do Sistema

O sistema é dividido em 4 módulos independentes e integrados:

### 1) Frontend (PWA)
- **React + Vite**: Framework principal para a interface web
- **Leaflet**: Biblioteca para mapas interativos
- **Workbox**: Biblioteca para funcionalidades PWA (offline, cache, instalação)

### 2) Backend (API REST)
- **Node.js + Express**: Servidor web e API REST
- **PostgreSQL + PostGIS**: Banco de dados com suporte geoespacial
- **JWT Auth**: Autenticação via tokens
- **Upload de imagens**: Suporte a envio de fotos dos defeitos

### 3) Microserviço de IA
- **Python + FastAPI**: Servidor web para o serviço de IA
- **HuggingFace Transformers**: Biblioteca para processamento de linguagem natural
- **Classificação de texto**: Classificação automática dos defeitos reportados

### 4) Banco de Dados
- **PostgreSQL com PostGIS**: Banco de dados geoespacial para armazenamento de dados de localização

## Como Iniciar com Docker

### Pré-requisitos
- Docker
- Docker Compose

### Passo a passo para executar com Docker

1. **Clone o repositório**
   ```bash
   git clone https://github.com/josemurilors/tcc-manutencao-urbana.git
   cd tcc-manutencao-urbana
   ```

2. **Construa e inicie os containers**
   ```bash
   docker-compose up -d
   ```

3. **Acesse a aplicação**
   - Frontend (PWA): http://localhost:3000
   - Backend (API): http://localhost:5000
   - Serviço de IA: http://localhost:8000
   - Banco de dados PostgreSQL: localhost:5432

4. **Parar os containers**
   ```bash
   docker-compose down
   ```

5. **Reconstruir os containers (se necessário)**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

## Estrutura do Projeto

```
manutencao-urbana-pwa/
  frontend/
    src/
      App.jsx
      main.jsx
    Dockerfile
    nginx.conf
  backend/
    src/
      routes/
        auth.js
        defeitos.js
    Dockerfile
  ia/
    main.py
    Dockerfile
    requirements.txt
  database/
    schema.sql
  docker-compose.yml
```

## Dependências

### Backend (package.json)
```json
{
  "name": "backend",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "cors": "^2.8.6",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "knex": "^3.2.9",
    "multer": "^2.1.1",
    "pg": "^8.20.0",
    "postgis": "^1.2.0"
  }
}
```

### Frontend (package.json)
```json
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "leaflet": "^1.9.4",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-leaflet": "^5.0.0",
    "workbox-precaching": "^7.4.0",
    "workbox-window": "^7.4.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.2.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.5.0",
    "vite": "^8.0.10"
  }
}
```

### Banco de Dados (schema.sql)
```sql
-- Schema do banco de dados para manutenção urbana
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabela de usuários
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    admin BOOLEAN DEFAULT FALSE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de defeitos
CREATE TABLE defeitos (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id),
    titulo VARCHAR(255) NOT NULL,
    descricao TEXT,
    categoria VARCHAR(100),
    localizacao GEOGRAPHY(POINT, 4326) NOT TO NULL,
    imagem_url VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pendente',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices geoespaciais
CREATE INDEX idx_defeitos_localizacao ON defeitos USING GIST (localizacao);
```

### IA (requirements.txt)
```
fastapi==0.110.3
uvicorn==0.29.0
transformers==4.38.0
torch==2.2.0
pydantic==2.6.1
```

## Funcionalidades

- Registro de defeitos urbanos por cidadãos
- Gestão e acompanhamento pela prefeitura
- Classificação automática via IA
- Funciona offline (parcialmente)
- Instalável como aplicativo móvel

## Deploy

- Frontend: Vercel
- Backend: Railway
- Banco: Supabase