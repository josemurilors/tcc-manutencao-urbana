# Stage 1: builder — instala torch/transformers, exporta modelos ONNX
FROM python:3.12 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements-build.txt ./
# PyTorch só exporta o modelo para ONNX, em CPU. Sem o índice CPU o pip traz a
# variante CUDA (vários GB de bibliotecas NVIDIA) e lotou o disco da VPS.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements-build.txt

COPY models/download_text_model.py models/download_image_model.py /build/
COPY experimentos/dataset_sintetico.py /build/experimentos/
COPY inference.py gerar_centroides.py /build/
RUN mkdir -p /build/models \
    && python download_text_model.py --output-dir /build/models \
    && python download_image_model.py --output-dir /build/models \
    && python gerar_centroides.py --output-dir /build/models

# Stage 2: runtime — apenas onnxruntime + inferencia
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=builder /build/models/ /app/models/
COPY *.py /app/
COPY experimentos/ /app/experimentos/

ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
