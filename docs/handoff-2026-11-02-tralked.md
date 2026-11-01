# Tralked: passagem de bastão (2026-11-02)

Resumo da sessão de 31/10 a 02/11 com o Lucas (dono da Ludai Labs): o que está no ar e o que ficou pendente. Branch de trabalho: `feat/plano-2-tralked`. A `main` é mantida igual a ela (fast-forward + push), e cada push na `main` publica o site na Vercel.

## Como o Tralked roda hoje

| Peça | Onde | Observações |
|---|---|---|
| Site | Vercel, projeto `tralked` (time "Lucas Souza's projects", plano Hobby) | rootDirectory `app`, Node 24, funções em **gru1** (São Paulo, junto do banco). Limites do Hobby: 4 h de CPU ativa e 360 GB-h de memória por mês; estourar pausa o site por 30 dias, então nunca rode jobs longos em funções da Vercel. |
| Banco | Neon `tralked-db` (gru1, plano grátis) | **1 GB** de armazenamento e 100 CU-h/mês. URLs no `.env.local` da raiz (gitignored). Migration = `prisma migrate deploy` com `DATABASE_URL_UNPOOLED`, com backup antes. |
| Fotos | Vercel Blob `tralked-fotos` | |
| Rotinas | GitHub Actions `.github/workflows/cron.yml` | Chama `https://tralked.com/api/cron/<job>` com o segredo `CRON_SECRET`. Disparo manual: `gh workflow run cron.yml -f jobs="platforms users"`. |
| Detalhes da Steam | GitHub Actions `.github/workflows/steam-details.yml` (a cada 6 h, até 5,5 h por rodada) | Script `app/scripts/steam-details-worker.ts` (`pnpm steam:details`). Segredos: DATABASE_URL, STEAM_API_KEY, SGDB_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET. |
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
   - O **diguzz** tem PSN com 707 jogos e Xbox com 81, e a **primeira importação ainda não terminou** (`lastSyncedAt` nulo), porque bibliotecas grandes levam muitas rodadas de 50 s, com 5 contas por rodada.
   - Proposta: um **worker de primeira importação** no GitHub Actions, como o de detalhes da Steam, que importe contas novas ou incompletas sem o limite de 50 s, e deixar o cron só para atualizações.
2. **Reconhecer o mesmo jogo com nomes diferentes** entre PSN, Xbox, Steam e IGDB: apóstrofo curvo (Marvel’s), ō/o (Yōtei), ™, edições.
   - Exemplo: o Wolverine do Lucas tem 23,7 h e 0 troféus. Pode ser o nome diferente ou troféus ocultos no perfil.
   - Exemplo: há **dois Ghost of Yōtei** (`ghost-of-yotei` e `ghost-of-yotei-317627`).
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
