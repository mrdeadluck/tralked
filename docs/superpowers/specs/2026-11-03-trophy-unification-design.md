# Unificação de troféus entre plataformas — design

Data: 2026-11-03 · Pedido de: Lucas (dono da Ludai Labs / Tralked) · Brainstorm nesta sessão.

## Por quê

Hoje um mesmo jogo jogado em PS4, PS5, PC e Xbox não aparece como uma coisa só, e às vezes nem
aparece certo:

- As listas de troféus da PSN de um mesmo jogo (PS4, PS5 e as regionais EUA/Europa/Ásia) caem
  todas no mesmo `Game` e na mesma linha `UserGame (userId, gameId, "psn")`. Os troféus da PSN usam
  `apiName = trophyId` ("0", "1", …), e `Achievement` é único por `(gameId, platform, apiName)`:
  o troféu 0 do PS4 e o troféu 0 do PS5 viram a mesma linha. É a causa de jogos como Wolverine
  com 0 troféus e de contagens erradas.
- A platina paga XP com `sourceKey = "psn:<gameId>"`: platinar no PS4 e no PS5 paga uma vez só.
- Há jogos duplicados no catálogo (dois "Ghost of Yōtei"), criados quando um título da PSN não
  casou pelo nome com o jogo existente (`lib/sync/platform-games.ts`).
- Na busca não dá para achar "só exclusivos de PlayStation" ou "só jogos com troféus".

O Lucas quer o perfil e a página do jogo redondos: cada jogo uma vez, com tudo o que o usuário fez
nele em cada plataforma, e cada conquista no lugar certo.

## Objetivos

1. **Uma página por jogo**, com o progresso do usuário separado por **versão**. Uma versão é uma
   lista de troféus de um console/loja: Steam (appid), PSN por console (PS3, PS4, PS5, Vita), Xbox
   (título), RetroAchievements (jogo).
2. **Regiões da PSN**: as listas regionais do mesmo jogo no mesmo console (stacks) aparecem
   **todas**, agrupadas dentro da versão daquele console: "PS5 · Platina · 2 regiões". Quando a
   região dá para deduzir, mostra bandeira; senão "Lista 1 / Lista 2".
3. **Regra de contagem (XP, nível, ranking, contador de platinas)**:
   - PS4 e PS5 do mesmo jogo contam como **duas** platinas (decisão do Lucas).
   - Listas regionais do mesmo console contam **uma vez** (decisão do Lucas): no máximo uma platina
     de PS4 e uma de PS5 por jogo. As extras aparecem e somam num contador à parte, "Listas
     regionais extras", sem XP.
4. **Edições** (Deluxe, GOTY, Complete) que dividem a mesma lista de troféus são **uma versão só**
   do mesmo jogo, nunca dois jogos.
5. **Juntar os duplicados** que já existem no banco, com conferência humana antes.
6. **Busca por plataforma** (já existe o filtro PC/PlayStation/Xbox/Nintendo/Retro) ganha:
   - **"Só exclusivos"**: o jogo saiu só naquela família (PS4+PS5 continua exclusivo de
     PlayStation; um jogo que depois saiu no PC deixa de ser exclusivo).
   - **"Só com troféus/conquistas"**: liga/desliga; o padrão é mostrar todos.
   - Nintendo e Retro funcionam igual, mesmo para jogos sem troféus (ex.: Zelda).
7. **Recalcular XP e nível** dos dois usuários atuais (o Lucas e o sócio dele) pela regra nova.
   São os únicos usuários; a regra nova vale para eles também.

## Fora do escopo

- Casar troféu a troféu entre plataformas ("este troféu da PSN = esta conquista da Steam"). Foi a
  opção B do protótipo, recusada: nomes e quantidades não batem entre plataformas.
- Avaliações escritas e link para avaliações da Steam (decidido: não fazer). Um "curtir / não
  curtir" por jogo foi citado como "talvez" e é outro projeto.
- Mudar o visual do site. Capas, filtros atuais, a caixa com o disco, a contracapa e as seções de
  baixo da página do jogo ficam como estão (grafite + verde, canto cortado; ver
  `docs/` e a memória de preferências visuais). Só entram os elementos novos descritos aqui.
- Corrigir região manualmente por jogo (pode vir depois, se as bandeiras automáticas não bastarem).

