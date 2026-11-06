# Tralked: passagem de bastão (2026-11-02)

Resumo da sessão de 31/10 a 02/11 com o Lucas (dono da Ludai Labs): o que está no ar e o que ficou pendente. Branch de trabalho: `feat/plano-2-tralked`. A `main` é mantida igual a ela (fast-forward + push), e cada push na `main` publica o site na Vercel.

## Atualização de 06/11: unificação de troféus concluída

- **No ar na `main`:** fase a `b5aba98`; b `595d915`; hotfix antifraude `52b675f`; c `079d755`; R1 `7cb43ac`; R2 `758e985`; e `d53bc0b`; d `0e928c2` + `9d5c142`. A rodada final, na branch `fix/final-wave`, ainda não foi publicada: espera o Lucas.
- **Números do diguzz agora:** PSN 18.981 = Sony e 520 platinas; Steam 4.020 = API da Steam; Xbox 2.160 = OpenXBL; Tralked 495+; nível 200.
- **Workflows novos:** `psn-catalog` (7 fatias por dia; o casamento liga pela variável `vars.PSN_CATALOG_MATCH`) e `igdb-consoles` (manual). Em operações de produção, pausar os agendados: cron, platform-import, steam-details, steam-players, catalog-enrich, retro-catalog, psn-catalog.
- **Backups** em `C:\Users\luck_\tralked-backups\`, arquivos `neon-before-*` de 05/11 e 06/11: phase-b, fraud-hotfix, phase-c, regional-xp, tralked-counter, phase-e, phase-d, d6-cleanup.

**Pendências novas (continuam a numeração):**
- **35. Publicar a rodada final** (`fix/final-wave`): apelidos de IGDB dos 43 jogos juntados, slug de redirecionamento protegido, psn-repair, página do jogo pela regra Tralked/Platinas e disparo da varredura PSN. O script está pronto em `C:\Users\luck_\AppData\Local\Temp\claude\88d8229872c22355\c18fd4c8-fe0b-4227-82c0-406ee0914047\scratchpad\release-final-wave.sh` e precisa da permissão do Lucas.
- **36. Gamificação:** proposta de 5 ajustes (régua única de raridade, "Platina" só PSN, moeda de cada plataforma visível com o G do Xbox e os pontos do RA, nomes únicos, progresso visível). O brainstorm está pausado; nada foi aprovado.
- **37. Duplicados vazios:** 11.104 pares sem conteúdo (incluindo Ghost of Yōtei e Mass Effect 2) não foram juntados.
- **38. Antifraude:** falta regra para "1 conquista sem data + o resto rápido" (Steam Achievement Manager).
- **39. Filtro "PC · Steam":** agora só mostra jogos com appid da Steam (jogos só da Epic saem). Avisar o Lucas.
- **40. Varredura da PSN:** acompanhar a primeira volta (~16 dias) e o log "do not match the list". Leituras ao abrir página + varredura juntas ficam acima do ritmo da psnawp (0,43/s); considerar pausar as leituras de página durante a fatia.
- **41. Selo de 1000G na biblioteca** ignora troféu suspeito (pequeno).
- **42. API pública** procura jogo só pelo `igdbId` principal, não pelos apelidos.
- **43. Limpeza técnica:** caminho `legacyCompletedAt` morto em produção; teste lento/instável em `platform-user.test.ts` (~l. 937); `apiName` de troféu oculto exposto.
- **44. Steam:** 13 conquistas que o Exophase mostra e a API da Steam não tem; Portal (2) não entrou no `steam:dateless`.

## Atualização da tarde de 02/11: queda do site e plano de segurança

**O que aconteceu:** o site ficou fora do ar (402 `DEPLOYMENT_DISABLED`) porque o plano Hobby estourou as 4 h de CPU do mês. A culpa não foi da sincronização. Foram robôs que coletam dados para treinar IA:
- em 01–02/11, o GPTBot (OpenAI) fez 250 mil requisições, cerca de 70% do total, e o ClaudeBot mais 23 mil;
- eles passaram por `/jogos/[slug]` (88 mil), `/forum/[categoria]` (81 mil), `/galeria` (37 mil), `/jogos` e `/entrar`;
- isso somou cerca de 8 h de CPU em dois dias;
- só leram páginas públicas (GET): nenhum login, nenhum formulário.

Também chegaram cerca de 30 tentativas de scanners (`/.env`, `/.git/config`, `/wp-login.php`). Todas responderam 404 ou 403, e nada vazou. Uma varredura do histórico do repositório público não achou nenhuma chave.

O Lucas assinou o **Pro** e o site voltou. No commit `9022f8f`, os robôs de treino de IA (lista em `app/src/lib/seo/ai-crawlers.ts`) passaram a receber 403 no `proxy.ts` e ficaram proibidos no robots.txt. `/entrar` e `/cadastrar` saíram dos buscadores. Google, Bing e as buscas de IA continuam liberados.

**Pendências de segurança (plano):**
- **26. Firewall da Vercel.** O Lucas abre a aba Firewall do projeto uma vez, porque a API responde 404 "Seawall Config not found" enquanto não existe configuração. Depois disso, ativar:
  - a regra gerenciada "AI Bots" (deny);
  - "Bot Protection" (challenge);
  - limite por IP nas páginas (ex.: 120/min);
  - bloqueio dos caminhos de scanner.
- **27. Teto de gasto (Lucas):** Settings → Billing → Spend Management, ~US$ 30.
- **28. Cache das páginas públicas:** cada visita monta a página de novo (galeria ~360 ms de CPU, jogo ~40 ms). Servir as páginas prontas faz qualquer pico custar quase nada.
- **29. ✅ Feito (55142ea). Cabeçalhos de segurança:** hoje só existe o HSTS. Faltam `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e, depois, CSP.
- **30. Repositório privado? (decisão do Lucas):** esconde o código e o domínio, mas os minutos do Actions passam a ser limitados.
- **31. ✅ Resolvido (81e7c96). Loop na importação da PSN:** uma conta ficou 5 h 30 em 64 fatias de "imported a part, continues" sem terminar, mantendo o Neon acordado. A causa eram jogos com lista de troféus de PS4 e de PS5, que dividem uma linha `UserGame`: o contador batia com uma lista só, e a outra era relida em toda sincronização. Agora a contagem de cada lista fica guardada em `SyncCursor platform-titles:<conta>`, e a linha soma o que foi desbloqueado nas duas. Rodada de verificação: 891 títulos, terminou em 2 fatias (~10 min).
- **33. `catalog-enrich` (4065e08):** o endereço `appreviews` da Steam passou a redirecionar para a home, então 100% das avaliações falhavam. Agora as avaliações vêm do `IStoreBrowseService/GetItems` (`summary_filtered`), 100 jogos por pedido. A parte de mídia já funcionava (1.500 jogos na rodada de 02/11). Rodada de teste de 12 min em 03/11: 10.176 avaliações lidas (fila zerada, 5 sem dado) e mídia de 875 jogos.
- **34. Workers do GitHub disparados pela Vercel (7485f7c):** os agendamentos do GitHub falhavam ou atrasavam até 2 h. O Vercel Cron `/api/cron/workers` (de hora em hora, aos :28) dispara os workers previstos para aquela hora. **Falta o Lucas** criar o token `GITHUB_DISPATCH_TOKEN` na Vercel: fine-grained, só o repositório `tralked`, permissão Actions de leitura e escrita. Depois do primeiro disparo que funcionar: `gh variable set DISPATCH_FROM_VERCEL --body true`, o que desliga os agendamentos próprios do GitHub (sem isso eles rodam em dobro).
- **32. ✅ Resolvido (55142ea): as rotas `/api/cron` passaram para o Vercel Cron (`app/vercel.json`), e o `cron.yml` ficou só manual. Agendamentos do GitHub parados** desde 09:26 UTC de 02/11, sem incidente no GitHub. O disparo manual funciona.

