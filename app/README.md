# Tralked

Tralked é uma plataforma de notícias, guias e progressão para quem joga: catálogo de jogos, guias 100% votados pela comunidade, conquistas e raridade vindas da Steam, ranking de highscores por habilidade, missões diárias e um modo família.
O app lê a biblioteca Steam do jogador, calcula XP, vocação e streak, e mostra tudo isso em um perfil público.

## Requisitos

- Node.js 24
- pnpm 10 (`corepack enable` já resolve)
- Docker (para o Postgres local)

## Como rodar

```bash
pnpm install
cp .env.example .env     # preencha SESSION_SECRET (>= 32 caracteres) se quiser; em dev há um valor padrão
pnpm db:up               # sobe o Postgres `gamelog-db` em localhost:5433
pnpm db:migrate          # aplica as migrations do Prisma
pnpm db:seed             # catálogo de exemplo: jogos, guias, notícias e usuários
pnpm dev                 # http://localhost:3000
```

### Entrar em desenvolvimento

A conta é do próprio Tralked: e-mail + senha em `/entrar` (criar conta em `/cadastrar`). O seed dá ao admin `lucas` um e-mail e uma senha **só de desenvolvimento**, definidos em `prisma/seed-data/users.ts` (`LUCAS_DEV_LOGIN`); os outros usuários do seed não têm credenciais. Nunca use essas credenciais fora de um banco local.

Atalho: `http://localhost:3000/api/auth/demo` cria uma sessão como `lucas` e redireciona para `/jogador/lucas`. A rota só existe fora de produção (`NODE_ENV !== "production"`) e responde 404 quando `STEAM_API_KEY` está configurada.

## Contas e papéis

- **Login**: conta do Tralked, com **e-mail + senha** (`/entrar`, `/cadastrar`; sessão no cookie `gl_session`). A senha é guardada só como hash scrypt (`src/lib/auth/password.ts`); o login responde "E-mail ou senha incorretos" igual para e-mail desconhecido e senha errada, e limita tentativas por IP e por e-mail (em memória, por instância). Google é opcional (com `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`): botões em `/entrar` e `/cadastrar` (cria a conta na hora, sem senha) e como conexão; se o e-mail do Google já é o login de outra conta, o Tralked não junta as duas e manda entrar com a senha e conectar o Google em Conexões. **Não existe mais login pela Steam**: a Steam é uma conexão. O Tralked nunca pede senha nem token de outros serviços (Steam, PSN, Xbox, Google); a única senha é a do próprio Tralked.
- **Esqueci a senha** (`/esqueci-senha` → `/redefinir-senha?token=`): a resposta é sempre a mesma; o link vale 1 h, funciona uma vez e o banco guarda só o hash do token. O link vai **por e-mail** (Resend, com `RESEND_API_KEY`). Sem a chave, **fora de produção o e-mail sai no console do servidor** (`[e-mail] password-reset para … : <link>`) e, com `DEV_MAIL_LOG_FILE` definido (os e2e definem), também nesse arquivo; em produção sem a chave a página e o formulário dizem que o envio de e-mails está desativado e nenhum link é criado (use `pnpm user:invite`). E-mail e senha se trocam em `/conta`.
- **E-mail confirmado** (`User.emailVerifiedAt`): nunca bloqueia nada, só dá o selo "E-mail confirmado" em `/conta`. Ao criar a conta com e-mail e senha chega um e-mail de **boas-vindas** com o botão "Confirmar e-mail"; quem entra pelo Google já chega confirmado (o Google verificou o e-mail) e recebe as boas-vindas sem o botão. O link (`/confirmar-email?token=<id>.<validade>.<HMAC>`, assinado com `SESSION_SECRET` sobre a conta e o e-mail) vale 7 dias e deixa de valer quando o e-mail da conta muda; abrir o link não confirma nada (scanners de e-mail abrem links): o botão da página faz o POST, e a página de resultado só diz "E-mail confirmado" logo depois dele (resultado assinado, vale 5 min). Trocar o e-mail em `/conta` volta para "não confirmado" e envia um link novo; "Reenviar e-mail de confirmação" fica em `/conta`. Os e-mails com link de confirmação (boas-vindas, troca de e-mail, reenviar) respeitam dois limites, em memória: 3 por hora por conta e 3 por dia por endereço; acima deles o e-mail é salvo, mas nada é enviado (alternar entre dois endereços não manda e-mail sem fim para estranhos nem gasta a cota diária da Resend, que faria faltar a redefinição de senha). E-mails para um endereço ainda não confirmado não levam o nome de exibição (texto livre, poderia virar phishing): a saudação é neutra. Conectar o Google com o mesmo e-mail (verificado) também confirma. Contas que já existiam antes desta versão, inclusive as só-Google, começam como "não confirmado" (não há migração de dados); confirmam pelo "Reenviar e-mail de confirmação" em `/conta`.
- **Contas vinculadas** (`/conta/conexoes`): Steam, PSN, Xbox e RetroAchievements pelo modelo Exophase. Um formulário "Serviços" tem um campo por plataforma (Steam: link do perfil, nome personalizado ou SteamID64; PSN: ID online; Xbox: gamertag; RA: usuário) e um "Salvar alterações" que aplica todos os campos de uma vez, com o resultado embaixo de cada um. **Não há código para conectar**: ao salvar, o Tralked confere que o perfil existe e é público (Steam: perfil público e, com `STEAM_API_KEY`, detalhes de jogos públicos; sem a chave isso só aparece na primeira importação; PSN/Xbox/RA: perfil encontrado pela conta de serviço), grava a conexão como ativa e **não verificada** (`LinkedAccount.linkedAt`; `verifiedAt` fica para quem provou a posse) e começa a importação em segundo plano. Conexões não verificadas sincronizam e rendem XP normalmente; o perfil do jogador e a tela de conexões mostram "não verificada". Esvaziar um campo desconecta, e trocar a conta de um campo substitui a anterior: as duas coisas anulam no ledger o XP que veio da conta (sem apagar; para a Steam, cujas entradas não levam plataforma, pelas conquistas e jogos Steam do jogador) e por isso pedem confirmação antes: um diálogo, e também a etapa "Confirme antes de salvar" que o servidor devolve no próprio formulário (o servidor nunca desconecta sem a confirmação). Uma plataforma "Em breve" que já estava conectada mantém o botão "Desconectar…". Cada busca de perfil conta num limite por usuário (12 a cada 15 min, em memória). A Steam conectada preenche `User.steamId`. Abaixo do formulário: "Confira as suas configurações de privacidade se nenhum jogo aparecer" (leva à seção "Como deixar o perfil público" da própria página, com o passo a passo de cada plataforma) e "Precisa sincronizar agora? Sincronizar" (respeita o intervalo mínimo de sincronização).
- **Unicidade e "Reivindicar"**: uma conta de plataforma (plataforma + id externo) só fica em um perfil do Tralked. Se já estiver em outro (inclusive uma Steam de conta antiga, via `User.steamId`), o salvar recusa com "Essa conta já está conectada a outro perfil" e oferece "É sua? Reivindicar". Só a reivindicação pede prova de posse: o Tralked gera um código `TRK-XXXXXX` (vale 30 min), a pessoa cola no "Resumo" (Steam), "Sobre mim" (PSN), bio (Xbox) ou lema (RA) e confirma; o Tralked lê o perfil público (Steam: `steamcommunity.com/profiles/<id>?xml=1`, campo `<summary>`). Provado, a conexão passa para quem reivindicou como **verificada**, o perfil anterior perde a conta pelo mesmo caminho do desvínculo (XP dela anulado, conquistas importadas removidas) e recebe uma notificação. Em desenvolvimento os perfis vêm das fixtures (`src/lib/integrations/steam/fixture.ts` → `STEAM_FIXTURE_PROFILES`, e `src/lib/integrations/{psn,xbox,retro}/fixture.ts`).
- **Contas antigas (do login Steam)**: quem entrava pela Steam (ex.: `mrdead`, `diguzz`) tem conta sem e-mail e sem senha. Digitar essa Steam numa conta nova é recusado como "já conectada a outro perfil"; o histórico só é recuperado pela **reivindicação** (código no Resumo): o e-mail/senha da conta nova passam para a conta antiga (que mantém @, XP, conquistas e papel), a conta nova (ainda vazia) é apagada e a sessão muda para a antiga. Se a conta nova já tem atividade (inclusive outra plataforma conectada), as duas não são juntadas e a mensagem indica o contato. Se a conta antiga já tem senha ou Google, a reivindicação apenas move a Steam (como qualquer outra). Para dar acesso direto a uma conta antiga (ex.: o admin): `DATABASE_URL=... APP_URL=... pnpm user:invite <handle> <email>` grava o e-mail e imprime um link de "definir senha" (o mesmo de "esqueci a senha", 1 h, uso único).
- **Papéis**: `user`, `author`, `editor` (notícias, guias, revisão e moderação) e `admin` (também fraude, jogos, robôs, feeds e usuários). No seed, `lucas` é admin, `Cronista_Iolanda` é editor e `Escriba_Odete` é autor. Quem não tem o papel recebe 404 em `/admin` (no `src/proxy.ts`, antes de renderizar) e as Server Actions conferem o papel de novo.
- **Conta e LGPD** (`/conta`): perfil, privacidade, "Capinha dos jogos" (liga de novo a animação da capinha), exportação dos dados (`/conta/exportar`) e exclusão da conta.
- **Capinha e fundo do jogo** (`/jogos/[slug]`): durante a abertura do lacre há "Não mostrar a animação nos próximos jogos": guarda no aparelho (`localStorage` `tralked:case-intro:off`) e, logado, na conta (`User.caseIntroOff`, que vale para todos os aparelhos e manda no aparelho). O rótulo do disco nunca é a capa nem o hero: um screenshot do jogo, senão o logo sobre uma cor tirada da arte, senão a arte gerada. Atrás do encarte roda, bem apagado, um trecho do trailer em loop e mudo (mp4 da Steam guardado em `GameMedia`, 480p primeiro; senão YouTube nocookie), só depois da capinha, pausado fora da tela, com botão de pausa, e desligado com movimento reduzido ou economia de dados. Cada vídeo de "Trailers e vídeos" usa a própria miniatura (a da Steam pelo id do trailer, a do YouTube pelo id do vídeo).
- **Dados de exemplo**: os personagens do seed são NPCs inventados (`prisma/seed-data/sample-names.ts`), nunca handles de pessoas reais. Para renomear um banco semeado antes disso: `DATABASE_URL=... pnpm sample:rename --dry-run` e depois sem `--dry-run` (idempotente; só mexe nas linhas do seed, nunca em `lucas`, `mrdead`, `diguzz` nem em quem se cadastrou; handles comparados sem diferenciar maiúsculas). Se uma execução falhar no meio, basta rodar de novo: cada personagem é renomeado numa transação e o que já foi feito é pulado.