## Anti-objetivos (falhou mesmo que funcione)

- Um usuário perder progresso, troféus ou platinas que tinha.
- Um link antigo de jogo (slug) virar 404 depois de juntar duplicados.
- O ranking premiar quem compra o mesmo jogo em três regiões.
- Os robôs de sincronização (PSN/Steam/Xbox/RA, `lib/sync/*`, GitHub Actions) quebrarem ou
  voltarem ao loop de reler tudo (corrigido em 81e7c96).

## O que o usuário vê (aprovado no protótipo)

Os protótipos estão em `.superpowers/brainstorm/259-1793677874/content/` (ignorado pelo git):
`versoes-jogo.html`, `perfil-jogos.html` e `busca-plataforma.html`. Eles são de organização, não
de visual. O visual segue o site atual.

**Página do jogo — opção A.** A área "seu progresso" vira:
- uma linha por versão (console/loja), com nome do console e família, barra de progresso, selo
  "PLATINA" ou % e, para PSN com várias regiões, as listas regionais como etiquetas
  (`🇺🇸 EUA ✓`, `🇯🇵 Ásia ✓` ou `Lista 1 ✓`), mais o texto "2 listas · conta 1";
- embaixo, abas por versão com a lista de troféus daquela versão; em PSN com várias regiões, cada
  troféu mostra em quais regiões foi obtido.
- O resto da página não muda.

**Perfil — opção B (grade de capas).** Cada jogo aparece **uma vez**, na capinha atual, com selos
por versão: `PS5 ✓²` (o ² indica 2 regiões), `PS4 ✓`, `PC 64%`. O topo do perfil mostra:
"Platinas (contam no XP)", "Listas regionais extras", "Jogos" e "Nível".

**Busca.** Filtros atuais mantidos, mais os botões "Só exclusivos" e "Só com troféus". O rótulo
"PC" vira "PC · Steam" no sentido de "jogos que existem na Steam" (minha decisão; ver abaixo).

## Como funciona (decidido)

### Modelo: lista de troféus como peça central

Hoje o banco não tem o conceito de "lista". Ele precisa existir:

- **Lista de troféus** = `(platform, externalId)` da plataforma: npCommunicationId na PSN, titleId
  no Xbox, appid na Steam, id do jogo no RA. Isso já é a chave de `GamePlatformLink`. A lista ganha
  console (PSN: `trophyTitlePlatform`, já lido em `lib/integrations/psn/client.ts`) e, quando
  dedutível, região.
- **`Achievement`** passa a pertencer a uma lista, não só a `(gameId, platform)`. A unicidade vira
  por lista + `apiName`, e os troféus do PS4 e do PS5 deixam de colidir.
- **Progresso do usuário por lista**: `UserGame` hoje é `(userId, gameId, platform)`. O progresso
  passa a ser guardado por lista (PSN com PS4 + PS5 + regiões = várias linhas). O agrupamento por
  jogo é feito na leitura.
- **Versão** (o que a tela mostra) = listas do mesmo jogo no mesmo console/loja. Na PSN, as
  listas regionais do mesmo console formam uma versão só.

A forma exata no Prisma (tabela nova `TrophyList` ou colunas novas em `GamePlatformLink`, como
renomear `UserGame`) fica com quem constrói. Restrição: a migração tem que ser **aditiva primeiro**
(estrutura nova ao lado, preenchida, código lendo dela) e só depois remover o antigo.

### Contagem e XP

- **Platina:** o `sourceKey` deixa de ser `psn:<gameId>` e passa a ser por console, algo como
  `psn:PS4:<gameId>` e `psn:PS5:<gameId>`. A primeira platina de qualquer região daquele console
  paga; as outras não pagam (idempotência do ledger). Xbox, Steam e RA seguem uma por versão.
- **Troféus comuns, minha decisão:** a mesma lógica, uma vez por console. Um troféu pago numa
  lista regional não paga de novo na outra região do mesmo console (as listas regionais costumam
  ser idênticas). PS4 e PS5 pagam cada um.
- **Contadores do perfil:** "Platinas" = platinas que contam. "Listas regionais extras" = platinas
  regionais além da primeira por console.
