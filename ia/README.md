# Serviço de IA (`ia/`)

FastAPI + ONNX Runtime que o backend consome (`IA_URL`) para classificar
relatos. Movido do README; atualize junto com `inference.py` e o
`Dockerfile`.

## Pipeline de classificação de texto

```
User input → Tokenize (BERT tokenizer) → paraphrase-multilingual-MiniLM-L12-v2 (ONNX)
  → Mean pooling → L2 normalize → Cosine similarity × 7 centroids
  → Softmax(t=3.0) → Category + confidence
```

| Passo | Descrição |
|---|---|
| Tokenize | BERT tokenizer, max_length=128, pad/truncate |
| Embed | paraphrase-multilingual-MiniLM-L12-v2 ONNX → vetor 384-dim |
| Pool | Mean pooling dos embeddings de token |
| Normalize | L2 normalize para vetor unitário |
| Compare | Cosseno com 7 centróides de categoria pré-computados |
| Softmax | Temperature=3.0, mapeia similaridades a probabilidades |
| Threshold | Confiança < 0,3 → categoria "Outro" |

## Container

```
┌─────────────────────────────────────────────────┐
│  ia:8000 (Python 3.12-slim, 800M RAM max)      │
│                                                   │
│  FastAPI ← POST /classify, /classify-full, etc.   │
│     ↓                                             │
│  inference.py (ONNX Runtime session)              │
│     ├── text_session → paraphrase-multilingual-MiniLM-L12-v2.onnx │
│     └── image_session → mobilenetv3.onnx          │
│     └── centroids.json (7 vetores pré-computados) │
│                                                   │
│  Healthcheck: GET /health (a cada 30s)            │
│  Restart: unless-stopped                          │
└─────────────────────────────────────────────────┘
```

- **Docker multi-stage:** Builder (PyTorch 3GB) → exporta ONNX → runtime (~200MB)
- **Fallback:** classificador por palavras-chave ativa se o ONNX falhar ao
  carregar ou o container de IA cair; há também fallback opcional via API do
  Hugging Face (ver `docs/arquitetura/diagramas.md`).
- **Endpoints:** `POST /classify`, `/classify-full`, `/classify-image`,
  `/text-similarity`, `/summarize` e `GET /health`.
- **Circuit breaker (no backend):** 3 falhas de IA → cooldown 60s, timeout 3s;
  nunca bloqueia a criação do defeito.

Experimentos e métricas do classificador: [`experimentos/RELATORIO_ACADEMICO.md`](experimentos/RELATORIO_ACADEMICO.md).