**Ajustes visuais pedidos pelo Lucas depois do Impeccable:**
- **Faixa de plataforma no topo do estojo** (`CaseShelf`, em `/jogos` e `/lancamentos`):
  - um bloco colorido por família (PC · Steam, PlayStation, Xbox, Nintendo, Retrô);
  - os nomes encurtam conforme a quantidade de blocos (`bandPlatforms` em `lib/releases/platforms.ts`).
- **Quadros largos** (como o "Quase lá"):
  - o `CoverArt` passa a usar a arte larga primeiro: cápsula 616×353 da Steam, depois o hero, depois o header;
  - a capa vertical em pé no palco virou só o último recurso.
- **Capa vertical dos jogos novos:**
  - a Steam guarda a `library_capsule` e o `library_hero` dos apps novos numa pasta com hash, e o caminho simples dá 404;
  - a sincronização agora lê o `IStoreBrowseService/GetItems`, que é público e responde até 100 apps por pedido;
  - `lib/sync/library-art.ts` repara o que já está gravado: o job `releases` (300 jogos por rodada) e o worker de detalhes (3.000) rodam o reparo;
  - à mão: `pnpm steam:library-art`.

**Imagem certa para cada formato:**
- **Escolhedor:** `lib/art/frame.ts`, `pickArt`, renderizado por `components/art/FramedArt.tsx`. Cada imagem é conhecida pelo tipo (capa, cápsula, header, hero, artwork, print, logo) e pela proporção.
- **Card de jogo (modo `identity`):**
  - arte com letreiro só quando o formato é quase igual ao do quadro, e mesmo assim inteira, com a própria imagem desfocada atrás;
  - senão, o hero limpo com o logo transparente por cima.