- **Total de conquistas conta tudo (decisão do Lucas).** O contador de conquistas/troféus do perfil
  (e qualquer "total de conquistas") soma **todo** desbloqueio de **toda** lista, inclusive as
  regionais extras. Só o XP, o nível e o ranking seguem "uma vez por console". Ou seja: dois
  números diferentes, de propósito: "troféus obtidos" (tudo) e o XP (regra anti-stack).
- **Recalcular os dois usuários:** existe `recomputeUser` em `lib/progression/recompute.ts`. O
  ledger é imutável (só `voidedAt`), então a troca de regra precisa ser feita com entradas novas e
  anuladas, não editando, ou com uma rotina de recálculo explícita para a migração. Quem constrói
  escolhe o caminho; o resultado tem que ser o XP que a regra nova daria desde o começo.

### Região das listas PSN

A PSN **não informa a região** de uma lista. Regra (minha decisão):
- nome da lista com caracteres japoneses/chineses/coreanos → "Ásia" (🇯🇵, ou 🇰🇷/🇨🇳 quando
  inequívoco);
- caso contrário, sem bandeira: "Lista 1", "Lista 2", em ordem de criação.
- Não tentar distinguir EUA e Europa automaticamente.

### Juntar duplicados

1. Uma rotina gera um **relatório de candidatos**, sem mudar nada: jogos com nome normalizado igual
   ou alias cruzado, um deles criado por sync de plataforma, e edições ("Deluxe", "GOTY",
   "Complete", "Digital Deluxe"…) do mesmo jogo.
2. O Lucas confere a lista.
3. A junção move tudo do jogo descartado para o que fica: links de plataforma, listas, troféus,
   progresso, mídia, guias, comentários, fotos, artigos etc. (todas as tabelas com `gameId`;
   quem constrói enumera pelo schema). O nome descartado vira alias do que fica.
4. O slug antigo **redireciona** (301) para o novo. Hoje não existe tabela de redirecionamento de
   slug; precisa ser criada.
5. **Antes** de rodar em produção: rodar numa **branch da Neon** (cópia do banco de produção) e
   conferir. A Neon também permite voltar o banco a um minuto anterior.

### Sincronização

`lib/sync/platform-user.ts`, `platform-library.ts`, `platform-games.ts`, `first-import.ts` e o sync
da Steam passam a gravar por lista. A memória de contagens por título (`rememberTitles`, chave
`platform-titles:<accountId>`, de 81e7c96) já é por lista (externalId) e deve continuar
funcionando. O teste "a game with a PS4 and a PS5 trophy list is not read again on every sync"
(`platform-user.test.ts`) tem que continuar passando.

### Busca

- `platformWhere` (`lib/queries/games.ts`) já junta `Game.platforms` (IGDB) e `GamePlatformLink`.
- **Exclusivo de X** = o jogo está na família X e em nenhuma outra família de
  `CATALOG_PLATFORMS` (PC, PLAYSTATION, XBOX, NINTENDO; Retro fica à parte), olhando as mesmas
  duas fontes.
- **Só com troféus** = o jogo tem pelo menos uma lista de troféus com troféus.
- **Minha decisão:** "PC · Steam" = o jogo tem `steamAppId`. Jogo só da Epic ou da GOG continua em
  PC no catálogo, mas não aparece nesse filtro. Rótulo e regra podem mudar se o Lucas preferir.
- **Limitação conhecida:** as plataformas vêm do IGDB. Jogos pequenos com dados incompletos podem
  aparecer como exclusivos por engano. Aceito.

## Restrições

- Next.js 16 em `app/` (`app/AGENTS.md`: ler os docs em `node_modules/next/dist/docs/`), Prisma 7,
  Neon, Vercel Pro. Páginas públicas usam `"use cache"` com `cacheLife` (perfil `feed` etc.):
  atualizar as `cacheTag` afetadas.
- Leitura do banco de produção: o Lucas liberou, mas o classificador de permissões ainda bloqueia.
  É preciso que ele adicione uma regra de permissão antes da etapa de duplicados.
- Outro agente trabalha no mesmo repositório (redesign visual, `app/.impeccable/`): combinar a
  ordem e fazer `git pull` antes de mexer.
- Chaves e segredos nunca são digitados pelo agente.
- Testes com banco usam `gamelog_test`/`gamelog_dev` (o `gamelog` local está desatualizado).

