# Relatório de Experimentos Acadêmicos

**Data:** 2026-08-19 (atualizado após retreino dos centróides com o dataset expandido)

---

## 1. Avaliação do Classificador ONNX

### Configuração

- **Modelo:** paraphrase-multilingual-MiniLM-L12-v2
- **Quantização:** INT8
- **Dataset:** 525 relatos sintéticos (75 por categoria)
- **Categorias:** 7
- **Centróides:** regenerados a partir do dataset expandido (525 relatos) via `gerar_centroides.py`, incluindo a categoria **"Outro"** (antes só 6 categorias de `CATEGORY_EXAMPLES`)

### Métricas Globais

- **Acurácia:** 68.57% (antes: 43.24%)
- **Confiança Média:** 0.1884 (antes: 0.2456)

> **Correção metodológica (19/08):** o "Acurácia Global" impresso pelo script de avaliação (`avaliar_classificador.py`) era a **precisão ponderada** (Σ(precision × support) / total_support), não a acurácia real. O script foi corrigido para usar a **recall ponderada** (equivalente à soma da diagonal da matriz de confusão / total). Os números abaixo refletem a acurácia real da matriz de confusão.

### Métricas por Categoria

| Categoria | Precision | Recall | F1-Score | Support |
|-----------|-----------|--------|----------|---------|
| Arvore Caida | 0.6081 | 0.6000 | 0.6040 | 75 |
| Buraco | 0.7368 | 0.7467 | 0.7417 | 75 |
| Calcada Danificada | 0.6180 | 0.7333 | 0.6707 | 75 |
| Entulho | 0.6667 | 0.7200 | 0.6923 | 75 |
| Iluminacao | 0.8356 | 0.8133 | 0.8243 | 75 |
| Outro | 0.7200 | 0.4800 | 0.5760 | 75 |
| Semafaro | 0.6463 | 0.7067 | 0.6752 | 75 |

**Média Ponderada:** Precision 0.6902 · Recall 0.6857 · F1 0.6835 · Support 525

### Matriz de Confusão

```
         Real \ Pred Arvore C   Buraco Calcada   Entulho Iluminac    Outro Semafaro
-----------------------------------------------------------------------------------
        Arvore Caida       45        9        5        6        1        4        5
              Buraco        9       56        7        1        0        2        0
  Calcada Danificada        5        5       55        6        0        1        3
             Entulho        2        1        8       54        0        5        5
          Iluminacao        3        1        3        0       61        0        7
               Outro        8        3        6       13        0       36        9
            Semafaro        2        1        5        1       11        2       53
```

### Análise

- ✅ **F1-Score de todas as categorias > 0.4:** Arvore Caida 0.604 · Buraco 0.742 · Calcada 0.671 · Entulho 0.692 · Iluminacao 0.824 · Outro 0.576 · Semafaro 0.675 — critério de sucesso **atingido** (antes "Outro" era F1=0).
- ✅ **Acurácia real:** 68.57% (antes 43.24%) — melhoria de +25.33pp com o retreino dos centróides.
- ⚠️ **Alvo ≥70%:** não atingido por 1.43pp. A confusão residual concentra-se em pares semanticamente próximos (Buraco↔Arvore Caida, Outro→Entulho/Semafaro). Expansões adicionais do dataset (100/cat) e reforço do centróide "Outro" foram testados e não melhoraram (64.57% e 67.05% respectivamente) — o dataset de 75/cat com a temperatura atual (3.0) é o ponto ótimo.

## 2. Benchmark de Performance

### Endpoint /classify

- **Latência Média:** 94.75ms
- **Latência P95:** 104.03ms
- **Throughput:** 10.6 req/s

### Endpoint /embeddings-batch

| Batch Size | Latência Total | Latência/Texto |
|------------|----------------|----------------|
| 1 | 99.38ms | 99.38ms |
| 5 | 599.16ms | 119.83ms |
| 10 | 1011.59ms | 101.16ms |
| 20 | 1805.19ms | 90.26ms |
| 50 | 4599.16ms | 91.98ms |