- **Notícia (modo `scene`):** arte limpa primeiro, sem logo por baixo da manchete.
- **Ligado em:** "Quase lá", desejos, índice de notícias, manchete da home, abas, wire, topo 21:9 da matéria, próxima matéria e mais vistas.
- **Dados:**
  - SteamGridDB por formato (grid 600×900, grid largo 920×430, heroes, logos, com tamanho);
  - cápsula 616×353 da Steam como mídia `capsule`;
  - a sync de mídia não apaga mais as linhas da Steam.
- **Reparo em produção:** 2.914 cápsulas gravadas.

**Decisões do Lucas (02/11 à noite) e o que já foi feito:**
- **XP de comunidade:**
  - comentar, responder e responder no fórum dão 5 XP (`comment_posted` / `forum_post`), até 10 por dia;
  - a curtida recebida caiu para 5 XP;
  - "Remover" na moderação estorna o XP.
- **Botão do disco:** agora "Ver o disco Tralked!".
- **Repositório:** fica público por enquanto. Volta à pauta depois que as sincronizações estiverem prontas.
- **Capa vertical num quadro largo:** volta a preencher o quadro, recortada pela parte de cima.
- **Miniaturas dos lançamentos:** usam a cápsula 616×353.
- **Célula do calendário:** a capa aparece sem o recorte central do CDN.
- **Rotina de mídia:** prioriza os jogos que o site mostra e que ainda não têm arte larga.

Para medir de novo: as consultas de observabilidade da Vercel funcionam no Pro (`function_cpu_time_ms` por `route`; `request.count` por `bot_name` e `request_path`).

## Atualização da manhã de 02/11 (sessão 2c1166af)

Feitos e no ar os itens 01 a 19 da lista de pendências, além de uma rodada de melhorias de experiência guiada pela crítica Impeccable. O acompanhamento detalhado está em `.superpowers/sdd/2026-11-02-pendencias-01-19/progress.md`.

