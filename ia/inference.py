import json
import re
import os
import unicodedata
import numpy as np
from pathlib import Path

CATEGORY_KEYWORDS = {
    "Buraco": [
        "buraco", "buraqueira", " cratera ", "afundamento", "asfalto",
        "pavimento", "quebrado", "erosao", "sulco", "depressao",
    ],
    "Iluminacao": [
        "poste", "luz", "lampada", "iluminacao", "apagado", "escuro",
        "farol", "luminaria", "reflator", "lâmpada", "iluminação",
    ],
    "Semafaro": [
        "semafaro", "sinaleira", "transito", "cruzamento", "semáforo",
        "farol", "pedestre", "trafego", "trafego",
    ],
    "Arvore Caida": [
        "arvore", "galho", "tronco", "queda", "caiu", "tempestade",
        "árvore", "folha", "raiz", "calçada", "planta", "poda",
    ],
    "Entulho": [
        "entulho", "lixo", "residuo", "detrito", "sujeira", "acumulo",
        "resíduo", "detrito", "sujidade", "descarte", "material",
    ],
    "Calcada Danificada": [
        "calcada", "passeio", "calcamento", "rachadura", "calçada",
        "quebrado", "tampa", "bueiro", "esgoto", "boca de lobo",
    ],
}

PRIORITY_KEYWORDS = {
    # Com acento: é o que o painel mostra. A comparação ignora acentos dos dois lados.
    "urgente": [
        "acidente", "atropelamento", "desabamento", "explosão", "incêndio",
        "vazamento de gás", "choque", "eletrocussão", "desabou", "criança",
        "hospital", "emergência", "risco", "perigo", "iminente",
        "queda de árvore", "árvore caiu", "fio partido", "fio elétrico",
    ],
    "alta": [
        "buraco enorme", "buraqueira", "semafaro quebrado", "poste caido",
        "alagamento", "enchente", "deslizamento", "desmoronamento",
        "falta de luz", "apagao", "transito", "congestionamento",
        "calçada quebrada", "tampa de bueiro", "boca de lobo",
        "vazamento", "esgoto a ceu aberto", "esgoto estourado",
    ],
    "media": [
        "buraco", "calcada", "iluminacao", "lampada", "entulho",
        "lixo", "sujeira", "poda", "galho", "pavimento",
        "asfalto", "sinaleira", "cruzamento",
    ],
}

SPAM_KEYWORDS = [
    "teste", "test", "asdf", "qwerty", "123", "foo", "bar",
    "testando", "aleatorio", "lorem ipsum", "xxx", "kkk",
    "blablabla", "nao sei", "qualquer coisa",
]


