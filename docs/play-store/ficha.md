# Play Store — ficha do app e checklist de publicação

Tudo o que o Play Console pede, pronto para copiar. Os arquivos de imagem
estão nesta pasta.

## Identidade

| Campo | Valor |
| --- | --- |
| Nome do app | Central de Inteligência Urbana |
| Pacote | `com.ciu.mobile` |
| Categoria | Ferramentas (alternativa: Mapas e navegação) |
| E-mail de contato | <caioalencarcinel@gmail.com> |
| Política de privacidade | <https://tcc.josemurilors.com.br/privacidade.html> |
| Exclusão de conta | <https://tcc.josemurilors.com.br/excluir-conta.html> |
| Ícone 512×512 | `icon-512.png` |
| Feature graphic 1024×500 | `feature-graphic-1024x500.png` |
| Screenshots | pendente — tirar no APK instalado (mínimo 2, 16:9 ou 9:16, ≥ 320 px) |

## Descrição curta (até 80 caracteres)

```
Registre buracos, iluminação e outros defeitos da sua cidade e acompanhe.
```

## Descrição completa (até 4000 caracteres)

```
A Central de Inteligência Urbana (CIU) conecta moradores e prefeitura para
resolver problemas da cidade mais rápido.

VIU UM PROBLEMA? REGISTRE EM SEGUNDOS
Tire uma foto do buraco, do poste apagado, do semáforo quebrado ou da
árvore caída. O app usa sua localização para marcar o ponto exato e sugere
a categoria automaticamente.

ACOMPANHE O ATENDIMENTO
Cada chamado tem status: pendente, em andamento, atendido ou encerrado.
Você recebe a resposta da secretaria responsável dentro do app.

MAPA COLABORATIVO
Veja o que já foi reportado perto de você antes de abrir um chamado
repetido. Apoie chamados de outros moradores para dar mais visibilidade.
Sinalize o que já foi resolvido ou o que não existe.

GANHE NÍVEL E SUBA NO RANKING
Cada chamado válido, apoio e sinalização rende experiência. Compare sua
contribuição com a de outros moradores da sua cidade.

PARA A PREFEITURA
Operadores municipais recebem os chamados organizados por secretaria, com
foto, localização e histórico, e respondem direto pelo app.

Projeto acadêmico de código aberto, sem anúncios e sem venda de dados.
```

## Formulário de segurança de dados

Responder assim no Play Console (Política do app → Segurança dos dados):

| Pergunta | Resposta |
| --- | --- |
| O app coleta ou compartilha dados do usuário? | Sim |
| Dados criptografados em trânsito? | Sim |
| Oferece forma de solicitar exclusão? | Sim, no app e em `/excluir-conta.html` |

Tipos de dados a declarar:

| Tipo | Coletado | Compartilhado | Obrigatório | Finalidade |
| --- | --- | --- | --- | --- |
| Nome | sim | sim (operadores municipais) | sim | Funcionalidade do app, gestão da conta |
| E-mail | sim | sim (operadores municipais) | sim | Funcionalidade do app, gestão da conta |
| Localização aproximada e precisa | sim | não | não | Funcionalidade do app |
| Fotos | sim | não | não | Funcionalidade do app |
| Conteúdo gerado pelo usuário (chamados, apoios) | sim | não | não | Funcionalidade do app |
| CPF (outras informações pessoais) | sim | não | não | Prevenção de fraude, gestão da conta |
| Endereço IP (diagnóstico) | sim | não | sim | Segurança, análise |

## Classificação de conteúdo

Questionário IARC: responder "não" para violência, sexo, drogas, apostas,
linguagem imprópria e compras. Marcar "sim" em "os usuários podem
interagir ou trocar conteúdo" (chamados e fotos são públicos) e "o app
compartilha localização do usuário" (com operadores, ao abrir chamado).
Resultado esperado: Livre / PEGI 3.

## Declarações de permissão

| Permissão | Justificativa (se pedirem) |
| --- | --- |
| ACCESS_FINE_LOCATION | Marcar a posição exata do defeito no mapa enquanto o app está aberto. Sem uso em segundo plano. |
| CAMERA / READ_MEDIA_IMAGES | Fotografar ou anexar imagem do defeito ao chamado. |

Não usa localização em segundo plano, não usa acessibilidade, não usa
`QUERY_ALL_PACKAGES`.

## Checklist de publicação

1. [ ] Pagar a taxa e verificar identidade (Play Console).
2. [ ] Criar o app com nome, idioma pt-BR, tipo "App", gratuito.
3. [ ] Preencher ficha: descrições, ícone, feature graphic, screenshots.
4. [ ] Política de privacidade e exclusão de conta (URLs acima).
5. [ ] Segurança dos dados, classificação, público-alvo (18+ ou 13+), anúncios (não).
6. [ ] Subir o AAB do perfil `production` na faixa de teste fechado.
7. [ ] Copiar o SHA-1 de "Integridade do app → Assinatura do app" e
   cadastrar como segundo SHA-1 no client `TCC-android` e na restrição da
   chave do Maps (Google Cloud, projeto `ciu-tcc`).
8. [ ] Adicionar 12+ testadores e aguardar os 14 dias de teste.
9. [ ] Definir `GOOGLE_CLIENT_ID_ANDROID` no `.env` do servidor e reiniciar
   o backend.
10. [ ] Pedir acesso à produção e responder o questionário.

## Deploy do site

As páginas `privacidade.html` e `excluir-conta.html` ficam em
`frontend/public/` e são servidas na raiz do domínio após o próximo deploy
do frontend. Confirmar com `curl -I https://tcc.josemurilors.com.br/privacidade.html`.
