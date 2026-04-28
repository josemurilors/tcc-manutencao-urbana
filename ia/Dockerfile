FROM python:3.9-slim

WORKDIR /app

# Copiar requirements.txt e instalar dependências
COPY ia/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código-fonte
COPY ia/ .

# Explicação das portas
EXPOSE 8000

# Comando para rodar a aplicação
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]