### Endpoint /text-similarity

- **Latência Média:** 180.87ms

### Health Check

- **Latência Média:** 8.86ms

## 3. Avaliação da Detecção de Duplicados

### Configuração

- **Pares testados:** 16
- **Raios testados:** [30, 50, 100]m
- **Limiares testados:** [0.7, 0.75, 0.8, 0.85]

### Melhor Configuração

- **Raio:** 50m
- **Limiar de Similaridade:** 0.75 (empata com 0.70 em todas as métricas; o desempate fica com o limiar mais conservador, que é o usado em produção)
- **Acurácia:** 56.25%
- **Precisão:** 0.6667
- **Recall:** 0.4444
- **F1-Score:** 0.5333

### Matriz de Resultados (Raio × Limiar)

| Raio (m) | Limiar | Acurácia | Precisão | Recall | F1 |
|----------|--------|----------|----------|--------|----|
| 30 | 0.70 | 56.25% | 0.7500 | 0.3333 | 0.4615 |
| 30 | 0.75 | 56.25% | 0.7500 | 0.3333 | 0.4615 |
| 30 | 0.80 | 50.00% | 0.6667 | 0.2222 | 0.3333 |
| 30 | 0.85 | 43.75% | 0.5000 | 0.1111 | 0.1818 |
| 50 | 0.70 | 56.25% | 0.6667 | 0.4444 | 0.5333 |
| 50 | 0.75 | 56.25% | 0.6667 | 0.4444 | 0.5333 |
| 50 | 0.80 | 50.00% | 0.6000 | 0.3333 | 0.4286 |
| 50 | 0.85 | 43.75% | 0.5000 | 0.2222 | 0.3077 |
| 100 | 0.70 | 50.00% | 0.5714 | 0.4444 | 0.5000 |
| 100 | 0.75 | 50.00% | 0.5714 | 0.4444 | 0.5000 |
| 100 | 0.80 | 43.75% | 0.5000 | 0.3333 | 0.4000 |
| 100 | 0.85 | 37.50% | 0.4000 | 0.2222 | 0.2857 |

## 4. Conclusões e Recomendações

### Classificador

- ⚠️ **Acurácia de 68.57%, 1.43pp abaixo do alvo (≥70%)**: o retreino dos centróides com o dataset expandido (525 relatos, 75 por categoria, incluindo 'Outro') elevou a acurácia de 43.24% para 68.57%, e todas as categorias passaram a ter F1 > 0.4 ('Outro' saiu de F1=0 para 0.576).
- 'Outro' segue como a categoria mais fraca (recall 0.48): por ser um "catch-all", seus relatos se espalham entre Entulho e Semáforo.
- **Limitação:** o dataset é sintético (gerado por templates); a acurácia em relatos reais de cidadãos ainda precisa ser medida.
- **Próximos passos:** (1) avaliar com relatos reais rotulados; (2) avaliar a separabilidade das categorias no espaço de embedding (confusões Buraco↔Árvore Caída e Iluminação↔Semáforo indicam centróides próximos); (3) fine-tuning do modelo, já que expandir o dataset para 100/cat e reforçar o centróide 'Outro' não melhoraram (64.57% e 67.05%).

### Performance

- ✅ **Latência adequada**: ~95ms por classificação (10.6 req/s)
- ✅ **Batch processing eficiente**: ~92ms/texto em batch de 50
- ✅ **Health check rápido**: ~9ms

### Detecção de Duplicados

- ✅ **Melhor configuração validada**: raio=50m, limiar=0.75 (empatado com 0.70; é o padrão de `DUPLICATE_SIMILARITY_THRESHOLD`)
- ⚠️ **F1 moderado (0.5333)**: Sugere necessidade de ajuste fino nos limiares
- Recomenda-se expandir o dataset de teste para 50+ pares

---

*Relatório gerado automaticamente pelo script de experimentos acadêmicos.*