**Itens 01 a 19:**
- **Robô** (`ROBO NOTICIAS/`):
  - `pnpm publica --fora-do-horario` (e `--ignorar-limite`);
  - um log por tarefa, com a coleta às :20 e :50;
  - imagens e trailer do IGDB pela rota `GET /api/v1/games/{slug}/media`;
  - matérias de vídeo a partir de 16 canais oficiais do YouTube.
- **Workers:**
  - horários em minutos ímpares, sem sobreposição;
  - erro completo no log (`describeError`);
  - reconexão ao banco (`db-retry`);
  - janelas menores. A tabela de CU-h fica no `app/README.md`, seção "Workers no GitHub Actions".
- **Moderação:**
  - "Editar", despublicar, mudar categoria e destaque direto na matéria;
  - remover qualquer comentário, fixar comentário e trancar discussão;
  - silenciar e banir com prazo;
  - "Denunciar" em tudo, com fila e histórico em `/admin/moderacao`;
  - novo papel "moderator".
- **Respostas** em comentários (um nível), **curtidas e descurtidas com XP** (tabela `Reaction`) e **contador de visualizações** (`ArticleViewDaily`, "Mais visualizadas").
- **"Verificar agora"** para Steam, PSN, Xbox e RA (código `TRK-XXXXXX` no perfil da plataforma) e **troféus por plataforma** na página do jogo e no perfil.
- **Jogadores na Steam** (`steam-players.yml`, top 2.000, a cada 2 h) e **catálogo do RetroAchievements** (`retro-catalog.yml`, domingos):
  - a primeira rodada leu 12.233 jogos;
  - 3.799 foram ligados ao catálogo e 4.250 viraram stubs.
- **Setup do jogador:** `/conta/setup`, com selos de 65 plataformas e a ficha do PC.

**Migrations aplicadas no Neon** (backup antes em `C:\Users\luck_\tralked-backups\neon-before-pendencias-20261102-0618.dump`):
- `20261104100000_moderation`
- `20261104110000_engagement`
- `20261104120000_platform_verify`
- `20261104130000_catalog_players_ra`
- `20261104140000_player_setup`
- `20261105090000_reward_loop`

**Crítica Impeccable** (`app/.impeccable/critique/2026-11-02T09-43-14Z__src-app.md`, nota 23/40) e as melhorias aplicadas:
- **Números verdadeiros:** tiers por plataforma, uma única fonte para platinas e lendárias, e o tempo para 100% com a fonte rotulada.
- **Capas:** cadeia de reserva sem "[ capa: … ]".
- **Jogos sem conquistas:** estado honesto.
- **Página do jogo:** card "Comunidade de <jogo>"; o guia ganhou a cara do encarte "Manual".
- **Loop de recompensa:**
  - toasts "+XP" globais, subida de nível e dica "+5 XP" antes de agir;
  - XP abreviado e nível em %;
  - notificações de nível, missão, sequência em risco, "te passou" e curtidas agrupadas;
  - ranking "Esta semana" e "Novatos";
  - página `/como-funciona`.
- **Navegação:**
  - menus Jogos e Comunidade;
  - cabeçalho de uma linha no celular;
  - filtros de `/jogos` num painel inferior;
  - cadastro e login com personagem de exemplo;
  - vitrine `/personagem`;
  - passo a passo depois do cadastro;
  - fim de matéria com "Próxima matéria" e "Mais visualizadas".
- **Home:**
  - faixa "Sua partida" para quem está logado;
  - lançamentos e calendário por popularidade, com "Destaques da semana";
  - "Em circulação" corrigido;
  - vitrine "Mais raras".
- **Desempenho:**
  - `/galeria` caiu de 1,58 MB para 93 KB de HTML;
  - imagens no tamanho exibido, com ~70% menos bytes;
  - CLS zerado nas páginas medidas.
- **Banco:** as 3 dicas falsas de seed do guia de Hollow Knight foram apagadas no Neon.