## Ordem sugerida (quem constrói pode ajustar)

1. Modelo de listas (aditivo) + preenchimento a partir dos dados atuais + syncs gravando por lista.
2. Regra de XP nova + recálculo dos dois usuários.
3. Página do jogo (opção A) e perfil (opção B, contadores).
4. Busca: exclusivos e "só com troféus".
5. Relatório de duplicados → conferência do Lucas → junção com redirecionamento (branch da Neon
   antes).
6. Limpeza da estrutura antiga.
7. Listas de troféus PSN/Xbox para todo o catálogo (pendência 16) aproveita o modelo novo; pode
   vir depois.

## O que fica com quem constrói

Forma exata do schema e nomes; como preencher os dados existentes (as linhas colapsadas de hoje
podem precisar de um re-sync das contas PSN, já que os troféus PS4/PS5 se sobrescreveram);
mecanismo de recálculo do ledger; heurística exata de candidatos a duplicado; detalhes do
componente das abas; cacheTags.

## Respostas à revisão (builder check)

- **Listas regionais novas se agrupam sozinhas.** O sync tem que reconhecer uma lista regional
  nova (inclusive com nome em japonês/chinês/coreano) como região do jogo que já existe, sem
  esperar relatório. Mecanismo fica com quem constrói (ex.: concept/title ids da PSN na lista de
  jogos jogados, ou o mesmo jogo-base nas listas do usuário). O relatório de duplicados é para os
  casos que escaparem, e é reutilizável (rodar de novo quando quiser), não uma vez só.
- **"Só com troféus"** com uma plataforma escolhida = o jogo tem troféus **naquela** plataforma.
  Como o catálogo não tem as listas PSN/Xbox de todos os jogos, a regra usa a geração do console:
  todo jogo de PS3, PS4, PS5, Vita e Xbox 360 em diante tem troféus/conquistas por regra da
  plataforma (dados de lançamento do IGDB). PC = `achievementCount > 0` na Steam. Retro = tem set
  no RA. Nintendo = nunca. Sem plataforma escolhida = qualquer uma dessas. Assim o filtro não
  depende da pendência 16.
- **PS3 e Xbox 360 aparecem (pedido do Lucas)**, na busca, no filtro "Só com troféus", no perfil e
  na página do jogo, como qualquer outra versão. Detalhes:
  - Troféus no PS3 só passaram a ser obrigatórios em 2008; jogos de PS3 lançados antes de 2008
    só contam como "com troféus" se tiverem lista conhecida (de algum usuário ou do catálogo).
    Todo jogo de Xbox 360 tem conquistas.
  - **Verificar o robô do Xbox com jogos de 360.** `lib/integrations/xbox/client.ts` lê
    `/achievements/player/{xuid}` e `/achievements/player/{xuid}/{titleId}` (OpenXBL). Não foi
    confirmado se esses endpoints trazem as conquistas de títulos de 360 (a Xbox Live usa uma API
    antiga para o 360, e o OpenXBL tem rota própria para isso). Testar com um jogo de 360 de uma
    conta real e, se vier vazio, usar a rota de 360. A PSN já lê listas de PS3 (serviço `trophy`).
- **Lugar do progresso na página do jogo.** As linhas por versão substituem o seletor atual
  (`PlatformProgressSwitch` dentro de `BookletProgress`), no mesmo lugar dentro da caixa. A caixa
  não muda de visual. O disco continua mostrando a melhor versão, como hoje. As abas com a lista
  completa de troféus da versão entram logo abaixo da área de progresso. Visitante sem login ou que
  não tem o jogo: vê as versões conhecidas do jogo (console e número de troféus) e a lista de cada
  uma, sem marcação. Numa versão com várias regiões, a lista mostrada é a primeira região. O que é
  do usuário fica na ilha por usuário (Suspense), e o resto continua no cache público.
- **Horas jogadas** continuam somadas por jogo e plataforma (`psn:<gameId>:<horas>`), sem divisão
  por console. Hora jogada é tempo real, não um desafio repetido.