## Robôs (API de conteúdo)

Robôs criam notícias e guias pela API `/api/v1` (documentação em `/desenvolvedores` e `../docs/robos.md`, OpenAPI em `/api/v1/openapi.json`).

1. Um admin cria a chave em `/admin/robos` (nome + escopos `articles:write`, `guides:write`, `publish`). O segredo `tk_live_…` aparece uma vez só; o banco guarda apenas o hash.
2. O robô envia `Authorization: Bearer tk_live_…` e um `Idempotency-Key` por conteúdo. Repetir a mesma chave com o mesmo corpo devolve a mesma resposta sem duplicar; com outro corpo, 409.
3. Sem o escopo `publish`, o conteúdo entra em `/admin/revisao`; um editor revisa e aprova a publicação. O público vê a assinatura "Equipe Tralked" (sem selo de robô); o admin mostra a origem robô.

Sem acesso ao admin (por exemplo, para a chave de um robô em produção), crie a chave pelo terminal: `DATABASE_URL=… pnpm api:key "<nome>" articles:write publish` (escopos: `articles:write`, `guides:write`, `publish`, `media:write`; escopo desconhecido sai com código 2). O segredo `tk_live_…` é impresso uma vez, só no terminal, e nunca vai para `scripts/.logs`.

Corpo malformado, HTML, imagem `http:`/`javascript:`, jogo inexistente ou campo desconhecido voltam 4xx com o caminho do campo em JSON Pointer (`/blocks/1/url`). Limite: 60 requisições por minuto por chave.

## Variáveis de ambiente

Copie `.env.example` para `.env`. Em desenvolvimento todas as obrigatórias têm valor padrão. Em produção, `SESSION_SECRET` e `CRON_SECRET` precisam estar definidas (o app não sobe sem elas); defina também `DATABASE_URL` e `APP_URL`, que têm padrões apontando para o ambiente local.

| Variável | Produção | O que faz |
| --- | --- | --- |
| `DATABASE_URL` | obrigatória | Conexão Postgres. Padrão local: `postgresql://gamelog:gamelog@localhost:5433/gamelog`. |
| `SESSION_SECRET` | obrigatória | Segredo (>= 32 caracteres) que assina o cookie de sessão. |
| `CRON_SECRET` | obrigatória | Token Bearer exigido pelos endpoints de cron. |
| `APP_URL` | obrigatória | URL pública do app (ex.: `https://tralked.exemplo.com`). Usada em redirects e nos links de definir senha. |
| `STEAM_API_KEY` | opcional | Biblioteca, conquistas e raridade global pela Web API; ao conectar, também confere se os detalhes de jogos estão públicos. A conexão Steam (e o código da reivindicação no Resumo) lê o perfil público com ou sem chave. Também desativa o login de demonstração. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | opcional | Metadados de jogos (IGDB / Twitch): capa, descrição, gêneros, datas. Também ligam os lançamentos de consoles (cron `releases`) e o catálogo completo de consoles (cron `igdb-catalog`); sem elas, em produção essas duas partes ficam desligadas (a home e `/lancamentos` avisam) e os lançamentos do PC continuam vindo da Steam, sem chave. |
| `RAWG_API_KEY` | opcional | Metadados complementares de jogos (RAWG). |
| `SGDB_API_KEY` | opcional | Artes (capas, banners, ícones) via SteamGridDB. |
| `PSN_NPSSO` | em produção, para a PSN | Cookie NPSSO da **conta de serviço** PlayStation do Tralked (não de usuários). Trocado no servidor por tokens de acesso/refresh, guardados só em memória. API não oficial: pode quebrar. Sem ele, em produção a PSN aparece como "Em breve". |
| `XBOX_OPENXBL_KEY` | em produção, para o Xbox | Chave da OpenXBL (xbl.io) da conta de serviço Xbox do Tralked. API não oficial. Sem ela, em produção o Xbox aparece como "Em breve". |
| `RA_USERNAME` / `RA_API_KEY` | em produção, para o RA | Usuário e chave da Web API oficial do RetroAchievements (conta de serviço). A chave é o que liga a integração (o usuário vai junto quando definido); sem ela, em produção o RetroAchievements aparece como "Em breve". |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | opcional | Login com Google (OpenID Connect, código + PKCE). URI de redirecionamento: `$APP_URL/api/auth/google/callback` (produção: `https://tralked.com/api/auth/google/callback`). Sem as duas, `/api/auth/google` responde 404 e os botões "Entrar/Criar conta com o Google" somem de `/entrar` e `/cadastrar`. Passo a passo em "Login com Google". |
| `RESEND_API_KEY` | em produção, para e-mail | Chave da API da Resend (`re_…`, permissão "Sending access"). Com ela o Tralked envia redefinição de senha, confirmação de e-mail, boas-vindas e confirmação da newsletter. Sem ela, fora de produção os e-mails saem no console; em produção nada é enviado e as telas dizem que o envio de e-mails está desativado. Passo a passo em "E-mail transacional (Resend)". |
| `MAIL_FROM` | opcional | Remetente dos e-mails. Padrão: `Tralked <no-reply@tralked.com>` (o domínio precisa estar verificado na Resend). |
| `BLOB_READ_WRITE_TOKEN` | obrigatória para fotos | Token do Vercel Blob, onde ficam as fotos da galeria (cache de 1 dia; a foto removida pela moderação é apagada do Blob). Sem ele, em produção o envio de fotos responde 503 "O envio de fotos está indisponível no momento"; em desenvolvimento as fotos vão para `public/uploads`. |
| `STEAM_MODE` | opcional | `fixture` usa os dados offline em vez das páginas públicas da Steam (testes e e2e usam); para a biblioteca, só vale sem `STEAM_API_KEY`. |
| `PLATFORM_FIXTURES` | só testes | `1` deixa um build de produção usar as fixtures de PSN/Xbox/RA sem as chaves. Nunca em um deploy real. |
| `DEV_MAIL_LOG_FILE` | nunca | Só fora de produção e sem `RESEND_API_KEY`: arquivo onde cada e-mail também é gravado, uma linha JSON `{ kind, to, subject, link }` (os e2e leem dali). |

Sem uma chave, a integração correspondente usa fixtures locais (`src/lib/integrations/*/__fixtures__`) **fora de produção**, então o app funciona offline com os dados do seed. Para ligar dados reais, basta preencher a chave no `.env` e reiniciar; as integrações são escolhidas por `hasKey()` em `src/lib/env.ts`. PSN, Xbox e RetroAchievements **nunca** usam fixtures com `NODE_ENV=production` (`src/lib/integrations/availability.ts`): sem a chave, a fábrica do cliente recusa (`PlatformNotConfiguredError`), a linha da plataforma em `/conta/conexoes` aparece como "Em breve" (campo desabilitado) e o cron pula a plataforma. Só `PLATFORM_FIXTURES=1` (modo de teste explícito) libera as fixtures num build de produção.

A Steam é a exceção: sem `STEAM_API_KEY` ela usa as páginas públicas da comunidade (`src/lib/integrations/steam/community.ts`): perfil e conquistas de perfis públicos em XML e a raridade global, sem chave. A lista de jogos de um perfil exige login na Steam, então a sincronização sonda os jogos do catálogo, um por um, com no máximo uma requisição a cada 1,2 s por domínio: cada sincronização sonda o que cabe em 45 s (o ponto de partida gira pelo catálogo a cada 2 minutos, então sincronizações seguidas cobrem o catálogo todo), para depois de 5 falhas seguidas, e só volta aos jogos que já estão na biblioteca uma vez por semana ou quando os dados do jogo mudam. A importação por script sonda o catálogo inteiro. Com `STEAM_MODE=fixture` tudo fica offline.

**Biblioteca completa e horas (Plano 4).** Com `STEAM_API_KEY`, a sincronização grava a biblioteca Steam inteira (`GetOwnedGames` com `include_appinfo` e `include_played_free_games`, inclusive jogos nunca jogados) com horas por jogo, horas das últimas 2 semanas e última vez jogado (`UserGame.playtimeMin`, `playtime2WeeksMin`, `lastPlayedAt`); jogos fora do catálogo entram como entradas só com nome (`Game.stub`). Conquistas são lidas só dos jogos jogados desde a última leitura (`UserGame.checkedPlaytimeMin`), dentro do mesmo limite de 45 s; o que sobrar continua na próxima. A lista de desejos vem de `IWishlistService/GetWishlist` (também sem chave, para listas públicas) e é substituída a cada sincronização (`WishlistItem`). PSN (`gamelist/v2`, `playDuration`) e Xbox (estatística `MinutesPlayed` via OpenXBL) gravam as horas de todos os jogos jogados, com ou sem troféus; o RetroAchievements informa segundos (convertidos para minutos). Cada marco de horas acumuladas por jogo e plataforma paga XP uma vez (ledger `source = 'playtime'`, `sourceKey = '<plataforma>:<gameId>:<marco>'`, datado no pagamento; só horas reais informadas pela plataforma). **Nada abaixo de 5 h num jogo** (contra "idle farming"): o primeiro marco pago, 5 h, vale o acumulado até ele, `round(2000 · 5^0,7)`; os seguintes (10, 25, 50, 100, 250, 500, 1000, 2500, 5000 e 10000 h) valem `round(2000 · (m^0,7 − anterior^0,7))`. Limites por usuário (`src/lib/sync/playtime.ts`): no máximo **10 jogos novos** começam a render horas por dia UTC (um jogo "começa" quando seu primeiro marco é pago; os que passarem do limite ficam para os dias seguintes, os mais jogados primeiro) e no máximo **150 jogos** rendem horas na vida toda (o mesmo jogo em outra plataforma não conta de novo; jogos que já rendem continuam rendendo marcos novos; os que passarem desse limite nunca rendem). Desconectar ou perder a conta numa reivindicação anula esse XP como o resto, e marcos anulados nunca pagam de novo. Atributos novos: **Resistência** (`round(10 · horas totais^0,7)`) e **Acervo** (10 por jogo jogado + 5 por jogo possuído e nunca jogado). Leitura para o perfil: `getUserLibrary`, `getUserWishlist` e `getPlaytimeTotals` em `src/lib/library/queries.ts`.