**Segunda crítica** (`app/.impeccable/critique/2026-11-02T11-38-46Z__src-app.md`): a nota subiu de 23 para 28/40. Depois dela veio uma rodada final de polimento, já no ar em `c685540`.

- **Home:**
  - corrigido o erro de hidratação React #418 (a newsletter do rodapé dependia de `usePathname`);
  - herói só com arte larga;
  - "Mais lidas" numa faixa própria.
- **"Em circulação":** sem cards sem imagem, com selo "EN" e nomes de fonte limpos.
- **Calendário:** organizado por semana.
- **Matéria:** card de jogo de verdade no lugar do anterior.
- **Guia:**
  - mobile corrigido;
  - revisões e "Autoria humana" só aparecem quando são reais.
- **Conquistas:** contagem única, com a platina sintética separada.
- **Capas:** uma cadeia só, com tratamento de estojo e sem desfoque.
- **XP:** um formato só (`lib/xp-format`), e a cópia sobre a economia ficou coerente.
- **Ranking:**
  - o nome passou a ser "Ranking", com setas ▲▼;
  - abre em "Esta semana" enquanto o quadro de Nível tiver menos de 3 jogadores.
- **Perfil:** cabeçalho igual em todas as abas.
- **Galeria e fórum vazios:** viram um mosaico de imagens oficiais.
- **Mídia:** migration `20261106120000_game_media_title`, que dá título aos vídeos.

Opcional: `pnpm sgdb:png-thumbs` marca as artes do SteamGridDB que só têm miniatura PNG, o que evita 1 request falho por página. É lento, faz um HEAD por arte. Rodar contra o Neon só num horário em que o banco já esteja acordado.

**Atenção ao Neon:** a cota estourou na madrugada de 02/11, entre 02:25 e 04:54 UTC, e as páginas deram erro nesse intervalo. Os workers ficaram bem mais leves depois disso, mas vale olhar o uso em Usage no console do Neon.

**O que depende do Lucas:**
1. Rodar `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\projetos\Nova pasta\ROBO NOTICIAS\scripts\instalar-tarefas.ps1"` para instalar ou atualizar o agendador do robô, com os logs separados.
2. Passar o link de convite do Discord, que vai em `NEXT_PUBLIC_DISCORD_INVITE_URL`. Até lá, o card mostra "Em breve".
3. Decidir se comentar deve dar XP (hoje não dá, para evitar spam) e se os valores de XP das reações estão bons:
   - quem reage ganha 5 XP;
   - o autor ganha 10 XP por curtida;
   - limites diários de 20 reações dadas e 50 curtidas recebidas.
4. Opcional: limitar o autoscaling do Neon a 0,25–0,5 CU no console.
5. Chaves de Resend e Google, que seguem pendentes.

**Pendências antigas:** resolvidas pela unificação de troféus (06/11) os itens 20, 22 e 23 da lista e a antiga pendência 4: Wolverine sem troféus (as listas PS4/PS5 se colapsavam, corrigido na fase a); troféus de console sem dono e página do jogo sem troféus (fase e: índice do catálogo da PSN e troféus carregados ao abrir a página); juntar jogos duplicados (fase d: 107 junções e 470 vínculos de edição em 06/11). Continuam abertas: o item 21 (triagem por amostragem do robô e revisões), o 24 (F9 Social) e o 25 (Emulador).

## Como o Tralked roda hoje