def _mean_pooling(embeddings: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    mask = attention_mask[:, :, np.newaxis].astype(np.float32)
    sum_emb = np.sum(embeddings * mask, axis=1)
    sum_mask = np.clip(np.sum(mask, axis=1), a_min=1e-9, a_max=None)
    return sum_emb / sum_mask


def _normalize(embeddings: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(embeddings, axis=-1, keepdims=True)
    return embeddings / np.clip(norms, a_min=1e-9, a_max=None)


def _softmax(x: np.ndarray) -> np.ndarray:
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum()


class TextClassifier:
    def __init__(
        self,
        model_path: str | None = None,
        categories: list[str] | None = None,
    ):
        self.categories = categories or list(CATEGORY_KEYWORDS.keys()) + ["Outro"]
        self.session = None
        self.tokenizer = None
        self.centroids: np.ndarray | None = None
        self.centroid_labels: list[str] | None = None

        if model_path:
            path = Path(model_path)
            if path.exists():
                try:
                    self._load_onnx(path)
                except Exception as e:
                    print(f"Erro ao carregar modelo ONNX: {e}")
                    self.session = None

    def _load_onnx(self, model_path: Path):
        import onnxruntime as ort
        self.session = ort.InferenceSession(str(model_path))

        model_dir = model_path.parent
        centroids_path = model_dir / "centroids.npy"
        labels_path = model_dir / "centroids_labels.json"

        if centroids_path.exists() and labels_path.exists():
            self.centroids = np.load(str(centroids_path))
            with open(labels_path) as f:
                self.centroid_labels = json.load(f)

        tz_path = model_dir / "tokenizer.json"
        if tz_path.exists():
            from tokenizers import Tokenizer
            self.tokenizer = Tokenizer.from_file(str(tz_path))
            # Completa só até o maior texto do lote: o mean pooling ignora o
            # preenchimento pela máscara, e fixar 128 deixava cada texto ~25x mais caro.
            self.tokenizer.enable_padding()
            self.tokenizer.enable_truncation(max_length=128)
        else:
            alt_path = model_dir / "tokenizer_config.json"
            if alt_path.exists():
                print("Aviso: tokenizer.json nao encontrado — usando fallback keyword")

    def classify(self, text: str) -> tuple[str, float]:
        if self.session is not None and self.tokenizer is not None and self.centroids is not None:
            try:
                emb = self._encode(text)
                if emb is not None:
                    sims = self.centroids @ emb
                    scores = _softmax(sims * 3.0)
                    idx = int(np.argmax(scores))
                    confidence = float(scores[idx])
                    label = self.centroid_labels[idx] if idx < len(self.centroid_labels) else "Outro"
                    return label, confidence
            except Exception as e:
                print(f"Erro na inferencia ONNX (texto): {e}")
        return self._keyword_classify(text)

    def _encode(self, text: str) -> np.ndarray | None:
        text = text[:500]
        encoding = self.tokenizer.encode(text)
        input_ids = np.array([encoding.ids], dtype=np.int64)
        attention_mask = np.array([encoding.attention_mask], dtype=np.int64)

        outputs = self.session.run(
            None,
            {"input_ids": input_ids, "attention_mask": attention_mask},
        )
        last_hidden = outputs[0]
        pooled = _mean_pooling(last_hidden, attention_mask)
        pooled = _normalize(pooled)
        return pooled[0]

    def encode_similarity(self, text1: str, text2: str) -> float:
        if self.session is None or self.tokenizer is None:
            return _jaccard_similarity(text1, text2)
        try:
            emb1 = self._encode(text1)
            emb2 = self._encode(text2)
            if emb1 is not None and emb2 is not None:
                return float(emb1 @ emb2)
        except Exception:
            pass
        return _jaccard_similarity(text1, text2)

    def encode_batch(self, texts: list[str]) -> list[list[float]] | None:
        if self.session is None or self.tokenizer is None:
            return None
        try:
            # Uma passada do ONNX por lote, em vez de um texto por vez.
            embeddings = []
            for i in range(0, len(texts), 32):
                encodings = self.tokenizer.encode_batch([t[:500] for t in texts[i:i + 32]])
                input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
                attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
                outputs = self.session.run(None, {"input_ids": input_ids, "attention_mask": attention_mask})
                pooled = _normalize(_mean_pooling(outputs[0], attention_mask))
                embeddings.extend(v.tolist() for v in pooled)
            return embeddings
        except Exception as e:
            print(f"Erro no encode_batch: {e}")
            return None

    def _keyword_classify(self, text: str) -> tuple[str, float]:
        text_lower = text.lower()
        scores = {}
        for cat, keywords in CATEGORY_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw.lower() in text_lower)
            if score > 0:
                scores[cat] = score
        if not scores:
            return "Outro", 0.0
        best_cat = max(scores, key=scores.get)
        total = sum(scores.values())
        confidence = min(scores[best_cat] / total, 0.95)
        return best_cat, confidence


class ImageClassifier:
    CATEGORY_MAP = [
        "Buraco", "Iluminacao", "Semafaro", "Arvore Caida",
        "Entulho", "Calcada Danificada", "Outro",
    ]

    def __init__(self, model_path: str | None = None):
        self.session = None
        if model_path:
            path = Path(model_path)
            if path.exists():
                try:
                    import onnxruntime as ort
                    self.session = ort.InferenceSession(str(path))
                    print(f"Modelo de imagem ONNX carregado: {path}")
                except Exception as e:
                    print(f"Erro ao carregar modelo de imagem: {e}")
                    self.session = None

    def classify(self, image_bytes: bytes) -> tuple[str, float]:
        if self.session is None:
            return "Outro", 0.0

        from PIL import Image
        import io
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img = img.resize((224, 224))
            img_array = np.array(img, dtype=np.float32) / 255.0
            mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
            img_array = (img_array - mean) / std
            img_array = np.transpose(img_array, (2, 0, 1))
            img_array = np.expand_dims(img_array, axis=0).astype(np.float32)

            outputs = self.session.run(None, {self.session.get_inputs()[0].name: img_array})
            features = outputs[0][0]
            return "Outro", 0.5
        except Exception as e:
            print(f"Erro na inferencia de imagem: {e}")
            return "Outro", 0.0


def _sem_acento(texto: str) -> str:
    # As palavras-chave estão sem acento: "criança" precisa casar com "crianca".
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")


def extract_priority_terms(text: str) -> tuple[str, float, list[str]]:
    """Prioridade por palavras-chave, com os termos que a decidiram."""
    text_lower = _sem_acento(text.lower()[:500])
    scores = {}
    termos = {}
    for priority, keywords in PRIORITY_KEYWORDS.items():
        achados = [kw for kw in keywords if _sem_acento(kw.lower()) in text_lower]
        if achados:
            scores[priority] = sum(2 if len(kw.split()) > 1 else 1 for kw in achados)
            termos[priority] = achados
    if not scores:
        return "baixa", 0.3, []
    best = max(scores, key=scores.get)
    total = sum(scores.values())
    confidence = min(scores[best] / total, 0.95)
    return best, confidence, termos[best]


def extract_priority(text: str) -> tuple[str, float]:
    priority, confidence, _ = extract_priority_terms(text)
    return priority, confidence


def _jaccard_similarity(text1: str, text2: str) -> float:
    t1 = text1.lower()[:500]
    t2 = text2.lower()[:500]
    words1 = set(re.findall(r'\w+', t1))
    words2 = set(re.findall(r'\w+', t2))
    if not words1 or not words2:
        return 0.0
    intersection = words1 & words2
    return len(intersection) / max(len(words1), len(words2))


def text_similarity(text1: str, text2: str, text_classifier: TextClassifier | None = None) -> float:
    if text_classifier is not None:
        return text_classifier.encode_similarity(text1, text2)
    return _jaccard_similarity(text1, text2)


def is_spam(text: str) -> tuple[bool, float, str]:
    text_lower = text.lower()[:500]
    words = re.findall(r'\w+', text_lower)
    if len(words) < 3:
        return True, 0.9, "Descricao muito curta"
    for kw in SPAM_KEYWORDS:
        if kw in text_lower:
            return True, 0.8, "Conteudo generico ou de teste"
    unique_ratio = len(set(words)) / max(len(words), 1)
    if unique_ratio < 0.3 and len(words) > 5:
        return True, 0.7, "Texto repetitivo"
    return False, 0.0, ""
