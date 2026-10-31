# Tralked — Plano 2: site completo

Data: 2026-10-31 · Dono: Lucas (Ludai Labs) · Base: `2026-10-31-gamelog-design.md` (continua valendo; este documento acrescenta e altera).

## Decisões do Lucas (conversa)
- **Nome: Tralked.** Identidade visual do handoff (tokens, Archivo + JetBrains Mono, acento `#C6F432`). Logotipo `TRAL`+`K` em acento+`ED`, símbolo Badge com ✓.
- **Contas no modelo Exophase**: Steam (OpenID, já existe), PSN, Xbox, RetroAchievements e Google (login). PSN/Xbox: o usuário informa a ID/gamertag, prova a posse colando um código temporário no "Sobre mim"/bio do perfil, e o Tralked lê o perfil público com uma **conta de serviço própria** (credenciais em env). Risco aceito: acesso não oficial, pode quebrar. Nunca pedir senha/token ao usuário. RetroAchievements: API oficial (chave em env), posse via código no "motto" do perfil. Google: OAuth (login de leitores; pode ser vinculado a uma conta existente).
- **Página de cada jogo = perfil dinâmico** (prévia aprovada `preview/tralked-jogo.html`): na **primeira visita** a caixa lacrada abre (lacre, capa, disco girando com reflexo iridescente voando para a página, encarte virando fundo), com "Pular" e "Abrir a capinha de novo"; reduced-motion → sem animação. Página em formato de encarte aberto (ficha à esquerda, disco com anel de progresso e troféus à direita; disco dourado/holográfico ao platinar), seção "O que este jogo deu ao seu personagem", fileiras estilo Netflix: trailers e vídeos, imagens oficiais, **faixa de notícias em movimento "Em circulação"**, abas de notícias do jogo, galeria da comunidade, família, "Na mesma estante". Dados das APIs (IGDB: vídeos, screenshots, artworks, metadados; SteamGridDB: capa/hero/logo; RAWG: nota).
- **Faixa de notícias em movimento** (referência Puk&Partners, aprovada): cartões editoriais em 5 variantes (papel, bloco de acento, "nova////…", retrato P&B com marca gigante, escuro), moldura fixa no centro destacando o cartão, pausa, arrastar, setas, para no hover/foco. **Também na home e na página de notícias.** Abas de notícias com indicador deslizante, troca animada e diagramação de revista (principal + 2 secundárias + "Mais lidas").
- **RPG completo com tudo que for sincronizável**: nível geral (XP de todas as plataformas; peso por raridade; gamerscore do Xbox também conta), skills por gênero, e **atributos**: Vigor (horas jogadas, retorno decrescente), Precisão (conquistas < 5% e modo hardcore RA), Glória (troféus ponderados bronze 1 · prata 2 · ouro 5 · platina 15; Steam/Xbox/RA recebem nível pelo percentual de raridade), Coleção (jogos 100%/platinados), Exploração (variedade de jogos e gêneros), Constância (dias ativos e sequência), Sabedoria (guias, dicas, respostas resolvidas, votos).
- **Comunidade**: comentários (notícias, guias, fotos), **fórum** (seções gerais + tópico por jogo; resposta "Resolveu" dá Sábio), **galeria estilo Instagram** (fotos de jogos marcadas com jogo, curtidas, comentários, grade no perfil, foto da semana, limite diário de XP).
- **Admin/CMS**: notícias, guias, moderação, fraude, gêneros.
- **Robôs**: acessos para robôs criarem notícias e guias automaticamente, bem formatados.
- Monetização aprovada (spec base §6.12): espaço de anúncio no editorial nesta fase.

## Decisões do Claude (revisáveis)
- **Formato de conteúdo único em blocos** (`ContentBlock[]` JSON) para notícias e guias: `heading`(nível 2–3), `paragraph` (texto com marcação inline restrita: **negrito**, *itálico*, links http(s)), `list` (ordenada/não), `quote` (+autor), `image` (url https, alt obrigatório, crédito obrigatório), `video` (YouTube id), `callout` (info/aviso/spoiler), `table` (cabeçalho + linhas, até 8 colunas), `achievement` (referência por apiName/id → cartão com raridade e XP), `divider`. Sem HTML cru em lugar nenhum. Renderizador único no site; editor do admin usa o mesmo schema.
- **API para robôs** `/api/v1/*`: chave `Bearer tk_live_…` (hash SHA-256 no banco, exibida uma vez), escopos `articles:write`, `guides:write`, `publish`, `media:write`; `Idempotency-Key` obrigatório em POST; limite 60 req/min por chave; schemas zod estritos com erros por caminho (JSON Pointer); jogo resolvido por `slug | steamAppId | igdbId`; sem escopo `publish` o conteúdo entra como **rascunho na fila de revisão**; OpenAPI 3.1 em `/api/v1/openapi.json` e documentação em `/desenvolvedores`; log de ingestão no admin. Imagens só por URL https com crédito.
- **Notícias externas por jogo**: feeds RSS configuráveis no admin; armazenar só título, link, fonte e data (sem copiar texto); associar ao jogo por nome/aliases.
- **Armazenamento de imagens da galeria**: adaptador `local` (dev, `public/uploads`) e `blob` (Vercel Blob em produção, por env). JPEG/PNG/WebP até 8 MB, redimensionadas.
- **"Primeira abertura" do jogo**: tabela por usuário; deslogado usa localStorage.
- **Ledger**: entradas ganham `voidedAt`; confirmar fraude anula as entradas e recalcula (corrige pendência do Plano 1). "Despertar" no primeiro sync: sequência de level-ups mostrada uma vez.
- Banco segue chamado `gamelog` localmente (nome interno).

## Fora deste plano
Deploy na Vercel e chaves reais (Plano 4), cartas colecionáveis, guildas, boss mundial, extensão Twitch, assistente IA, assinatura Tralked+.

## Qualidade
Cada tela validada com Playwright (desktop 1440 e mobile 390, screenshots revisadas), axe (sem violações sérias/críticas), detector `impeccable` (sem achados de alta severidade sem justificativa), lint/tsc/testes/build verdes, revisão por tarefa e revisão final.