| Peça | Onde | Observações |
|---|---|---|
| Site | Vercel, projeto `tralked` (time "Lucas Souza's projects", plano Hobby) | rootDirectory `app`, Node 24, funções em **gru1** (São Paulo, junto do banco). Limites do Hobby: 4 h de CPU ativa e 360 GB-h de memória por mês; estourar pausa o site por 30 dias, então nunca rode jobs longos em funções da Vercel. |
| Banco | Neon `tralked-db` (gru1, plano grátis) | **1 GB** de armazenamento e 100 CU-h/mês. URLs no `.env.local` da raiz (gitignored). Migration = `prisma migrate deploy` com `DATABASE_URL_UNPOOLED`, com backup antes. |
| Fotos | Vercel Blob `tralked-fotos` | |
| Rotinas | GitHub Actions `.github/workflows/cron.yml` | Chama `https://tralked.com/api/cron/<job>` com o segredo `CRON_SECRET`. Disparo manual: `gh workflow run cron.yml -f jobs="platforms users"`. |
| Detalhes da Steam | GitHub Actions `.github/workflows/steam-details.yml` (a cada 6 h, até 0,6 h por rodada desde 02/11; horários de todos os workers e cota do Neon em `app/README.md`, "Workers no GitHub Actions") | Script `app/scripts/steam-details-worker.ts` (`pnpm steam:details`). Segredos: DATABASE_URL, STEAM_API_KEY, SGDB_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET. |
| Repositório | https://github.com/mrdeadluck/tralked | **Público**, para ter minutos ilimitados no Actions. |
| Chaves na Vercel | STEAM, IGDB (Twitch), SGDB, RA_USERNAME/RA_API_KEY, PSN_NPSSO, XBOX_OPENXBL_KEY, BLOB, SESSION/CRON | O `PSN_NPSSO` vence em ~2 meses. Para trocar uma chave, o Lucas preenche `C:\projetos\Nova pasta\.env.chaves` (gitignored) e roda o script `subir-chaves.sh` do scratchpad, que precisa ser recriado num agente novo. Envia para a Vercel (e para os segredos do GitHub, quando é o caso) e apaga o arquivo. Nunca digite chaves por ele. |
| Robô de notícias | `ROBO NOTICIAS/` no PC do Lucas (SQLite em `data/`) | Chave do site em `ROBO NOTICIAS/.env`. O **Agendador do Windows ainda não foi instalado**: o Claude Code bloqueia, e o Lucas precisa rodar `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\projetos\Nova pasta\ROBO NOTICIAS\scripts\instalar-tarefas.ps1"`. Até lá, só roda com um loop aberto numa sessão. |

## O que foi aplicado nesta sessão

### Hospedagem e catálogo
- **Migração para Vercel + Neon:** DNS no Cloudflare, rotinas no GitHub Actions e repositório público. Funções movidas para gru1.
- **Worker de detalhes da Steam no Actions:**
  - roda 8 jogos em paralelo e reserva uma trava (lease) para o cron não processar os mesmos jogos;
  - só preenche jogos **pedidos, possuídos, desejados ou populares** (top SteamSpy). A cauda longa fica só com nome e capa, e é preenchida quando alguém abre a página, por causa do limite de 1 GB do banco;
  - já preencheu ~2.900 jogos.
- **IGDB:**
  - lançamentos de console agora têm **dia exato**: o `date_format` vale mais que o `category`, que foi descontinuado e deixava tudo como "2026";
  - imagens em **1080p** (`wideArt` em `app/src/lib/queries/company-art.ts`);
  - o job de mídia gasta metade de cada rodada nos jogos **mais populares**.
- **Jogos criados ou corrigidos à mão:**
  - GTA VI, Marvel's Wolverine e Ghost of Yōtei, com popularidade alta e aliases;
  - fichas IGDB completas para WoW, League of Legends e Zelda: Ocarina of Time (remake, slug `the-legend-of-zelda-ocarina-of-time-405460`);
  - cada um tem de 12 a 24 imagens oficiais.
- **Steam:** `skip_unvetted_apps=false`, para listar os jogos que a Steam esconde por padrão.

### Sincronização de plataformas
- **Primeira importação grande:** a leitura usa no máximo **60% do tempo** e o resto vai para gravar. Antes nunca gravava nada.
- **PSN:** as horas são lidas mesmo quando os troféus ficam parciais. Erros da Sony agora vêm com o código no log.
- **Xbox:**
  - a busca aceita respostas da OpenXBL embrulhadas em `content`;
  - **horas corrigidas**: o pedido de estatísticas usa o formato sem `groups`, e o código testa formatos alternativos (`STATS_BODIES`) e guarda o que funcionou.