- **Console de uma lista que cobre vários** (`"PS3,PSVITA"`, cross-buy): é uma versão só, com o
  rótulo "PS3 · Vita", e paga uma platina. Se o mesmo jogo tiver outra lista própria de Vita, essa
  é outra versão e conta à parte. **Xbox:** cada titleId com lista própria é uma versão (360,
  One/Series e Windows são listas diferentes, como PS4 e PS5). One e Series que dividem a lista são
  uma versão só.
- **Remasters e relançamentos com lista própria** (Death Stranding × Director's Cut, The Last of
  Us Remastered × Part I, Spider-Man × Remastered) **ficam como jogos separados** (decisão do
  Lucas), com um link "Outras edições" entre as páginas. No perfil contam como jogos separados,
  igual ao que a Steam, a PSN e o Xbox mostram. Só se juntam as edições que dividem a mesma lista
  (Deluxe, GOTY…). O relatório de duplicados marca os relançamentos como "não junta, liga como
  outra edição". Como saber que dois jogos são edições um do outro: fica com quem constrói (ex.:
  `version_parent`/`remasters` do IGDB, ou o Lucas liga pelo relatório).
- **Jogos com o mesmo `steamAppId` duplicado:** a junção nunca combina dois jogos que tenham, os
  dois, `steamAppId`. Esses casos aparecem no relatório marcados como "não junta". A Steam continua
  com um appid por jogo.

## Decisões minhas (para o Lucas conferir)

- Troféus comuns de listas regionais também contam uma vez por console, não só a platina.
- Região: só "Ásia" é deduzida (pelo alfabeto do nome); o resto vira "Lista N".
- "PC · Steam" = jogos com appid da Steam.
- "Exclusivo" = só uma família hoje (PS4+PS5 conta como exclusivo de PlayStation).
- Retro não entra no cálculo de exclusividade.

## Mudanças decididas pelo Lucas depois do design (06/11)

Estas decisões vieram depois do design e valem sobre o que está escrito acima onde houver
diferença.

- **Toda lista regional da PSN paga XP (R1).** Substitui "listas regionais contam uma vez". Cada
  lista de um console paga os seus troféus e a sua platina, como qualquer outra lista, e o perfil
  mostra o total real de platinas (diguzz: 520). A decisão de "Decisões minhas" de contar os
  troféus comuns uma vez por console também deixa de valer: cada lista conta.
- **"Tralked" e "Platinas" são contadores diferentes (R2).**
  - **Tralked** (o contador principal do perfil) conta os jogos e as listas terminados em 100% em
    qualquer plataforma. Uma lista da PSN com platina só vira Tralked quando chega a 100%, com as
    DLCs. No Xbox, a lista também conta quando o jogador chega aos 1000G do jogo base, mesmo sem as
    DLCs. Um jogo terminado em duas plataformas conta duas vezes.
  - **Platinas** são só os troféus de platina da PSN, uma por lista, qualquer que seja o % da lista.
    Um 100% na Steam, no Xbox ou no RetroAchievements nunca é uma "platina": é Tralked.
  - A página do jogo usa as mesmas palavras do perfil ("N platinas · N Tralked"), e uma versão sem
    troféu de platina mostra o selo "Tralked" quando chega a 100%.
- **Regra automática de duplicados.** O relatório só pergunta ao Lucas o que a regra não decide:
  1. mesma lista de troféus nos dois jogos → junta;
  2. mesmo jogo em plataformas diferentes, com o mesmo nome e sem duas listas no mesmo console →
     junta;
  3. os dois têm lista própria no mesmo console (remaster, Director's Cut, Steam Enhanced/Legacy) →
     ficam separados e ligados em "Outras edições";
  4. dois appids diferentes da Steam → nunca junta.

  Um jogo juntado não volta: a página antiga redireciona para a que ficou, e o id do IGDB do jogo
  que saiu fica guardado como apelido (`GameIgdbAlias`), para as importações do IGDB acharem o jogo
  que ficou em vez de criar o antigo de novo. Nenhum jogo novo pega o endereço de um
  redirecionamento.
- **Conquistas da Steam sem data contam e pagam XP (opção A).** A Steam devolve algumas conquistas
  antigas como feitas, mas sem data (unlocktime 0, como a maior parte das do Team Fortress 2 de
  antes de 2009). Elas entram no total de conquistas e pagam XP, com "data desconhecida". Ficam fora
  do que depende de data: linha do tempo, sequência e dias ativos, missões e "recentes".
