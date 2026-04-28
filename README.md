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

## Como Iniciar

### 1) Banco de Dados
Primeiro, crie o banco de dados PostgreSQL com PostGIS e execute o script database/schema.sql.

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

O frontend estará disponível em http://localhost:5173 e pode ser instalado como aplicativo no celular.