- **Steam:**
  - jogos com **0 minutos** são lidos uma vez, porque jogos antigos têm conquistas mesmo sem horas;
  - **jogos "emprestados"**: a cada sincronização, o Tralked pergunta à Steam por até 80 jogos que **outros jogadores** têm, começando pelos com mais conquistas. Isso pega Compartilhamento Familiar e licenças grátis (foi como entrou o Reflex). A memória fica em `SyncCursor steam-borrowed:<userId>`.
- **Conta do Lucas:** @ renomeado para **MrDead_**.
  - Steam: 3.405 conquistas (o perfil dele mostra 3.406).
  - PSN: 1.668.
  - Xbox: 359, com 372 h.

### Robô de notícias
- **Estilo** (`ROBO NOTICIAS/prompts/estilo.md`):
  - voz Tralked, **título curto** (4 a 9 palavras) e linha fina curta, corpo livre;
  - poucas atribuições ("segundo X"), nada de explicar o óbvio;
  - **nunca escrever sobre falta de informação**; personalidade só no tom;
  - o bloco "Em 3 pontos" saiu da página.
- **Seleção:**
  - notícia antiga é publicada com a **data em que aconteceu**;
  - fonte só conta se tiver **400+ caracteres** de texto;
  - os feeds "em alta" do Reddit entram **só como sinal** de engajamento;
  - a cobertura conta até 8 veículos;
  - cada hora tenta **até 5 histórias** (4 reprovações) antes de desistir.
- **Retroativo:** **110 matérias** publicadas com datas antigas e 90 reprovadas na checagem. Custo de **US$ 42,59**, com teto de US$ 70.
- **Ao vivo:** publica 1 matéria por hora, das 6h às 23h (Brasília), até 15 por dia, com teto de US$ 5 por dia.

### Site (home e notícias)
- **Home:**
  - destaques laterais: as 2 com mais curtidas e comentários da semana e depois as mais recentes;
  - Últimas notícias com **10 itens**;
  - **Lançamentos no topo da lateral direita**, acima do Discord.
- **Imagens das matérias:**
  - matéria de jogo **alterna** entre o banner e as capturas de tela do jogo;
  - matéria sem jogo usa a **arte do jogo mais popular da empresa citada**, preferindo jogos mencionados no texto; a Blizzard é separada da Activision.
- **Busca do cabeçalho:** o Enter busca em `/jogos?q=`.
- **"Em circulação":**
  - remede as posições a cada segundo e se recentraliza sozinho, depois do load, das fontes e de restaurações do botão voltar;
  - na página /noticias aparece em tamanho compacto (zoom .55).

## Pendências, por prioridade

1. **A sincronização tem que funcionar para qualquer usuário, não só para o Lucas.** É o ponto principal levantado por ele.
   - O **diguzz** tem PSN com 707 jogos e Xbox com 81, e a primeira importação dele não tinha terminado (`lastSyncedAt` nulo).
   - **Feito em 01/11 (commit 256dfea):** worker de primeira importação `pnpm platforms:import` no GitHub Actions (`.github/workflows/platform-import.yml`, hoje a cada 2 h às :29 das horas ímpares), sem o limite de 50 s.
     - Pega conexões PSN/Xbox/RA com `lastSyncedAt` nulo e bibliotecas Steam cuja última sincronização acabou o tempo (marcador `SyncCursor steam-backlog:<userId>`).
     - Uma fila por plataforma, com fatias de 5 min por conta, e uma trava com as contas em andamento, que o cron pula.
     - Detalhes no `app/README.md`, seção "Primeiras importações".
   - **Falta:** os segredos `PSN_NPSSO`, `XBOX_OPENXBL_KEY`, `RA_USERNAME` e `RA_API_KEY` no GitHub. Sem eles o worker só faz a Steam (a primeira rodada achou 0 pendências na Steam).
     - O Lucas preenche `C:\projetos\Nova pasta\.env.chaves` (o modelo já está criado) e roda o `subir-chaves.sh`. O script foi recriado no scratchpad da sessão de 01/11. Se tiver sumido, recrie: ele lê KEY=valor, faz `gh secret set` sem mostrar o valor e apaga o arquivo.
     - Depois, disparar com `gh workflow run platform-import.yml -f hours=2` e acompanhar o diguzz.
