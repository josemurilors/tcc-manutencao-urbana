from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from transformers import pipeline
import asyncio
import os

app = FastAPI()

# Inicializar o modelo de classificação
classifier = None
categories = ["Buraco", "Iluminação", "Semáforo", "Árvore Caída", "Outro"]

class ClassificationRequest(BaseModel):
    text: str

class ClassificationResponse(BaseModel):
    category: str
    confidence: float

@app.on_event("startup")
async def load_model():
    global classifier
    # Inicializar o classificador
    classifier = pipeline("zero-shot-classification", model="facebook/bart-large-mnli")

@app.post("/classify", response_model=ClassificationResponse)
async def classify_text(request: ClassificationRequest):
    try:
        # Classificar texto
        result = classifier(request.text, categories)
        
        # Obter categoria com maior pontuação
        max_index = result["scores"].index(max(result["scores"]))
        category = result["labels"][max_index]
        confidence = result["scores"][max_index]
        
        return ClassificationResponse(
            category=category,
            confidence=confidence
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")