Nomes provisórios antigos: antes do Plano 4, a sincronização do catálogo chamava um app desconhecido do IGDB de `Steam App <appid>` (slug `steam-app-<appid>`), listado. Esse nome também conta como provisório: a sincronização Steam troca nome e slug pelo nome que a biblioteca informa (`include_appinfo`) e coloca o jogo na fila de detalhes, e sem nome conhecido ele sai das listagens (`stub`). Para corrigir de uma vez o que já está no banco: `DATABASE_URL=… pnpm exec tsx --env-file=.env.production.local scripts/repair-placeholder-games.ts [--dry-run]` (ou `STEAM_API_KEY=… DATABASE_URL=… pnpm games:repair-placeholders [--dry-run]`): nomes vêm primeiro das bibliotecas dos donos (uma requisição por dono, exige `STEAM_API_KEY`), depois da loja (`appdetails` com `filters=basic`, uma a cada 1,5 s); sem nome, o jogo vira `stub`. Idempotente e registra cada troca em `scripts/.logs/`.

**Highscores (Plano 4).** `/highscores` tem pódio animado do top 3, números que sobem, barras de XP/progresso, setas de subida e queda e a barra fixa "Você está aqui" (posição, mudança e quanto falta para alcançar quem está logo acima). Categorias: Nível, Horas jogadas, Conquistas, Raras e lendárias (até 20% / até 3% dos jogadores), Platinas e 100%, Acervo, cada uma por plataforma (`/highscores/horas/psn`), e por gênero (`/highscores/genero/rpg`); os links antigos `?skill=` redirecionam. Cada ranking é uma leitura indexada: os totais por usuário e plataforma ficam em `UserRankStats`, regravados a cada recompute (`src/lib/highscores/`); o ranking de nível usa `UserStats` e o de gênero `SkillProgress`. As páginas são pré-renderadas com os dados públicos em cache (tag `highscores`, alguns minutos; funcionam sem JS) e a parte do visitante é uma ilha dinâmica. As setas comparam com a foto diária de cada ranking (`RankSnapshot`, cron `highscores`). Em bancos anteriores, `pnpm highscores:backfill --dry-run` mostra e `pnpm highscores:backfill --snapshot` grava os totais de todos os usuários e tira a foto do dia. Toda a animação para com `prefers-reduced-motion`.

Um app que a Steam lista sem nome (ainda fora da lista de apps importada) entra como `Jogo <appid> da Steam`, com o slug provisório `jogo-<appid>-da-steam`, e continua `stub` (fora das listagens) enquanto o nome for esse. Quando os detalhes (ou o IGDB) trazem o nome real, o slug provisório passa a ser o do nome real: ele nunca foi listado, pré-renderizado nem entrou no sitemap, e as páginas sempre linkam pelo slug atual; jogos com nome real nunca mudam de slug. PSN/Xbox/RA casam títulos com o catálogo listado por nome normalizado e com os stubs só por nome exato (sem diferenciar maiúsculas), um a um, sem carregar os ~150 mil nomes; títulos só com horas (sem troféus) não consultam o IGDB, e o passo de horas respeita o prazo da execução (o resto continua na próxima). No Xbox, os títulos cujos minutos já foram pedidos ficam guardados (`SyncCursor`, por conta e jogador) e só são pedidos de novo quando jogados outra vez. Num build de produção, `STEAM_MODE=fixture` só vale com `PLATFORM_FIXTURES=1` ou `STEAM_FIXTURES=1` (modos de teste, nunca num deploy real; o e2e usa o segundo).

## E-mail transacional (Resend)

O Tralked envia quatro e-mails, em pt-BR e com a marca (HTML simples sem imagens externas + versão em texto): **redefinir senha**, **boas-vindas** (com "Confirmar e-mail"), **confirmar e-mail** (troca de e-mail e "Reenviar" em `/conta`) e **confirmar a newsletter**. O código fica em `src/lib/mail/` (`mailer.ts` chama `POST https://api.resend.com/emails` com `Authorization: Bearer`, `User-Agent` e `Idempotency-Key`; `templates.ts` tem os textos). Uma falha da Resend é registrada no log (sem link nem chave) e nunca derruba o cadastro nem o formulário.

Passo a passo para ligar em produção (`tralked.com`, DNS no Cloudflare):