2. **Reconhecer o mesmo jogo com nomes diferentes** entre PSN, Xbox, Steam e IGDB: apóstrofo curvo (Marvel’s), ō/o (Yōtei), ™, edições.
   - **Feito em 01/11 (commit f6dffb7):**
     - `findStubByName` também compara pelo nome dobrado da busca (`searchName`, índice trigram);
     - um título com edição de loja ("Digital Deluxe Edition", GOTY) cai no jogo base (`withoutEdition`);
     - a busca no IGDB manda apóstrofo reto. Os jogos listados já casavam por `normalizeTitle`.
   - **Falta investigar com o banco de produção** (a leitura foi bloqueada pelo modo automático nesta sessão):
     - o Wolverine do Lucas tem 23,7 h e 0 troféus. Pode ser o nome diferente ou troféus ocultos no perfil;
     - há **dois Ghost of Yōtei** (`ghost-of-yotei` e `ghost-of-yotei-317627`).
3. **Juntar jogos repetidos** de Steam, PSN e Xbox numa página com todas as plataformas.
4. **Página do jogo sem troféus quando ninguém no Tralked tem o jogo** (ex.: Yōtei). A Sony só entrega a lista de troféus a partir da conta de um jogador. Avaliar ler as definições de troféus pelo `npCommunicationId` com a conta de serviço, quando ele for conhecido.
5. **Botão "Verificar agora"** para PSN, Xbox e RetroAchievements. Hoje só aparece "não verificada", embora as conquistas contem normalmente.
6. **Antifraude:** as 1.502 conquistas do Reflex (jogo "fazenda de conquistas") devem estar em `/admin/fraude`. Definir uma política para jogos desse tipo.
7. **Robô:**
   - instalar o Agendador do Windows (o Lucas roda o comando acima);
   - a triagem do retroativo deve usar **amostragem**, em vez de triar as 306 mil notícias descobertas;
   - fazer a revisão da Task 17 (Pautas) e a revisão final, que ficaram pendentes;
   - a taxa de reprovação da checagem é alta (~45% no retroativo).
8. **"Mais visualizadas":** o site não conta visualizações, só curtidas e comentários. Criar um contador.
9. **F9 Social** (worktree `.claude/worktrees/agent-a069f532be0b38ec9`): está incompleto e tem migrations, então não pode ir para a `main` sem revisão e sem rodar `migrate deploy` no Neon.
10. **Emulador** (Plano 3): pausado na Task 1 (worktree `agent-a9f68707b64c01272`).
11. **Chaves que faltam:** Resend (e-mails do site, com DNS no Cloudflare e tracking desligado) e Google OAuth (login). O passo a passo está em `app/README.md`.
12. **Polimento adiado:** a lista está no ledger `.superpowers/sdd/2026-10-31-tralked-plano-4/progress.md`.

## Referências
- Ledgers: `.superpowers/sdd/2026-10-31-tralked-plano-4/progress.md`, `.superpowers/sdd/2026-10-31-tralked-robo-noticias/progress.md`
- README do app (variáveis, Resend, Google, cron): `app/README.md`. README do robô: `ROBO NOTICIAS/README.md`.
- Para consultar o banco de produção, só leitura: `docker exec -e U="$U" gamelog-db psql "$U" -tAc "..."`, com `U` = DATABASE_URL_UNPOOLED do `.env.local` da raiz.
