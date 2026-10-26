import os
import base64
import json
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import httpx

from dotenv import load_dotenv

load_dotenv()

CATEGORIES = os.getenv(
    "CLASSIFICATION_CATEGORIES",
    "Buraco,Iluminacao,Semafaro,Arvore Caida,Entulho,Calcada Danificada,Outro"
).split(",")

FALLBACK = os.getenv("CLASSIFICATION_FALLBACK", "").lower() in ("true", "1", "yes")
HF_API_URL = os.getenv(
    "CLASSIFICATION_API_URL",
    "https://api-inference.huggingface.co/models/facebook/bart-large-mnli"
)
HF_API_KEY = os.getenv("CLASSIFICATION_API_KEY", "")
REQUEST_TIMEOUT = int(os.getenv("CLASSIFICATION_TIMEOUT", "10"))

text_classifier = None
image_classifier = None


def load_models():
    global text_classifier, image_classifier

    model_dir = Path(__file__).parent / "models"
    text_model_path = model_dir / "text_model.onnx"
    image_model_path = model_dir / "image_model.onnx"

    from inference import TextClassifier, ImageClassifier

    text_classifier = TextClassifier(
        model_path=str(text_model_path) if text_model_path.exists() else None,
        categories=CATEGORIES,
    )
    if text_model_path.exists():
        print(f"Modelo de texto ONNX carregado: {text_model_path}")
    else:
        print("Modelo ONNX de texto nao encontrado — usando classificador por palavras-chave")

    if image_model_path.exists():
        try:
            image_classifier = ImageClassifier(str(image_model_path))
            print(f"Modelo de imagem carregado: {image_model_path}")
        except Exception as e:
            print(f"Erro ao carregar modelo de imagem: {e}")
            image_classifier = None
    else:
        print("Modelo ONNX de imagem nao encontrado — classificador de imagem indisponivel")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_models()
    yield


app = FastAPI(title="Classificador de Defeitos Urbanos", lifespan=lifespan)


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)


class TextPairRequest(BaseModel):
    text1: str = Field(..., min_length=1, max_length=5000)
    text2: str = Field(..., min_length=1, max_length=5000)


class BatchEmbeddingsRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=50)


class BatchEmbeddingsResponse(BaseModel):
    embeddings: list[list[float]]


class ImageRequest(BaseModel):
    image: str


class ClassificationResponse(BaseModel):
    category: str
    confidence: float


class PriorityResponse(BaseModel):
    priority: str
    confidence: float


class SimilarityResponse(BaseModel):
    score: float


class SpamResponse(BaseModel):
    is_spam: bool
    confidence: float
    reason: str


class FullClassifyResponse(BaseModel):
    category: str
    confidence: float
    priority: str
    priority_confidence: float


async def hf_classify(text: str) -> tuple[str, float]:
    headers = {"Content-Type": "application/json"}
    if HF_API_KEY:
        headers["Authorization"] = f"Bearer {HF_API_KEY}"

    payload = {"inputs": text, "parameters": {"candidate_labels": CATEGORIES}}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(HF_API_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    scores = data.get("scores", [])
    labels = data.get("labels", CATEGORIES)
    if not scores:
        raise ValueError("Resposta da API nao contem 'scores'")

    max_idx = scores.index(max(scores))
    return labels[max_idx], scores[max_idx]


@app.post("/classify", response_model=ClassificationResponse)
async def classify_text(request: TextRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")

    try:
        category, confidence = text_classifier.classify(request.text)
        return ClassificationResponse(category=category, confidence=confidence)
    except Exception as e:
        print(f"Erro na inferencia local (texto): {e}")

    if FALLBACK:
        try:
            category, confidence = await hf_classify(request.text)
            return ClassificationResponse(category=category, confidence=confidence)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Timeout da API")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=503, detail="Nenhum classificador disponivel")


@app.post("/classify-full", response_model=FullClassifyResponse)
async def classify_full(request: TextRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")

    from inference import extract_priority
    try:
        category, confidence = text_classifier.classify(request.text)
    except Exception:
        if not FALLBACK:
            raise HTTPException(status_code=503, detail="Nenhum classificador disponivel")
        try:
            category, confidence = await hf_classify(request.text)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    priority, priority_confidence = extract_priority(request.text)
    return FullClassifyResponse(
        category=category,
        confidence=confidence,
        priority=priority,
        priority_confidence=priority_confidence,
    )


@app.post("/classify-image", response_model=ClassificationResponse)
async def classify_image(request: ImageRequest):
    if not request.image:
        raise HTTPException(status_code=400, detail="Imagem vazia")

    if len(request.image) > 1_400_000:
        raise HTTPException(status_code=400, detail="Imagem muito grande (max ~1MB base64)")

    try:
        image_bytes = base64.b64decode(request.image)
    except Exception:
        raise HTTPException(status_code=400, detail="Base64 invalido")

    if image_classifier is not None:
        try:
            category, confidence = image_classifier.classify(image_bytes)
            return ClassificationResponse(category=category, confidence=confidence)
        except Exception as e:
            print(f"Erro na inferencia local (imagem): {e}")
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=503, detail="Classificador de imagem indisponivel")


@app.post("/priority", response_model=PriorityResponse)
async def classify_priority(request: TextRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")
    from inference import extract_priority
    priority, confidence = extract_priority(request.text)
    return PriorityResponse(priority=priority, confidence=confidence)


class PriorityItem(BaseModel):
    priority: str
    confidence: float
    terms: list[str]


class BatchPriorityResponse(BaseModel):
    items: list[PriorityItem]


@app.post("/priority-batch", response_model=BatchPriorityResponse)
async def priority_batch(request: BatchEmbeddingsRequest):
    """Prioridade de vários relatos de uma vez, com os termos que a decidiram."""
    from inference import extract_priority_terms
    items = []
    for text in request.texts:
        priority, confidence, terms = extract_priority_terms(text)
        items.append(PriorityItem(priority=priority, confidence=confidence, terms=terms))
    return BatchPriorityResponse(items=items)


@app.post("/text-similarity", response_model=SimilarityResponse)
async def similarity(request: TextPairRequest):
    from inference import text_similarity
    score = text_similarity(request.text1, request.text2, text_classifier)
    return SimilarityResponse(score=score)


@app.post("/embeddings-batch", response_model=BatchEmbeddingsResponse)
async def embeddings_batch(request: BatchEmbeddingsRequest):
    if not request.texts:
        raise HTTPException(status_code=400, detail="Lista de textos vazia")
    
    embeddings = text_classifier.encode_batch(request.texts)
    if embeddings is None:
        raise HTTPException(status_code=503, detail="Modelo de embeddings indisponivel")
    
    return BatchEmbeddingsResponse(embeddings=embeddings)


@app.post("/check-spam", response_model=SpamResponse)
async def check_spam(request: TextRequest):
    if not request.text or not request.text.strip():
        return SpamResponse(is_spam=True, confidence=1.0, reason="Texto vazio")
    from inference import is_spam
    spam, confidence, reason = is_spam(request.text)
    return SpamResponse(is_spam=spam, confidence=confidence, reason=reason)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "text_model": text_classifier is not None,
        "text_onnx_loaded": text_classifier is not None and text_classifier.centroids is not None,
        "image_model": image_classifier is not None,
        "image_onnx_loaded": image_classifier is not None and image_classifier.session is not None,
        "fallback": FALLBACK,
        "categories": CATEGORIES,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
