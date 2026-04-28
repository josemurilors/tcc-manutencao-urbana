# Manutenção Urbana PWA

Sistema completo de Gestão de Manutenção Urbana como Progressive Web App (PWA) com backend, banco de dados geoespacial e microserviço de IA.

## Arquitetura do Sistema

O sistema é dividido em 3 módulos independentes e integrados:

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

## Estrutura do Projeto

```
manutencao-urbana-pwa/
  frontend/
    src/
      App.jsx
      main.jsx
      sw.js
    public/
      manifest.json
    vite.config.js
  backend/
    src/
      routes/
        auth.js
        defeitos.js
    package.json
  ia/
    main.py
    requirements.txt
  database/
    schema.sql
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
    localizacao GEOGRAPHY(POINT, 4326) NOT NULL,
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
fastapi==0.136.1
uvicorn==0.46.0
transformers==5.6.2
torch==2.11.0
pydantic==2.13.3
```

## Como Iniciar

### 1) Banco de Dados
Primeiro, crie o banco de dados PostgreSQL com PostGIS e execute o script `database/schema.sql`.

### 2) Backend
```bash
cd backend
npm install
# Configure as variáveis de ambiente (DATABASE_URL, JWT_SECRET)
node src/server.js
```

### 3) Microserviço de IA
```bash
cd ia
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 4) Frontend (PWA)
```bash
cd frontend
npm install
npm run dev
```

O frontend estará disponível em `http://localhost:5173` e pode ser instalado como aplicativo no celular.

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