"""
Avaliação da precisão da detecção de duplicados.
Testa diferentes combinações de raio (metros) e limiar de similaridade (cosseno).
Gera matriz de acurácia para cada combinação.
"""

import json
import math
import urllib.request

IA_URL = "http://localhost:8000"


def get_embedding(text):
    """Obtém embedding de um texto via endpoint batch."""
    payload = json.dumps({"texts": [text]}).encode()
    req = urllib.request.Request(
        f"{IA_URL}/embeddings-batch",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        return result["embeddings"][0]
    except Exception as e:
        print(f"  Erro ao obter embedding: {e}")
        return None


def cosine_similarity(emb1, emb2):
    """Calcula similaridade cosseno entre dois embeddings."""
    dot_product = sum(a * b for a, b in zip(emb1, emb2))
    norm1 = math.sqrt(sum(a * a for a in emb1))
    norm2 = math.sqrt(sum(a * a for a in emb2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot_product / (norm1 * norm2)


# Dataset de pares para teste de duplicatas
# (texto1, texto2, distancia_m, eh_duplicata)
DUPLICATE_TEST_PAIRS = [
    # Duplicatas reais (mesmo defeito, descrições diferentes)
    ("buraco fundo na rua", "cratera no asfalto da via", 10, True),
    ("buraco na avenida", "buraqueira na pista", 25, True),
    ("poste apagado na rua", "lâmpada queimada no poste", 15, True),
    ("semáforo quebrado", "farol de trânsito com defeito", 20, True),
    ("árvore caída na rua", "galho grande caiu na via", 30, True),
    ("entulho na calçada", "lixo acumulado no passeio", 12, True),
    ("calçada quebrada", "piso danificado na calçada", 18, True),

    # Não-duplicatas (defeitos diferentes, mesmo local)
    ("buraco na rua", "poste apagado", 10, False),
    ("árvore caída", "entulho na calçada", 15, False),
    ("semáforo quebrado", "calçada danificada", 20, False),

    # Mesma descrição, locais diferentes
    ("buraco na rua", "buraco na rua", 100, False),
    ("poste apagado", "poste apagado", 200, False),

    # Descrições similares mas não idênticas
    ("buraco enorme na avenida", "buraco pequeno na rua", 50, False),
    ("poste de luz apagado", "poste com luz fraca", 25, True),

    # Casos limítrofes
    ("buraco fundo", "buraco raso", 30, False),
    ("calçada toda quebrada", "calçada com rachadura", 40, True),
]


def test_duplicate_detection(radius_m, similarity_threshold):
    """Testa detecção de duplicatas com parâmetros específicos."""
    results = {
        "radius_m": radius_m,
        "threshold": similarity_threshold,
        "true_positives": 0,
        "true_negatives": 0,
        "false_positives": 0,
        "false_negatives": 0,
        "total": len(DUPLICATE_TEST_PAIRS),
    }

    for text1, text2, distance, is_duplicate in DUPLICATE_TEST_PAIRS:
        emb1 = get_embedding(text1)
        emb2 = get_embedding(text2)

        if emb1 is None or emb2 is None:
            continue

        similarity = cosine_similarity(emb1, emb2)

        detected_as_duplicate = (
            distance <= radius_m and similarity >= similarity_threshold
        )

        if is_duplicate and detected_as_duplicate:
            results["true_positives"] += 1
        elif not is_duplicate and not detected_as_duplicate:
            results["true_negatives"] += 1
        elif is_duplicate and not detected_as_duplicate:
            results["false_negatives"] += 1
        else:
            results["false_positives"] += 1

    total = results["true_positives"] + results["true_negatives"] + results["false_positives"] + results["false_negatives"]
    accuracy = (results["true_positives"] + results["true_negatives"]) / total if total > 0 else 0

    precision = results["true_positives"] / (results["true_positives"] + results["false_positives"]) if (results["true_positives"] + results["false_positives"]) > 0 else 0
    recall = results["true_positives"] / (results["true_positives"] + results["false_negatives"]) if (results["true_positives"] + results["false_negatives"]) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    results["accuracy"] = round(accuracy, 4)
    results["precision"] = round(precision, 4)
    results["recall"] = round(recall, 4)
    results["f1"] = round(f1, 4)

    return results


def run_duplicate_evaluation():
    """Executa avaliação completa da detecção de duplicados."""
    print("=" * 70)
    print("AVALIAÇÃO DA DETECÇÃO DE DUPLICADOS")
    print(f"Dataset: {len(DUPLICATE_TEST_PAIRS)} pares de textos")
    print("=" * 70)

    radii = [30, 50, 100]
    thresholds = [0.70, 0.75, 0.80, 0.85]

    all_results = []

    print("\nTestando combinações de raio × limiar de similaridade...\n")
    print(f"{'Raio (m)':>10} {'Limiar':>10} {'Acurácia':>10} {'Precisão':>10} {'Recall':>10} {'F1':>10}")
    print("-" * 65)

    for radius in radii:
        for threshold in thresholds:
            result = test_duplicate_detection(radius, threshold)
            all_results.append(result)
            print(f"{radius:>10} {threshold:>10.2f} {result['accuracy']:>10.4f} {result['precision']:>10.4f} {result['recall']:>10.4f} {result['f1']:>10.4f}")

    # Empate no F1 fica com o limiar mais alto (mais conservador, menos falso positivo)
    best_result = max(all_results, key=lambda x: (x["f1"], x["threshold"]))
    print(f"\nMelhor combinação (por F1):")
    print(f"  Raio: {best_result['radius_m']}m")
    print(f"  Limiar: {best_result['threshold']}")
    print(f"  F1: {best_result['f1']:.4f}")
    print(f"  Acurácia: {best_result['accuracy']:.4f}")

    output = {
        "test_pairs": len(DUPLICATE_TEST_PAIRS),
        "radii_tested": radii,
        "thresholds_tested": thresholds,
        "results": all_results,
        "best_result": best_result,
    }

    with open("resultados_duplicados.json", "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nResultados salvos em: resultados_duplicados.json")

    return output


if __name__ == "__main__":
    run_duplicate_evaluation()
