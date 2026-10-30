# ai-github-changelogger

Gera changelogs automaticamente a partir de repositórios do GitHub, usando IA para ler **o diff real do código**, e não só as mensagens de commit.

> **Status: em desenvolvimento (v1).** A fundação (configuração e modelo de dados) está pronta. A interface de linha de comando descrita abaixo é o contrato da v1 e ainda está sendo implementada. Veja o [Roadmap](#roadmap).

---

## Por que analisar o diff?

Changelogs gerados a partir de mensagens de commit herdam os problemas dessas mensagens. "fix typo" pode esconder uma mudança na lógica de autenticação, e "refactor" pode quebrar uma API pública. Ferramentas que só classificam mensagens não conseguem detectar isso.

O ai-github-changelogger lê o que o código **de fato** mudou e:

- classifica cada mudança (feature, fix, refactor, perf, security...) com base no diff;
- detecta **breaking changes** mesmo quando ninguém as anunciou;
- sinaliza quando a mensagem **não condiz** com o código (`messageMatchesDiff: false`);
- aponta os arquivos que sustentam cada afirmação, para você poder conferir.

---

## Como funciona

```
 GitHub API ──► Coleta ──► Filtro ──► Análise por PR (map) ──► Agrupamento (reduce) ──► JSON
                  │           │               │                        │
             PRs/commits   remove        IA lê o diff de          IA consolida os
             + diffs       ruído         cada unidade e           resumos, agrupa por
                         (lockfiles,     devolve uma análise      categoria e escreve
                          build...)      estruturada              o resumo da release
```

1. **Coleta**: busca os PRs merged (ou commits) do intervalo pedido, com os arquivos alterados e seus patches.
2. **Filtro**: descarta o que não é código relevante, como `package-lock.json`, `dist/`, arquivos minificados e binários. Isso reduz custo e ruído antes de qualquer chamada à IA.
3. **Análise (map)**: cada PR é analisado separadamente pela IA, que devolve categoria, impacto, descrição, se é breaking change e quais arquivos sustentam a análise.
4. **Agrupamento (reduce)**: uma segunda chamada recebe só os resumos (não os diffs), agrupa por categoria, remove duplicatas e escreve o resumo geral.
5. **Validação**: todo dado que vem de fora (sua configuração, a API do GitHub, as respostas da IA) é validado antes de ser usado. O JSON final também é validado antes de ser entregue.

**O que é fato vem do código, o que é julgamento vem da IA.** Números de PR, URLs, autores e estatísticas de linhas são preenchidos pelo programa a partir do GitHub e nunca passam pela IA, então não podem ser inventados. A IA só produz texto e classificações.

---

## Requisitos

- **Node.js 24** ou superior
- **pnpm 10** (`corepack enable` instala automaticamente)
- Uma chave da **API da Anthropic** ([console.anthropic.com](https://console.anthropic.com))
- Recomendado: um **token do GitHub** (sem nenhum escopo; serve só para aumentar o limite de requisições)

A v1 funciona apenas com **repositórios públicos**.

---

## Instalação

```bash
git clone https://github.com/Dudu-Moura/ai-github-changelogger.git
cd ai-github-changelogger
pnpm install
cp .env.example .env   # e preencha as chaves
```

---

## Configuração

Toda a configuração é feita por variáveis de ambiente, num arquivo `.env` na raiz do projeto. Valores inválidos são rejeitados na inicialização com uma mensagem indicando qual variável corrigir.

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | sim | — | Chave da API da Anthropic |
| `GITHUB_TOKEN` | não | — | Token do GitHub. Sem ele, o limite é de 60 requisições/hora; com ele, 5.000 |
| `HF_TOKEN` | não | — | Token do Hugging Face (provider alternativo) |
| `MAP_MODEL` | não | `claude-opus-5-5` | Modelo usado na análise de cada PR |
| `REDUCE_MODEL` | não | `claude-opus-5-5` | Modelo usado no agrupamento final |
| `LLM_EFFORT` | não | `medium` | Profundidade de raciocínio: `low`, `medium` ou `high`. Mais alto é mais preciso, mas também mais caro e lento |
| `MAX_CONCURRENCY` | não | `4` | Quantos PRs são analisados em paralelo (1 a 16) |
| `LOG_LEVEL` | não | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace` |

> Um token do GitHub sem escopos é suficiente: crie em *Settings → Developer settings → Personal access tokens* sem marcar nenhuma permissão.

---

## Uso

```bash
pnpm changelog analyze <owner/repo> [opções]
```

### Exemplos

```bash
# Últimos 20 PRs merged do repositório, em inglês
pnpm changelog analyze facebook/react --last 20

# PRs merged desde 1º de outubro, com o changelog em português
pnpm changelog analyze vercel/next.js --since 2026-10-01 --lang pt-BR

# Um intervalo fechado, analisando commits em vez de PRs, salvo em arquivo
pnpm changelog analyze owner/repo --since 2026-09-01 --until 2026-09-30 --source commit --output changelog.json

# A saída padrão é JSON puro: dá para encadear com jq
pnpm changelog analyze owner/repo --last 10 | jq '.breakingChanges'
```

### Parâmetros

| Parâmetro | Descrição |
|---|---|
| `<owner/repo>` | Repositório público no formato `dono/nome` |
| `--last <n>` | Analisa as últimas `n` unidades (1 a 100) |
| `--since <data>` | Analisa a partir desta data (`AAAA-MM-DD`) |
| `--until <data>` | Data final, opcional (padrão: agora). Só vale junto com `--since` |
| `--source <pr\|commit>` | Unidade de análise. Padrão: `pr` |
| `--lang <código>` | Idioma dos textos do changelog, como `en`, `pt-BR` ou `es`. Padrão: `en` |
| `--output <arquivo>` | Salva o JSON num arquivo em vez de imprimir na tela |

Informe **`--last` ou `--since`**, nunca os dois.

**PR ou commit?** Prefira `pr` (o padrão). Um PR traz título, descrição e o diff consolidado de vários commits, o que dá mais contexto à IA e gera um changelog mais limpo. Use `commit` em repositórios onde as mudanças entram direto na branch principal, sem PRs.

**Por que o idioma muda só os textos?** As chaves e categorias do JSON (`feature`, `fix`, `breakingChanges`...) ficam sempre em inglês. Assim, scripts e ferramentas que consomem o JSON funcionam igual para qualquer idioma. Só os campos de texto livre (`title`, `description`, `summary`) seguem o `--lang`.

---

## Saída

A saída é um JSON com o resultado e os dados de como ele foi produzido. Exemplo (encurtado):

```json
{
  "meta": {
    "repo": "owner/repo",
    "source": "pr",
    "range": { "type": "last", "count": 20 },
    "language": "pt-BR",
    "generatedAt": "2026-10-28T18:00:00.000Z",
    "models": { "map": "claude-opus-5-5", "reduce": "claude-opus-5-5" },
    "usage": { "inputTokens": 312000, "outputTokens": 64000, "estimatedCostUsd": 2.53 }
  },
  "summary": "Esta release adiciona autenticação via OAuth e corrige a expiração de tokens...",
  "breakingChanges": [
    {
      "description": "O endpoint /v1/login agora exige o campo `clientId`.",
      "sources": [{ "kind": "pr", "ref": "#142", "url": "https://github.com/owner/repo/pull/142" }]
    }
  ],
  "groups": [
    {
      "category": "fix",
      "entries": [
        {
          "title": "Corrige expiração do refresh token",
          "description": "O refresh token passou a respeitar o TTL configurado, em vez de nunca expirar.",
          "impact": "medium",
          "confidence": 0.92,
          "messageMatchesDiff": false,
          "truncated": false,
          "sources": [{ "kind": "pr", "ref": "#138", "url": "https://github.com/owner/repo/pull/138" }],
          "files": [{ "path": "src/auth/token.ts", "status": "modified", "additions": 12, "deletions": 3 }]
        }
      ]
    }
  ],
  "skipped": [{ "ref": "#140", "reason": "No analyzable changes: package-lock.json (lockfile)" }]
}
```

### Campos

| Campo | Significado |
|---|---|
| `meta` | Como o changelog foi gerado: repositório, intervalo, modelos usados, tokens consumidos e custo estimado em dólares |
| `summary` | Resumo geral da release, escrito pela IA |
| `breakingChanges` | Mudanças que podem quebrar quem usa o projeto, com os PRs/commits de origem |
| `groups[].category` | `feature`, `fix`, `refactor`, `perf`, `security`, `docs`, `test` ou `chore` |
| `entries[].impact` | `low`, `medium` ou `high`: o quanto a mudança afeta quem usa o projeto |
| `entries[].confidence` | De 0 a 1: o quanto a IA está segura da análise. Valores baixos merecem revisão humana |
| `entries[].messageMatchesDiff` | `false` quando a mensagem do PR/commit não descreve o que o código realmente faz |
| `entries[].truncated` | `true` quando o diff era grande demais e a IA analisou só parte dele |
| `entries[].sources` | Links para os PRs/commits de origem |
| `entries[].files` | Arquivos que sustentam a análise, com linhas adicionadas e removidas |
| `skipped` | O que ficou de fora da análise e por quê. Nada é descartado em silêncio |

---

## Custos

Cada execução faz chamadas pagas à API da Anthropic. O custo depende principalmente do **tamanho dos diffs**. Valores de referência para **30 PRs** com cerca de 8 mil tokens de diff cada:

| Configuração | Custo aproximado por execução |
|---|---|
| Opus 5.5 nas duas etapas (padrão) | ~US$ 2,60 |
| Sonnet 5.5 nas duas etapas | ~US$ 1,30 |
| Haiku 5.5 na análise + Sonnet 5.5 no agrupamento | ~US$ 0,20 |

O custo real de cada execução aparece em `meta.usage.estimatedCostUsd`. Para economizar, troque `MAP_MODEL` e `REDUCE_MODEL` no `.env` ou reduza `LLM_EFFORT`.

---

## Limitações da v1

- **Somente repositórios públicos.**
- **Até 100 PRs/commits por execução**, pensado para repositórios de porte pequeno a médio.
- **Diffs muito grandes são analisados parcialmente.** Quando isso acontece, a entrada vem com `truncated: true`, e nunca é cortada sem aviso.
- O GitHub não envia o patch de arquivos binários ou muito grandes. Esses arquivos aparecem nas estatísticas, mas a IA não vê o conteúdo deles.
- A IA pode errar. Use `confidence` e `files` para decidir o que revisar.

---

## Decisões de projeto

- **Análise em duas etapas (map-reduce).** Mandar todos os diffs numa única chamada estouraria o limite de contexto e o orçamento. Analisar cada PR isoladamente e depois consolidar só os resumos mantém o custo previsível e permite paralelizar.
- **PR como unidade padrão.** Commits individuais costumam ser ruidosos ("wip", "fix lint"). O PR tem a intenção da mudança e o diff consolidado.
- **Saída estruturada e validada.** A IA é obrigada a responder num formato definido, e a resposta é validada antes de ser usada. Respostas fora do formato são rejeitadas, e o programa nunca tenta "adivinhar" o que a IA quis dizer.
- **Provedores de IA intercambiáveis.** O programa depende de uma interface, e não de um fornecedor específico. Claude é o padrão, e o Hugging Face entra como alternativa.
- **Modelo configurável por etapa.** A análise de cada PR e o agrupamento final têm exigências diferentes. Separar os modelos permite equilibrar custo e qualidade com base em medições, e não em suposições.

---

## Roadmap

**v1: changelog em JSON** *(em andamento)*
- [x] Configuração validada
- [x] Modelo de dados (entrada, unidades de mudança, análise, changelog)
- [x] Integração com a API do GitHub
- [x] Leitura, filtragem e divisão de diffs
- [ ] Integração com Claude (saída estruturada)
- [ ] Análise por PR e agrupamento
- [ ] Interface de linha de comando
- [ ] Harness de avaliação: mede acurácia, alucinação, custo e latência contra casos reais anotados
- [ ] Hugging Face como provedor alternativo

**v1.5: escala e agrupamento semântico**
- Cache das análises por commit, para não pagar duas vezes pelo mesmo diff
- Fila de processamento para repositórios grandes
- Embeddings (Hugging Face) para agrupar mudanças que tratam do mesmo assunto em PRs diferentes

**v2: relatório visual**
- Além do JSON, um relatório gerado por IA com o resumo do que mudou, os trechos de código alterados (com cores para adição, remoção e modificação), as referências aos arquivos e os trade-offs de cada mudança

---

## Desenvolvimento

```bash
pnpm dev          # roda direto do TypeScript
pnpm test         # testes
pnpm typecheck    # checagem de tipos
pnpm build        # gera o JavaScript em dist/
```

Estrutura em camadas:

```
src/
├── interface/       # linha de comando
├── application/     # orquestra o pipeline (coleta → filtro → análise → agrupamento)
├── domain/          # schemas, regras e interfaces; não depende de GitHub nem de IA
├── infrastructure/  # integrações: GitHub, Claude, Hugging Face, prompts
└── config/          # variáveis de ambiente
evals/               # harness de avaliação
```

---

## Licença

[MIT](LICENSE)