1. Crie a conta em [resend.com](https://resend.com) (pode entrar com o Google).
2. **Domínio**: em [Domains](https://resend.com/domains) → **Add Domain** → `tralked.com` (a região pode ser a mais próxima dos leitores; ela não muda nada no código).
3. **DNS no Cloudflare**, de um destes jeitos:
   - **Automático (recomendado)**: na página do domínio na Resend, clique em **Sign in to Cloudflare**, autorize o acesso ao DNS de `tralked.com` e a Resend cria os registros sozinha.
   - **Manual**: no Cloudflare, `tralked.com` → **DNS** → **Records** → **Add record**, um para cada linha que a Resend mostrar, copiando os valores dela (no campo *Name* use só a parte antes de `.tralked.com`):

     | Tipo | Nome | Conteúdo | Outros |
     | --- | --- | --- | --- |
     | `MX` | `send` | o *Mail Server* da Resend (ex.: `feedback-smtp.us-east-1.amazonses.com`) | Priority `10`, TTL Auto |
     | `TXT` | `send` | o SPF da Resend (ex.: `v=spf1 include:amazonses.com ~all`) | TTL Auto |
     | `TXT` | `resend._domainkey` | a chave DKIM da Resend (`p=…`, longa) | TTL Auto, **DNS only** |
     | `TXT` | `_dmarc` | `v=DMARC1; p=none;` (recomendado; ainda não existe) | TTL Auto |

     Registros TXT/MX não têm proxy (nuvem laranja); se aparecer a opção, deixe **DNS only**. Esses registros ficam no subdomínio `send` e em `resend._domainkey`: não mexem no MX da raiz (ex.: Email Routing do Cloudflare continua funcionando).
4. Volte à Resend e clique em **Verify DNS Records**; em alguns minutos o domínio fica **Verified** (se demorar, `nslookup -type=TXT resend._domainkey.tralked.com` mostra se o DKIM já está publicado).
   Na mesma página do domínio, em **Configuration**, deixe **Click Tracking** e **Open Tracking** **desligados** (é o padrão): com o rastreamento de cliques, a Resend reescreve os links por um redirecionador dela, e os tokens de "criar nova senha" e "confirmar e-mail" passariam por um terceiro; o rastreamento de aberturas insere uma imagem externa.
5. **Chave**: em [API Keys](https://resend.com/api-keys) → **Create API Key** → nome `tralked-producao`, permissão **Sending access**, domínio `tralked.com` → **Add**. Copie a chave (`re_…`): ela aparece uma vez só.
6. Em `app/.env.production.local`:

   ```bash
   RESEND_API_KEY=re_...
   # opcional; este já é o padrão:
   MAIL_FROM="Tralked <no-reply@tralked.com>"
   ```

   e reinicie o servidor. Confira em `/esqueci-senha` com o seu e-mail: o link chega e o aviso "envio de e-mails desativado" some de `/esqueci-senha` e de `/conta`. Na Resend, **Emails** mostra cada envio (com a etiqueta `category`: `password-reset`, `welcome`, `email-confirmation`, `newsletter-confirmation`).

Limites da Resend: 10 requisições por segundo por conta (o Tralked manda um e-mail por ação, bem abaixo); o plano gratuito tem cota diária/mensal (veja o painel).

## Login com Google

O fluxo já está pronto (`src/lib/auth/google.ts`, `/api/auth/google` e `/api/auth/google/callback`): OpenID Connect com código + PKCE (S256), `state` e `nonce` num cookie httpOnly de 10 min, troca do código no servidor e validação do ID token (assinatura pelas chaves públicas do Google, `iss`, `aud`, validade e `nonce`). Escopos: só `openid email profile` (não sensíveis: não precisam da verificação do Google). Só um e-mail que o Google marca como verificado é gravado, e ele já chega como "e-mail confirmado".

Para ativar:

1. Abra o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto `Tralked` (ou use um existente).
2. **Google Auth Platform → Branding** (a antiga "tela de consentimento OAuth"): nome do app `Tralked`, e-mail de suporte, logo (opcional; aparece depois da verificação da marca), página inicial `https://tralked.com`, política de privacidade `https://tralked.com/privacidade`, termos `https://tralked.com/termos`, domínio autorizado `tralked.com`, e-mail de contato do desenvolvedor → **Save**.
3. **Audience**: tipo de usuário **External**. Enquanto estiver em **Testing**, só os usuários de teste listados entram; clique em **Publish app** para ficar **In production** (com só esses escopos básicos não há revisão).
4. **Data access**: adicione `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile` (nada além disso).
5. **Clients → Create client** → tipo **Web application**, nome `Tralked web`:
   - **Authorized redirect URIs**: `https://tralked.com/api/auth/google/callback` (exatamente assim: `https`, sem barra no fim). Para testar localmente, adicione também `http://localhost:3000/api/auth/google/callback`.
   - **Authorized JavaScript origins**: não precisa (o login é todo no servidor).
   - **Create**. Copie o **Client ID** e o **Client secret** (o segredo só aparece inteiro agora).
6. Em `app/.env.production.local`: `GOOGLE_CLIENT_ID=…apps.googleusercontent.com` e `GOOGLE_CLIENT_SECRET=…`, com `APP_URL=https://tralked.com` (o redirect é montado a partir de `APP_URL` e precisa ser idêntico ao cadastrado). Reinicie: os botões aparecem em `/entrar` e `/cadastrar`.
7. Mudanças nos redirect URIs podem levar de 5 minutos a algumas horas para valer. Um `redirect_uri_mismatch` do Google quase sempre é `APP_URL` diferente do URI cadastrado (http × https, `www`, barra no fim).

## Dados reais da Steam (sem chave)

Dois scripts gravam dados reais no banco indicado em `DATABASE_URL`, que é obrigatória (eles se recusam a gravar no banco `gamelog`). Os dois só inserem e atualizam, nunca apagam. Cada execução deixa um log em `scripts/.logs/`.

```bash
# 1. Catálogo: os N jogos com conquistas mais populares do SteamSpy (tops + página dos mais possuídos), ficha da loja em pt-BR,
#    capa/hero/logo/cabeçalho/screenshots/trailers (links para o CDN da Steam, nada é baixado),
#    conquistas com raridade global e habilidades pelas tags. Pode ser retomado: pula jogos completos.
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_dev pnpm catalog:bootstrap --limit 300

# 2. Perfis públicos: cria/atualiza o usuário como um login Steam faria e sincroniza sondando o catálogo.
DATABASE_URL=... pnpm steam:import 76561198012210783 --admin --psn MrDead_   # dono: admin, Steam verificada, PSN pendente
DATABASE_URL=... pnpm steam:import diguzzz                                    # vanity ou SteamID64; conta não verificada
```

Um perfil importado não tem e-mail nem senha: quem reivindicar essa Steam (código no Resumo) numa conta nova recupera esse mesmo usuário (veja "Contas antigas" acima), ou o admin usa `pnpm user:invite`.

### PSN e Xbox pendentes

`--psn <onlineId>` cria um `LinkedAccount` PSN **pendente** (inativo: sem `linkedAt`, com `externalId` provisório `pending:<onlineId>`). A PSN não tem API pública: para ativar, crie uma conta PSN de serviço dedicada ao Tralked (nunca a de um usuário), entre nela em `https://www.playstation.com`, copie o `npsso` de `https://ca.account.sony.com/api/v1/ssocookie` e defina `PSN_NPSSO` no `.env` do servidor. Depois o dono informa o ID online no campo PlayStation de `/conta/conexoes` e salva, o que grava o `accountId` real. O Xbox também precisa de um provedor com credencial (`XBOX_OPENXBL_KEY`); até lá aparece como "Em breve" em produção.

## Lançamentos e calendário

- **Lançamentos** (Plano 4, F10): card "Lançamentos" na home (logo depois dos destaques, antes de "Últimas notícias"), com as abas **Últimos** (últimos 30 dias; só o que uma fonte listou no dia do lançamento ou depois, então um jogo adiado que sumiu das listas não fica ali) e **Próximos** (próximos 90 dias, e os sem dia marcado, "a definir" ou com o texto da fonte; só o que alguma fonte listou nas últimas 2 semanas) e o filtro **PC** (padrão) / PlayStation / Xbox / Nintendo / Todas; cada aba e filtro mostra os 6 mais populares daquela família (a família é filtrada no banco antes do limite, então uma família movimentada nunca empurra outra para fora), em ordem de data, com capa (ou a cápsula da loja), data e plataformas, e leva à página do jogo. `/lancamentos` (`/lancamentos/<ultimos|proximos>/<pc|playstation|xbox|nintendo|todas>`, dez páginas estáticas, funcionam sem JavaScript) tem a lista inteira agrupada por dia. Os dados vêm só do banco (`GameRelease`), gravados pelo cron `releases`; sem as chaves do IGDB, em produção, os consoles mostram o aviso "falta configurar a integração com o IGDB". Offline (dev, testes, seed) as listas vêm de fixtures com datas em volta de hoje (`src/lib/integrations/steam/releases-fixture.ts`, `src/lib/integrations/igdb/catalog-fixture.ts`; os títulos de console da fixture são inventados).
- **Calendário** (Plano 4, F8): `/calendario` (mês atual) e `/calendario/AAAA-MM` (1980–2040; fora disso, 404): grade do mês (tabela de links, domingo primeiro; setas mudam de dia, Home/End vão ao começo/fim da semana, Page Up/Page Down mudam de mês e o foco fica no mesmo dia) e a **linha do tempo** do mês logo abaixo, dia a dia, onde cada dia da grade leva. Mostra matérias publicadas (no dia de Brasília), lançamentos (`GameRelease` e a data de lançamento dos jogos listados do catálogo, um por jogo e dia) e, para quem entrou, as próprias conquistas (uma linha por jogo e dia, com a mais rara; desbloqueios com fraude confirmada ficam de fora), marcos de horas (entradas `playtime` do ledger não anuladas, na data do pagamento) e missões concluídas. `?jogador=<handle>` mostra os de outro jogador se o perfil dele for público (a ficha em `/jogador/<handle>` tem o link "Calendário de @handle", ou "Meu calendário" para o dono) (perfil privado ou inexistente: só as datas públicas, com aviso). O mês público fica em cache e já vem no HTML (sem JavaScript, o mês e as setas de mês funcionam); a camada pessoal depende da sessão e chega por streaming no lugar dele.

## Cron

Onze jobs, cada um limitado a uma quantidade fixa de itens por execução. Chame com `GET` e o header `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Faz |
| --- | --- |
| `/api/cron/catalog` | Sincroniza o catálogo de jogos e metadados. |
| `/api/cron/rarity` | Atualiza a raridade global das conquistas. |
| `/api/cron/users` | Ressincroniza até 50 usuários Steam por execução (os mais antigos primeiro), com limite de 50 s para a execução toda: ninguém começa depois do prazo e a sondagem do catálogo de cada usuário usa só o tempo que sobra (no máximo 45 s). |
| `/api/cron/platforms` | Ressincroniza até 5 contas PSN, Xbox e RetroAchievements verificadas por execução (as mais antigas primeiro), lendo só os jogos com conquistas novas e retomando de onde parou (limite de 50 s). |
| `/api/cron/media` | Busca vídeos, screenshots e artworks (IGDB) e capa/hero/logo (SteamGridDB) de jogos ainda sem mídia oficial. |
| `/api/cron/news` | Lê os feeds RSS ativos e guarda título, link, fonte, data e área das manchetes que passam na regra da área do feed (veja "Manchetes externas por área"). |
| `/api/cron/notifications` | Diário: apaga notificações com mais de 90 dias (o texto delas pode citar outras pessoas, inclusive quem excluiu a conta). |
| `/api/cron/steam-catalog` | Catálogo completo da Steam, em 50 s por execução: (1) até 40% do tempo importando a lista de jogos da loja (`IStoreService/GetAppList`, 10 mil por página, exige `STEAM_API_KEY`) como entradas só com nome (`Game.stub`, fora das listagens, do sitemap e dos seletores), retomando pelo `last_appid` guardado em `SyncCursor`; terminada uma volta, as seguintes pedem só o que mudou (`if_modified_since`); (2) uma página do SteamSpy (os mil mais possuídos, girando pelas 10 primeiras) define `Game.popularity`; (3) no tempo que sobra, detalhes da loja em pt-BR (resumo, desenvolvedora, data, nota; nunca preço), tags (habilidades), conquistas com raridade e artes do CDN da Steam pelo appid (capa 600×900, hero e logo conferidos com `HEAD` antes de gravar; sem capa, SteamGridDB e depois IGDB), na ordem: jogos que alguém abriu, jogos que alguém tem ou deseja, os mais populares. Offline (`STEAM_MODE=fixture`) só a lista de apps da fixture é importada. |
| `/api/cron/releases` | Lançamentos (Plano 4, F10), em 50 s: (1) **Steam, sem chave**: as listas "lançamentos populares" e "em breve populares" da loja (`store.steampowered.com/search/results/?filter=popularnew\|popularcomingsoon&category1=998&infinite=1`, o JSON por trás das páginas da loja; 2 páginas de 50 cada, por popularidade, com data em pt-BR, ou o texto da loja quando não é um dia, ex. "4º trimestre de 2026"); jogos desconhecidos viram entradas só com nome (`ensureSteamGames`) e os 40 mais populares ainda sem detalhes vão para o começo da fila de detalhes do `steam-catalog`; jogos com conteúdo sexual (descritores 3 e 4 da Steam) ficam de fora. A `api/featuredcategories` (new_releases/coming_soon) foi conferida em outubro de 2026 e não serve: os itens não têm data nem ordem de popularidade. (2) **IGDB** (com `IGDB_CLIENT_ID/SECRET`): `release_dates` só dos consoles (o PC é da Steam), **por família** (PlayStation, Xbox, Nintendo) e em duas janelas: os últimos 30 dias, do mais recente para trás, e os próximos 120, de hoje para a frente; até 2 páginas de 500 por família e janela (12 requisições no máximo), só jogos principais, remakes, remasters, ports e expansões independentes que alguém segue ou avaliou (`hypes` ou `total_rating_count` > 0). A precisão da data vem do `category` antigo quando existe, senão do `date_format`, que é uma referência à tabela `/date_formats` (lida uma vez, pelo texto `format`: `YYYYMMMMDD`, `YYYYMMMM`, `YYYY`, `YYYYQ1`…, `TBD`); só um dia exato vira data, o resto vira texto ("4º trimestre de 2026") e "TBD" é ignorado. Todas as regiões de um jogo numa família viram uma linha só (o dia exato mais cedo). Uma linha `GameRelease` por jogo e família de plataforma (PC primeiro): o mesmo lançamento visto pela Steam e pelo IGDB aparece uma vez só, e a linha da Steam vale para o PC. Os jogos do IGDB casam com o catálogo pelo id do IGDB, pelo appid da Steam que o IGDB informa ou pelo nome (sem diferenciar maiúsculas nem ™/®; com os dois anos de lançamento conhecidos, no máximo um ano de diferença; com algum desconhecido, só se tiverem uma família em comum: o God of War de PS2 não é o God of War da Steam; nome ambíguo é pulado) e só os desconhecidos viram entradas novas (`src/lib/sync/igdb-games.ts`). No sentido inverso, quando a Steam traz um app (lista de apps, lançamentos, biblioteca) cujo nome (pelo `lower()` do Postgres, como o índice) é o de um jogo do IGDB que está no PC e ainda não tem appid, esse jogo recebe o appid em vez de nascer outra linha, com `detailsSyncedAt` zerado para a fila de detalhes da Steam completá-lo (`ensureSteamGames`); vale também para jogos que o IGDB já tirou de `stub`, mas só quando ele é o **único** jogo do catálogo com esse nome (um "Chess" com homônimos nunca é adotado). A adoção e a criação dos apps novos acontecem sob a mesma trava (advisory lock) em que o IGDB confere nomes e cria os seus stubs, então os dois imports rodando juntos nunca deixam o mesmo jogo duas vezes. Ao terminar, invalida o cache da home, de `/lancamentos` e do calendário. |
| `/api/cron/igdb-catalog` | Catálogo completo de consoles (Plano 4, F10), com `IGDB_CLIENT_ID/SECRET`, em 50 s: (1) até 60% do tempo importando páginas de 500 jogos do IGDB de PlayStation (PS1–PS5, PSP, Vita), Xbox (todos), Nintendo (NES/Famicom até Switch e portáteis; o Switch 2 é procurado pelo nome) e PC, pelo id, retomando de `SyncCursor` `igdb-catalog`; terminada uma volta, as seguintes pedem só o que mudou (`updated_at`); cada jogo casa com o catálogo como acima e os desconhecidos entram como `stub` (nome, plataformas, id do IGDB, data, capa); (2) no resto, detalhes dos stubs do IGDB sem appid da Steam (resumo, capa, nota, gêneros → habilidades), 500 por requisição (fila com índice parcial próprio, `Game_igdb_details_queue_idx`), primeiro os que alguém abriu, depois os que alguém tem, depois os mais novos; com os detalhes o jogo sai de `stub` e entra nas listagens. O IGDB aceita 4 requisições por segundo; o cliente enfileira e espaça. Sem as chaves, em produção não faz nada (`{ "status": "disabled" }`). |
| `/api/cron/highscores` | Diário: guarda a posição dos 200 primeiros de cada ranking dos Highscores (`RankSnapshot`, 14 dias); as setas de subida e queda comparam a posição atual com a foto do dia anterior. |

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio/api/cron/catalog
```

Resposta: `{ "job": "catalog", "processed": N }`. Token inválido retorna 401, job desconhecido retorna 404.

A rota exporta `maxDuration = 300` (o teto da Vercel sem Fluid compute). Cada job cabe com folga: `catalog` 25 jogos, `rarity` 50, `media` 20, `news` os feeds ativos, `notifications` uma exclusão; `users` e `platforms` param em 50 s. O que sobra vai primeiro na execução seguinte.

### Primeiras importações (worker no GitHub Actions)

Uma biblioteca grande (PSN com 700 jogos, Steam com milhares) não cabe nos 50 s do cron: a 5 contas por execução, a primeira importação não terminava nunca. O worker `pnpm platforms:import` (`scripts/platform-import-worker.ts`, lógica em `src/lib/sync/first-import.ts`) roda a cada 2 h no `.github/workflows/platform-import.yml` (às :29 das horas ímpares, logo depois do cron das :23, para não acordar o Neon à toa; no máximo 0,8 h por rodada) direto contra o banco, sem o limite de 50 s, e importa:

- conexões PSN, Xbox e RetroAchievements cuja sincronização nunca chegou ao fim da lista (`LinkedAccount.lastSyncedAt` nulo);
- usuários Steam nunca sincronizados por inteiro, ou cuja última sincronização acabou o tempo antes de ler todos os jogos (marcador `SyncCursor` `steam-backlog:<userId>`, gravado e apagado pela própria sincronização Steam).

Há uma fila por plataforma, todas em paralelo. Cada conta recebe fatias de 5 min (`--slice-minutes`) e volta para o fim da fila, então uma biblioteca enorme não segura quem acabou de entrar. Uma conta privada, desconectada, com erro ou cuja fatia não gravou nada fica para a próxima execução. Uma conta que o cron ou o "Sincronizar agora" começou há menos de 3 min é deixada terminar. Enquanto trabalha, o worker mantém uma trava (`SyncCursor` `platform-import-worker`, 15 min, renovada a cada 5) com as contas que pegou, e os jobs `users` e `platforms` pulam essas contas. Se o processo morrer, a trava vence sozinha. Uma conta recém-conectada recebe os primeiros 50 s logo ao conectar e o resto no worker. Segredos do repositório: `DATABASE_URL`, `STEAM_API_KEY`, `PSN_NPSSO`, `XBOX_OPENXBL_KEY`, `RA_USERNAME`, `RA_API_KEY` (plataforma sem segredo é pulada pelo worker e continua só no cron) e `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`. Disparo manual: `gh workflow run platform-import.yml -f hours=2`.

### Workers no GitHub Actions (horários e cota do Neon)

O banco é o Neon grátis: **100 CU-h por mês**. O compute fica ligado enquanto há consultas e desliga 5 min depois da última (mínimo 0,25 CU; com carga ele sobe até 2 CU e gasta a cota mais rápido). Em 02/11 a cota estourou porque o `steam-details` rodava 5,5 h a cada 6 h com 8 jogos em paralelo (~22 h acordado por dia, ~165 CU-h/mês sozinho) e cruzava com os outros workers. Por isso:

- **Horários em minutos quebrados.** O GitHub atrasa e às vezes pula execuções agendadas nos minutos cheios (:00, :15, :30, :45); na manhã de 02/11 pulou várias. Todos os horários ficam em minutos ímpares e "quietos".
- **Workers logo depois do cron**, com o banco já acordado, e **nunca dois workers pesados ao mesmo tempo**: cada um tem a sua janela.
- **Janelas curtas**, configuráveis: a entrada `hours` (e `concurrency` no `steam-details`) do disparo manual, ou as variáveis do repositório (`vars`, não segredos) `PLATFORM_IMPORT_HOURS`, `STEAM_DETAILS_HOURS`, `STEAM_DETAILS_CONCURRENCY` e `CATALOG_ENRICH_HOURS` para as rodadas agendadas. Cada worker também se encerra sozinho 10 min depois da janela (`exitAfterWindow`), se algo o prender.
- **Menos idas ao banco**: o `catalog-enrich` grava as notas da Steam e as tentativas de mídia em grupos de 25 (um `UPDATE` só); o `steam-details` conta a fila só no começo e no fim. Uma conexão parada há 10 s é fechada (`idleTimeoutMillis` em `src/lib/db.ts`), então nada fica aberto entre lotes.
- **Queda de conexão não derruba a rodada.** Se o Neon fecha a conexão (P1001, P1017, `ECONNRESET`, "Connection terminated", Postgres 57P01…), o worker espera (5 s, 10 s, 20 s… até 60 s), testa o banco com `SELECT 1` e repete o lote, a fatia ou a volta que caiu (`src/lib/worker/db-retry.ts`); a conta ou o jogo não é marcado como falho. Desiste depois de 7 falhas seguidas (~4 min) e para de vez, sem tentar de novo, quando o Neon recusa o compute por cota. As travas (`SyncCursor`) continuam valendo: a conta em andamento fica reservada enquanto o worker espera.
- **Erros completos no log**: `describeError` (`src/lib/worker/errors.ts`) escreve nome, código, mensagem, `meta` do Prisma, a cadeia de `cause` (Prisma → driver → pg → socket), os erros de um `AggregateError` e as primeiras linhas da pilha. Antes saía só "import failed:" sem nada.

Horários (UTC; Brasília = UTC−3):

| Workflow | Quando | Janela | O que faz |
| --- | --- | --- | --- |
| `cron.yml` | :17 de 0, 6, 12 e 18 h | ~7 min | `users`, `releases`, `media` |
| `cron.yml` | :23 das horas ímpares | ~4 min | `steam-catalog`, `news`, `platforms`, `igdb-catalog` |
| `cron.yml` | 03:19 | ~5 min | `catalog`, `rarity`, `highscores`, `notifications` |
| `platform-import.yml` | :29 das horas ímpares | até 0,8 h (~1 min sem fila) | primeiras importações |
| `steam-details.yml` | :37 de 2, 8, 14 e 20 h | até 0,6 h, 3 jogos por vez | detalhes da loja Steam |
| `catalog-enrich.yml` | 04:37 | até 0,6 h | mídia do IGDB/SteamGridDB e notas da Steam |
| `steam-players.yml` | :23 das horas ímpares | 1–3 min | jogadores agora / picos na Steam (top 2.000) |
| `retro-catalog.yml` | domingo 03:21 | ~1 min (1ª rodada: minutos) | catálogo do RetroAchievements |

Orçamento de CU-h por mês (estimado a 0,25 CU, contando os 5 min que o compute fica ligado depois da última consulta):

| Peça | Banco acordado por dia | CU-h/mês |
| --- | --- | --- |
| cron das horas ímpares + `platform-import` sem fila | 12 × ~13 min | ~20 |
| cron de 6 em 6 h + diário | 4 × ~12 min + ~5 min | ~7 |
| `steam-details` (janela cheia; com a fila vazia, ~2) | 4 × ~41 min | ~21 |
| `catalog-enrich` | ~41 min | ~5 |
| `platform-import` com trabalho | ~1 h por conta grande nova | ~0,25 por hora |
| **Workers e crons** | **~6,9 h** | **~53** |
| Sobra para o site, o robô de notícias e imprevistos | | **~47** |

Se o compute subir acima de 0,25 CU (carga), o gasto sobe na mesma proporção: limitar o autoscaling a 0,25–0,5 CU no console do Neon segura isso. Para acompanhar, use a página **Usage** do projeto no Neon.

### Jogadores na Steam (worker no GitHub Actions)

A página do jogo mostra "Jogando agora na Steam: X · pico hoje Y · maior pico medido Z" para os jogos da Steam com amostras. O worker `pnpm steam:players` (`scripts/steam-players-worker.ts`, lógica em `src/lib/sync/steam-players.ts`) roda a cada 2 h no `.github/workflows/steam-players.yml`, às :23 das horas ímpares (junto com o cron das :23, com o Neon já acordado):

- pega os **2.000 jogos da Steam mais populares** do catálogo (`Game.popularity`, `--limit`);
- pergunta a cada um `ISteamUserStats/GetNumberOfCurrentPlayers`, que **não precisa de chave** (não gasta a cota da `STEAM_API_KEY`), com 16 pedidos em paralelo (`--concurrency`); depois de 20 recusas (429/5xx) para de começar pedidos e grava o que leu;
- grava tudo num único `INSERT … ON CONFLICT` em `SteamPlayerCount`: **uma linha por jogo**, reescrita a cada hora, com a amostra atual, o pico do dia (dia de Brasília; zera quando o dia muda) e o **maior pico medido pelo Tralked** (a Steam não publica o pico histórico) com a hora em que foi medido. Nunca guarda o histórico de amostras.

Na página, a amostra só vale como "agora" por 3 h (jogo que saiu do top ou worker parado mostra só "Maior pico na Steam"), e o "pico hoje" só aparece no próprio dia. O dado tem cache próprio de 15 min (`getSteamPlayers`), separado do perfil do jogo.

**Custo:** a tabela fica em ~2.000 linhas de ~60 bytes (mais índice e versões mortas, menos de 1 MB). Cada rodada leva 1 a 3 min, quase tudo esperando a Steam, e faz 2 consultas ao banco (a lista e a gravação). Se o banco já está acordado pelo `platform-import`, o custo é desprezível (menos de 3 CU-h por mês). Se a rodada acordar o Neon sozinha, cada uma custa ~5 min de computação mínima (0,25 CU), cerca de **15 CU-h por mês** dos 100 do plano grátis; nesse caso, rode a cada 2 ou 3 h (`23 */2 * * *`). Segredo do repositório: só `DATABASE_URL`. Disparo manual: `gh workflow run steam-players.yml -f limit=2000`.

### Catálogo do RetroAchievements (worker no GitHub Actions)

O worker `pnpm retro:catalog` (`scripts/retro-catalog-worker.ts`, lógica em `src/lib/sync/retro-catalog.ts`, cliente em `src/lib/integrations/retro/catalog.ts`) roda **toda semana** no `.github/workflows/retro-catalog.yml`, domingo às 03:21 UTC (com o banco acordado pelo cron diário das 03:19):

1. **Lista leve:** lê os consoles ativos (`API_GetConsoleIDs`) e, de cada um, os jogos **com conquistas** (`API_GetGameList` com `f=1`) e grava em `RetroCatalogGame` só id, título, console, ícone, número de conquistas, pontos e a data em que o RA mudou o conjunto. Um `INSERT … ON CONFLICT` por 500 jogos, que só reescreve as linhas que o RA mudou. Console que falha é pulado (aviso no log).
2. **Ligação com o catálogo:** cada jogo do RA ainda sem `GamePlatformLink` `retro` (o mesmo vínculo que a sincronização RA dos jogadores usa) é procurado pelo nome, com o artigo do RA desinvertido (`Legend of Zelda, The: …` → `The Legend of Zelda: …`) e os nomes alternativos separados por ` | `, pelo `lower(name)` e pelo `searchName` dobrado (`tralked_search_name`, os mesmos índices do `findStubByName`). Só vale um jogo da família do console (Nintendo, PlayStation, Xbox) ou sem família conhecida; um console sem família (Mega Drive, arcade, Atari…) nunca pega um jogo de PC; um jogo que já tem outro conjunto do RA não é usado (uma página por conjunto, para o total de conquistas bater). Dois candidatos = ambíguo, fica só na tabela leve. Sem candidato, vira **stub** (`Game.stub`: fora das listagens, achado pela busca, com página própria; plataforma = família do console, ou o nome do console). Hacks, homebrew, protótipos (`~Tag~`) e subconjuntos (`[Subset - …]`) nunca viram stub: ficam na tabela leve até um jogador que tem o jogo sincronizar (a sincronização RA cria o jogo nessa hora). Os não ligados são revistos a cada 30 dias. Tudo sob a mesma trava (`CATALOG_CREATE_LOCK`) dos imports da Steam e do IGDB. `--no-stubs` só liga, sem criar.
3. **Conquistas sob demanda:** a lista de conquistas de um jogo do RA nunca é importada em massa. Na primeira vez que alguém (logado ou não) abre a página do jogo, o componente `RetroAchievementsLoader` chama a server action `loadRetroAchievements` (`src/app/jogos/[slug]/retro-actions.ts`), que reserva o conjunto (`RetroCatalogGame.achievementsSyncedAt`, então várias visitas ao mesmo tempo fazem um pedido só), lê `API_GetGameExtended` (uma requisição), grava as linhas `Achievement` (`platform` `retro`, a mesma chave da sincronização) com a raridade, expira o cache do jogo (`updateTag`) e atualiza a página. Lê de novo quando o RA muda o conjunto. Se o RA falha, a reserva é devolvida e a próxima visita tenta de novo. Quando um jogador que tem o jogo sincroniza, a sincronização RA grava as mesmas linhas; se o conjunto já está completo, a página só marca como lido.

**Armazenamento (medido num Postgres local):** `RetroCatalogGame` ocupa ~180 bytes por linha com o índice. O RA tem de 10 a 15 mil jogos com conquistas, então **~2 a 3 MB**. Cada stub criado custa ~1,35 KB (linha `Game` com os 9 índices, ~1,2 KB, mais o `GamePlatformLink`, ~150 bytes). No pior caso, se nenhum dos ~10 a 11 mil conjuntos principais casar com o catálogo, são **~15 MB**. Na prática menos, porque os jogos de Nintendo e PlayStation já estão no catálogo pelo IGDB e só ganham o vínculo. As conquistas lidas sob demanda custam ~14 KB por jogo aberto (~40 conquistas de ~350 bytes). O total fica abaixo de 2% do 1 GB do Neon.

**Custo de computação:** a primeira rodada leva alguns minutos (cerca de 45 consoles e ~25 lotes de 500 jogos). As seguintes levam ~1 min, porque só reescrevem o que mudou. Uma vez por semana, com o banco já acordado, fica abaixo de 0,5 CU-h por mês. A leitura sob demanda é uma requisição curta por jogo (na Vercel, uma vez por conjunto). Segredos do repositório: `DATABASE_URL`, `RA_API_KEY` e `RA_USERNAME`; sem `RA_API_KEY` o worker sai com erro. Disparo manual: `gh workflow run retro-catalog.yml -f minutes=30`.

### Agendamento (pronto para o `vercel.json`)

O repositório ainda não tem `vercel.json` (a configuração de deploy fica para o plano de produção). Os horários sugeridos, em UTC, já estão no formato da chave `crons`; basta colar no `vercel.json` ao configurar o deploy. A Vercel chama cada rota com `GET` e, quando a variável `CRON_SECRET` existe no projeto, envia `Authorization: Bearer $CRON_SECRET` sozinha. No plano Hobby a Vercel só aceita jobs diários: lá, use `0 3 * * *` (ou outro horário diário) para `news`, `platforms` e `users`.

<!-- crons:start -->
```json
{
  "crons": [
    { "path": "/api/cron/news", "schedule": "0 * * * *" },
    { "path": "/api/cron/platforms", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/users", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/catalog", "schedule": "0 3 * * *" },
    { "path": "/api/cron/rarity", "schedule": "30 3 * * *" },
    { "path": "/api/cron/media", "schedule": "0 4 * * *" },
    { "path": "/api/cron/notifications", "schedule": "15 5 * * *" },
    { "path": "/api/cron/steam-catalog", "schedule": "20 * * * *" },
    { "path": "/api/cron/releases", "schedule": "40 */6 * * *" },
    { "path": "/api/cron/igdb-catalog", "schedule": "50 * * * *" },
    { "path": "/api/cron/highscores", "schedule": "5 3 * * *" }
  ]
}
```
<!-- crons:end -->

| Job | Quando | Por quê |
| --- | --- | --- |
| `news` | de hora em hora | manchetes externas chegam o dia todo |
| `platforms` | a cada 15 min | cada execução lê só 5 contas PSN/Xbox/RA |
| `users` | a cada 30 min | contas Steam desatualizadas, poucas por vez |
| `catalog`, `rarity`, `media` | 1x por dia, de madrugada (horário de Brasília) | dados que mudam devagar |
| `notifications` | 1x por dia | apaga notificações com mais de 90 dias |
| `steam-catalog` | de hora em hora | catálogo completo da Steam: lista de apps (incremental), popularidade e detalhes dos jogos mais procurados, um pouco por vez |
| `releases` | a cada 6 h | listas de lançamentos da Steam e datas do IGDB mudam ao longo do dia |
| `igdb-catalog` | de hora em hora | catálogo de consoles do IGDB, 500 jogos por requisição, um pouco por vez (sem as chaves do IGDB, não faz nada) |
| `highscores` | 1x por dia, 00:05 em Brasília | a foto do ranking no começo do dia é a referência das setas de amanhã |

A lista é a mesma de `CRON_SCHEDULES` em `src/lib/cron/schedules.ts`; um teste falha se as duas divergirem ou se algum job ficar sem horário.

## Manchetes externas por área

Cada feed RSS de `/admin/feeds` tem uma **área** (`NewsFeed.area`), e cada manchete guardada leva a área do feed (`ExternalNews.area`). Só título, link, fonte e data são guardados, nunca o texto; o leitor SSRF de sempre (`src/lib/integrations/rss`) lê os feeds. A regra de cada área fica em `src/lib/news/areas.ts` (com testes) e olha só o título:

| Área | Mantém | Onde aparece |
| --- | --- | --- |
| Games | manchetes que citam um jogo do catálogo (nome ou nome alternativo) | página do jogo, "Em circulação" |
| Entretenimento | animes, filmes e séries **ligados a games**, só com um sinal de games no título: termo de games (`jogo`, `game`, `videogame`, `PlayStation`, `Xbox`, `Nintendo`, `Steam Deck`…) ou franquia sem ambiguidade (`The Last of Us`, `Pokémon`, `Resident Evil`, `Elden Ring`…). Nomes que também são palavras comuns ou pessoas (`Steam`, `Fallout`, `Kirby`, `Halo`, `Control`, `Hades`, `Cyberpunk`, `Yakuza`, `Sonic`, `Arcane`…) e nomes do catálogo sozinhos não contam: só com outro sinal no mesmo título (o filme "Ready or Not 2" não é o jogo). Falsos amigos (`Jogos Vorazes`, `Jogos Mortais`, `O Jogo da Imitação`, `Game of Thrones`, `Round 6`, `está em jogo`…) são tirados do título antes da busca. A manchete só é ligada a um jogo do catálogo quando tem esse sinal. | aba Entretenimento (home e `/noticias`), filtro `?categoria=entretenimento` ("Na imprensa"); "Em circulação" e página do jogo só quando ligada a um jogo |
| Tecnologia | o que Entretenimento manteria, mais hardware e IA (`GPU`, `placa de vídeo`, `RTX`, `Ryzen`, `console`, `IA`, `inteligência artificial`, `ChatGPT`, `OpenAI`…; siglas curtas como `IA`/`AI`/`PC` só em maiúsculas) | aba Tecnologia, filtro `?categoria=tecnologia`; "Em circulação" e página do jogo só quando ligada a um jogo (hardware/IA sozinhos nunca ligam) |

O "Em circulação" ("da imprensa de games") lê só os feeds de Games e as manchetes de Entretenimento/Tecnologia ligadas a um jogo (`getWireHeadlines`). O cron `news` invalida o cache das notícias (`revalidateTag("news", "max")`) quando guarda manchetes novas. Trocar a área de um feed no admin não muda as manchetes já guardadas.

Nas abas, as matérias do Tralked vêm primeiro e as manchetes depois, sempre marcadas como externas: "Imprensa" no chapéu, "Fonte externa: <publicação>" e "abre em nova aba" (link com `target="_blank" rel="noopener noreferrer"`).

Feeds sugeridos (conferidos em 31/10/2026: https, RSS válido, sem redirecionamento), em `src/lib/news/feed-catalog.ts`: Entretenimento: Legião dos Heróis, AnimeNew, IGN Movies, IGN TV, Anime News Network; Tecnologia: Tecnoblog, TecMundo, Adrenaline, Canaltech, Tom's Hardware, The Verge (IA). O **seed os cadastra pausados** (desenvolvimento e testes nunca buscam a internet) e `pnpm news:feeds` os cadastra **ativos** num banco real (`--paused` para deixar o admin ativar). Depois disso, o admin cuida deles em `/admin/feeds` (agrupados por área: pausar, editar, mudar a área, excluir).

## SEO, privacidade e páginas de sistema

- `sitemap.xml` (jogos, guias publicados, notícias publicadas, tópicos visíveis do fórum e páginas fixas) e `robots.txt` (bloqueia `/admin`, `/conta`, `/api`, `/notificacoes`, `/newsletter` e `/confirmar-email`) usam `APP_URL` como origem pública: defina a URL de produção também no build, porque os dois arquivos são gerados nele.
- JSON-LD com `src/lib/seo/json-ld.tsx`: `NewsArticle` nas notícias, `HowTo` nos guias e o helper `videoGameJsonLd()` para a página do jogo (`<JsonLd data={videoGameJsonLd(game)} />`). O texto vai escapado (`<`, `>`, `&`), então título de usuário ou robô nunca fecha o `<script>`.
- Imagem padrão de compartilhamento: `src/app/opengraph-image.tsx`, com a fonte Archivo Expanded em `assets/fonts` (licença OFL em `assets/fonts/OFL.txt`).
- `/privacidade`, `/termos` e `/licencas`. O e-mail de contato `contato@tralked.example` é **provisório** (`src/lib/legal/contact.ts`); troque antes do lançamento.
- Banner de cookies: só cookies necessários por padrão; a escolha fica no cookie `tk_consent` (1 ano) e pode ser trocada em `/privacidade#cookies`. Qualquer cookie opcional futuro (medição, anúncios) deve checar `optionalAllowed()` de `src/lib/consent.ts`.
- `AdSlot` (`src/components/ui/AdSlot.tsx`): reserva o espaço do anúncio, marcado "Publicidade", sem script de terceiros. Fica na página de notícia.
- Newsletter com confirmação dupla: o formulário grava `NewsletterSubscriber` sem confirmação. Ainda não há provedor de e-mail: **fora de produção o link de confirmação sai no console do servidor** (`[newsletter] Link de confirmação ...`); em produção o endereço só fica registrado e o formulário diz "Inscrição registrada". O link (`/newsletter/confirmar?email=&token=`) vale 7 dias (token = validade + HMAC do e-mail com `SESSION_SECRET`) e só abre a página: a confirmação é um POST pelo botão "Confirmar inscrição", então leitores de e-mail que pré-abrem links não confirmam nada. Limites em memória por instância: 5 inscrições por IP a cada 10 min e 1 e-mail por endereço a cada 10 min. Futuro: provedor por env (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`), ligado em `deliver()` de `src/lib/newsletter/subscribe.ts`.
- `Article.comments` (contagem nos cards e no topo da notícia) é recontado a cada comentário criado, apagado pelo autor ou ocultado/removido/restaurado pela moderação. Para consertar contadores antigos: `DATABASE_URL=... pnpm comments:recount` (só atualiza os que divergem; o seed também reconta).
- Notificações: sino no topo (não lidas + as 8 últimas, "marcar todas como lidas") e `/notificacoes` com paginação. Cada notificação vive 90 dias (cron `notifications`).

## Scripts

| Script | Descrição |
| --- | --- |
| `pnpm dev` | Servidor de desenvolvimento. |
| `pnpm build` / `pnpm start` | Build e servidor de produção. |
| `pnpm lint` | ESLint. |
| `pnpm test` | Vitest (todas as suítes). Exige `DATABASE_URL` de um banco de teste; veja abaixo. |
| `pnpm test:db` | Apenas a suíte de conexão com o banco (mesma exigência). |
| `pnpm db:up` | `docker compose up -d` (Postgres). |
| `pnpm db:migrate` | `prisma migrate dev`. |
| `pnpm db:seed` | Popula o banco com dados de exemplo. |
| `pnpm db:generate` | `prisma generate` (também roda no `postinstall`). |
| `pnpm catalog:bootstrap` | Catálogo real da Steam (`--limit N` jogos populares, `--concurrency N`, `--only-top`). Exige `DATABASE_URL`. |
| `pnpm comments:recount` | Reconta `Article.comments` pelos comentários visíveis. Exige `DATABASE_URL`. |
| `pnpm sample:rename [--dry-run]` | Renomeia os personagens fictícios de um banco semeado antes do Plano 4 (seed, bylines, notificações). Idempotente. Exige `DATABASE_URL`. |
| `pnpm highscores:backfill [--dry-run] [--snapshot]` | Grava os totais dos Highscores (`UserRankStats`) de todos os usuários a partir da biblioteca e das conquistas válidas (só essa tabela; XP, missões e atributos ficam como estão) e, com `--snapshot`, tira a foto do dia dos rankings (o mesmo que o cron `highscores`). Idempotente. Exige `DATABASE_URL`. |
| `pnpm news:feeds [--dry-run] [--paused]` | Cadastra os feeds de manchetes de Entretenimento e Tecnologia (`src/lib/news/feed-catalog.ts`), ativos (ou pausados com `--paused`). Idempotente: feed já cadastrado (mesma URL) nunca é alterado. Exige `DATABASE_URL`. |
| `pnpm steam:players [--limit 2000] [--concurrency 16]` | Amostra os jogadores atuais na Steam dos jogos mais populares e grava atual, pico do dia e maior pico medido (veja "Jogadores na Steam"). Exige `DATABASE_URL`. |
| `pnpm retro:catalog [--minutes 30] [--no-stubs]` | Importa o catálogo do RetroAchievements (jogos com conquistas, leve) e liga cada jogo ao catálogo ou cria um stub (veja "Catálogo do RetroAchievements"). Exige `DATABASE_URL` e `RA_API_KEY`. |
| `pnpm steam:import` | Importa um perfil Steam público (`<id64\|vanity> [--admin] [--verified] [--psn <onlineId>]`). Exige `DATABASE_URL`. |
| `pnpm api:key` | `"<nome>" <escopo>...`: cria uma chave de robô e imprime o segredo `tk_live_…` uma vez (só no terminal). Exige `DATABASE_URL`. |
| `pnpm user:invite` | `<handle> <email>`: grava o e-mail de login de uma conta e imprime um link de "definir senha" (1 h, uso único; só no terminal). Exige `DATABASE_URL`; o link usa `APP_URL`. |
| `pnpm e2e` | Playwright + axe contra o build de produção (`pnpm build && pnpm start -p 3200`): rotas públicas. |
| `pnpm e2e:dev` | Playwright + axe contra `next dev -p 3200`: inclui as rotas que exigem login de demonstração. |
| `pnpm e2e:screens` | Screenshots de todas as rotas (1440×900 e 390×844) em `e2e/__screens__/` (ignorado pelo controle de versão). |

## Testes (Vitest)

As suítes do projeto `node` (`src/**/*.test.ts`) gravam no Postgres: criam e apagam chaves, notícias, guias e comentários. Por isso rodam só contra um banco dedicado a testes. `vitest.db-guard.ts` interrompe a execução com um erro claro quando `DATABASE_URL` não está definida ou aponta para `gamelog` (o banco padrão) ou `gamelog_dev` (o banco do servidor de desenvolvimento). O Vitest não lê `.env` nem `.env.local`, então passe a URL na mesma linha do comando:

```bash
docker exec gamelog-db createdb -U gamelog gamelog_test
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm db:seed
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm test
```

No PowerShell: `$env:DATABASE_URL='postgresql://gamelog:gamelog@localhost:5433/gamelog_test'; pnpm test`.

## Testes e2e (Playwright + axe)

Instale o navegador uma vez: `pnpm exec playwright install chromium`.

Os testes sobem o próprio servidor na porta **3200** (outra com `E2E_PORT`, para rodar worktrees em paralelo) e usam um banco só deles, nunca o do servidor de desenvolvimento. O contexto do navegador já leva o cookie `tk_consent`, para o banner de cookies não cobrir a página; `e2e/system.spec.ts` testa o banner com um visitante novo e a home sem JavaScript. Crie e popule o banco e, se quiser outro nome, exporte a URL:

```bash
docker exec gamelog-db psql -U gamelog -d postgres -c "CREATE DATABASE gamelog_e2e"
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm db:seed
export E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e   # padrão se omitido
pnpm e2e
```

Dois modos, porque o login de demonstração (`/api/auth/demo`) não existe em produção e isso não é afrouxado:

- `pnpm e2e`: `pnpm build && pnpm start -p 3200`. Valida o que vai para produção; rotas marcadas `auth` são puladas.
- `pnpm e2e:dev` e `pnpm e2e:screens`: `next dev -p 3200`. `loginAsDemo(page)` (em `e2e/helpers.ts`) funciona e as rotas com login rodam.

`e2e/routes.ts` exporta `ROUTES`, a lista central validada por smoke (status 200), screenshots e axe (sem violações `serious`/`critical`). Toda página nova deve ser acrescentada ali.

`e2e/flows.spec.ts` cobre os fluxos críticos nos dois modos: robô cria notícia com chave feita em `/admin/robos` e um editor publica; payloads malformados e repetição de `Idempotency-Key`; foto com tipo falso, visitante e outra origem recusados; comentário, curtida, resposta no fórum e "Resolveu"; fraude confirmada anula XP e recalcula o nível; 404 em `/admin` e Server Actions recusadas para quem não tem o papel; newsletter com confirmação dupla. `loginAs(page, handle)` (em `e2e/helpers.ts`) assina um cookie de sessão com o segredo do servidor de e2e, então esses fluxos agem como qualquer usuário do seed também no build de produção. A configuração recusa `E2E_DATABASE_URL` apontando para `gamelog` ou `gamelog_dev`.

`e2e/auth.spec.ts` cobre a conta do Tralked nos dois modos: visitante em `/jogador/me` vai para `/entrar`; cadastro cai em Conexões; sair e entrar; senha errada e e-mail desconhecido com a mesma mensagem; "esqueci a senha" (mesma resposta para qualquer e-mail; o link é lido de `DEV_MAIL_LOG_FILE`, que a configuração aponta para um arquivo temporário; no modo prod ele não é gravado e o teste é pulado) e link de uso único. Contas criadas ali começam com `e2e_` e são apagadas no início. O cadastro aceita 5 contas por IP por hora: rode a suíte uma vez por servidor.

`e2e/connections.spec.ts` cobre `/conta/conexoes`: no modo dev, vários campos salvos de uma vez (Steam privada recusada com a ajuda de privacidade; depois Steam, PSN, Xbox e RA conectadas sem código, "não verificada", e importadas em segundo plano), conta já em outro perfil recusada e reivindicada com o código (a conta passa, o perfil anterior é notificado), Steam de conta antiga recusada ao digitar e recuperada só pela reivindicação (`Taverneira_Gerta`), e esvaziar um campo pede confirmação (cancelar, Esc, confirmar); com axe no estado de reivindicação e com o diálogo aberto. No build de produção (sem as chaves e sem `PLATFORM_FIXTURES`), PSN/Xbox/RA aparecem "Em breve". O teste grava no banco o código que o perfil da fixture mostra, como se a pessoa o tivesse colado. Contas criadas ali começam com `e2c_` e são apagadas no início.

`e2e/brand-nav.spec.ts` cobre o slogan, o menu "Jogos" (mouse, teclado, gaveta do celular, com axe), o "Em circulação" sem fim (dá a volta inteira numa tela de 2560 px sem mostrar a ponta do rolo e não para no fim) e "Não mostrar a animação nos próximos jogos" (deslogado, e logado com a reativação em `/conta`, usando `Guardia_Selene`).

## Validação completa

Antes de entregar, rode na pasta `app/` (com um banco de teste próprio):

```bash
pnpm lint
pnpm exec next typegen && pnpm exec tsc --noEmit   # typegen gera os tipos PageProps/LayoutProps das rotas
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm test
pnpm build
E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm e2e       # build de produção
E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm e2e:dev   # inclui rotas logadas e screenshots
```

Revisão visual: as screenshots ficam em `e2e/__screens__/` (1440×900 e 390×844). O detector do skill `impeccable` roda nos arquivos (`DO_NOT_TRACK=1 npx impeccable detect src`) e nas páginas de um servidor no ar (`npx impeccable detect http://localhost:PORTA/`). Os rótulos mono de 10–10,5 px (chips de plataforma, categorias) e a etiqueta do selo do jogo são da identidade aprovada (handoff + `../preview/`) e ficam como estão.

## Estrutura

```
prisma/               schema, migrations e seed
src/app/              rotas (App Router)
  /                   home com notícias, ranking e missão diária
  jogos/[slug]        página do jogo e /guia (guia 100% com votos)
  jogador/[handle]    perfil público (ficha); /jogos, /conquistas, /estatisticas e /desejos (lista de desejos)
                      são as seções; /jogador/me redireciona para o seu
  highscores          rankings: nível, /horas, /conquistas, /raras, /platinas, /acervo (+ /<plataforma>), /genero/<habilidade>
  familia             modo família e convites; biblioteca da família paginada, com busca e filtros
  noticias/[slug]     artigos
  desenvolvedores     documentação da API para robôs (também em ../docs/robos.md)
  admin               painel da redação (editor/admin): notícias e guias em blocos, fila de revisão,
                      moderação, fraude, jogos, chaves de robô, feeds e papéis (só admin nos 5 últimos)
  api/v1              API para robôs: notícias, guias, busca de jogos, OpenAPI e JSON Schemas
  entrar, cadastrar   login e cadastro com e-mail + senha; esqueci-senha, redefinir-senha e confirmar-email
  api/auth            login Google, demo e logout
  api/cron/[job]      jobs de sincronização
src/components/       componentes de UI
src/lib/
  engine/             regras puras: XP, vocação, habilidades, streak, missões, antifraude
  integrations/       clientes Steam, IGDB, RAWG, SteamGridDB, PSN, Xbox (OpenXBL), RetroAchievements e RSS (com fixtures)
  sync/               sincronização de catálogo, usuários Steam, contas PSN/Xbox/RA, mídia e notícias externas
  accounts/           conexões de Steam/PSN/Xbox/RA: connect.ts (salvar sem código), link.ts (reivindicar
                      com código, desvincular), steam-link.ts (Steam e contas antigas) + Server Actions
  progression/       recálculo de XP/habilidades a partir do ledger e chaves de período
  queries/            consultas ao banco usadas pelas páginas
  auth/               sessão (jose), e-mail + senha (scrypt), limites de tentativas, links de definir senha,
                      login Google (OAuth + PKCE), confirmação de e-mail (link assinado)
  mail/               e-mail transacional: Resend (ou log no dev), modelos pt-BR com a marca
  family/             regras do modo família
  guide/              votos nos passos dos guias
  api/                API para robôs: chaves (hash SHA-256), escopos, limite de 60 req/min por chave
                      (em memória: com várias instâncias cada uma conta à parte), idempotência e erros
  admin/              regras do admin: acesso por papel, CMS, moderação (anula XP ao remover), fraude
src/proxy.ts          /admin responde 404 de verdade a quem não é da redação (as páginas e as
                      Server Actions conferem o papel de novo)
```

## Deploy (checklist)

1. **Migrations antes do build**: `DATABASE_URL=... pnpm exec prisma migrate deploy`. O `next build` pré-renderiza páginas que leem tabelas novas (os Highscores leem `UserRankStats` e `RankSnapshot`), então o build falha ou sai vazio num banco sem elas.
2. `pnpm build` e o deploy.
3. **Depois do deploy, uma vez por banco anterior ao Plano 4 (F6)**: `DATABASE_URL=... pnpm highscores:backfill --dry-run` para conferir e `DATABASE_URL=... pnpm highscores:backfill --snapshot` para gravar os totais de todos os usuários e a primeira foto dos rankings (as setas aparecem a partir do dia seguinte). Sem isso, os rankings de horas, conquistas, raras, platinas e acervo só mostram quem sincronizou depois do deploy.
4. Agende os crons (veja "Agendamento"), inclusive o diário `highscores`.

## Notas

- `next build` precisa do banco acessível: as páginas dinâmicas (`/jogos/[slug]`, `/noticias/[slug]`, `/jogador/[handle]`) usam `generateStaticParams`, que consulta o Postgres. Suba e popule o banco antes (`pnpm db:up && pnpm db:seed`).
- As suítes de teste que usam o banco (`pnpm test`) também precisam do Postgres no ar e das migrations aplicadas.
- Admin: entre como `lucas` (`/entrar` com as credenciais de desenvolvimento do seed, ou `/api/auth/demo`; o seed dá papel admin) e abra `/admin`. Papéis: `editor` cuida de notícias, guias, revisão e moderação; `admin` também de fraude, jogos, robôs, feeds e usuários. Ninguém muda o próprio papel.
- O projeto usa Next.js 16 com Cache Components; veja `AGENTS.md` antes de alterar convenções do framework.
- Listas paginadas (`/jogos`, `/familia`, seções do perfil): estado na URL (`?pagina=&por=10|20|40|80&q=…`), com `components/ui/Pagination.tsx` e `components/ui/ListSearch.tsx`. A busca por nome ignora acentos, maiúsculas e pontuação: `Game.searchName` é escrito por um gatilho do banco (`tralked_search_name`, extensões `unaccent` e `pg_trgm`, migration `20261102100000_game_name_search`) e tem índice trigram; em `/jogos` a busca também acha os jogos do catálogo completo ainda sem detalhes (só a partir de 3 caracteres: com menos não há trigramas e a busca fica nos jogos com detalhes).
  - Postgres hospedado: a função chama `public.unaccent('public.unaccent', …)`, então a extensão `unaccent` precisa estar no schema `public` (onde `CREATE EXTENSION` a põe por padrão); em provedores que instalam extensões em outro schema (ex.: `extensions`), ajuste a função antes de aplicar a migration. Os separadores são uma lista explícita (funciona com LC_CTYPE C/POSIX); com C/POSIX, `lower()` só converte ASCII, igual nos nomes e nas buscas.
  - As migrations `20261102100000_game_name_search` e `20261102110000_game_search_fold_v2` reescrevem `searchName` de todo o catálogo num único `UPDATE` (bloqueia escrita nessas linhas durante a passada, segundos com ~150 mil jogos; leituras seguem): aplique fora de um import do catálogo em andamento.
- Emulador web (SNES/PS1 no navegador): planejado (`../docs/superpowers/specs/2026-10-31-emulador-web-plano-lucas.pdf`), ainda não implementado. Nenhuma rota `/jogar` existe nesta versão.
- E-mail: pela Resend com `RESEND_API_KEY` (veja "E-mail transacional (Resend)"). Sem a chave, em desenvolvimento os e-mails saem no console do servidor; em produção nada é enviado e as telas avisam (esqueci a senha, newsletter, confirmação em `/conta`). `pnpm user:invite` continua imprimindo o link no terminal.
