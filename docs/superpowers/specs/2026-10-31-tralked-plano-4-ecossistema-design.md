# Tralked — Plano 4: ecossistema gamer completo

Data: 2026-10-31. Pedido do Lucas (lista longa no chat, resumida abaixo com as palavras dele quando importam). Ele pediu para seguir sem perguntas; as decisões marcadas **(controller)** são minhas. O emulador (Plano 3) fica pausado e vai por último.

## Por quê

"Minha meta é recompensar todos os gamers": quem tem 3000 h de PUBG e poucas conquistas tem que ser recompensado tanto quanto quem caça conquistas, de forma equilibrada e com competitividade justa. A biblioteca tem que ficar "completíssima", com todos os jogos e artes, e o site tem que funcionar "igual o Exophase": a pessoa informa o perfil e o Tralked encontra e sincroniza tudo sozinho.

## Anti-objetivos

- Nada de complexidade de segurança na conexão agora ("por enquanto não quero toda essa complexidade"): sem código, sem verificação obrigatória. (Mantém-se só a regra invisível de uma conta de plataforma por perfil — controller.)
- Nomes de pessoas reais da internet nos dados de exemplo.
- XP de horas que deixe "idle farming" valer mais que jogar de verdade; conta comprada e nunca jogada rendendo XP.

## Frentes

### F1 — Sincronização completa (Steam integrada; PSN/Xbox "do jeito mais fácil")
- **Steam com `STEAM_API_KEY`** (o Lucas cadastra): biblioteca inteira (`GetOwnedGames` com `include_played_free_games` e `include_appinfo`, incluindo jogos nunca jogados), horas por jogo (`playtime_forever`), últimas 2 semanas, conquistas de **todos** os jogos com conquistas (`GetPlayerAchievements` + `GetSchemaForGame`), wishlist (verificar o endpoint atual, ex.: `IWishlistService/GetWishlist/v1`). Jogos fora do catálogo são criados na hora (já existe `syncGame`).
- **Catálogo completo da Steam**: importar a lista de **todos** os apps do tipo jogo (`IStoreService/GetAppList` paginado, com a chave) em `Game` (appid, nome), de forma idempotente e incremental (cron diário com `last_appid`/`if_modified_since`). Detalhes (descrição, gêneros, datas, preço não) e esquema de conquistas são buscados sob demanda (quando alguém tem o jogo ou abre a página) e por um cron ordenado por popularidade, respeitando os limites da Steam. **Artes** vêm do CDN da Steam pelo appid (capsule/header/library 600×900/hero/logo), sem API; checar existência antes de gravar e cair para IGDB/SteamGridDB quando faltar.
- **PSN e Xbox**: igual ao Exophase — a pessoa digita o ID/gamertag e o Tralked coleta jogos, troféus/conquistas e **tempo de jogo onde a plataforma expõe** (PSN: jogos jogados com `playDuration` em PS4/PS5; Xbox: histórico de títulos + minutos jogados via OpenXBL). Exigem as credenciais de serviço (`PSN_NPSSO`, `XBOX_OPENXBL_KEY`); sem elas, "Em breve" (já implementado).
- Sem chave Steam (dev), o modo atual de sondagem continua funcionando.

### F2 — Horas e biblioteca como RPG (equilíbrio)
- **XP por horas (controller)**: por jogo e plataforma, marcos de horas acumuladas `1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000`. Cada marco paga uma vez (ledger `source = 'playtime'`, `sourceKey = '<platform>:<gameId>:<marco>'`, imutável). Valor do marco = `round(2000 · (m^0.7 − m_anterior^0.7))` — acumulado ≈ `2000 · h^0.7` (10 h ≈ 10 mil XP; 100 h ≈ 50 mil; 3000 h ≈ 540 mil; para comparação, uma conquista vale 1,5–40 mil). Só horas reais da plataforma; nenhum XP para jogo com 0 h.
- **Atributos novos (controller)**: **Resistência** (horas totais jogadas) e **Acervo** (jogos jogados + metade dos possuídos e nunca jogados), na mesma mecânica de atributos existente (`AttributeProgress`), visíveis na ficha.
- Recompute e fraude: entradas de playtime entram no recompute; desvincular uma conta anula as de playtime daquela plataforma (mesmo caminho de anulação).

### F3 — Perfil completo (estilo Exophase)
Qualquer perfil público mostra (e o dono vê o próprio):
- **Jogos**: lista da biblioteca (todas as plataformas) com capa, horas, % de conquistas, última vez jogado, ícones de plataforma; ordenar por horas/recentes/conclusão/nome; filtros por plataforma; jogos nunca jogados em seção própria.
- **Conquistas**: todas as conquistas do usuário com raridade e data, filtro por jogo/plataforma; destaque **"Mais raras"**.
- **Estatísticas**: horas totais (e por plataforma), jogos possuídos/jogados/100%, média de conclusão, conquistas por plataforma e por ano, jogo mais jogado.
- **Wishlist** (Steam).
- **Horas jogadas visíveis** no cabeçalho do perfil.
- **Família**: "Biblioteca da família" somando os jogos de todos os integrantes, com quem tem cada jogo.

### F4 — Login Google e e-mail
- **E-mail transacional** com Resend (`RESEND_API_KEY`, remetente `no-reply@tralked.com`, domínio verificado no Cloudflare pelo Lucas): redefinir senha, confirmar e-mail (não bloqueia o uso; selo "e-mail confirmado"), boas-vindas. Sem chave: log no dev, como hoje. Templates em pt-BR com a marca.
- **Login com Google** já existe no código: documentar e ativar (`GOOGLE_CLIENT_ID/SECRET`, redirect `https://tralked.com/api/auth/google/callback`); botão em /entrar e /cadastrar.

### F5 — Marca, navegação e capinha
- Slogan: trocar "Feito por pessoas que amam jogar" por **"Tralked — Seu ecossistema gamer"** (cabeçalho, rodapé, metadata, imagem social).
- **Menu Jogos**: ao passar o mouse (e ao focar pelo teclado), abre opções por plataforma, **Steam / PC primeiro**, depois PlayStation, Xbox, Nintendo, Retro (filtros do catálogo).
- **"Em circulação"**: rolo infinito — depois do último volta ao primeiro sem travar nem parar (loop contínuo, respeitando pausa e reduced-motion).
- **Capinha**: opção visível durante a abertura do lacre: "Não mostrar a animação nos próximos jogos" (lembra no aparelho e, logado, na conta; dá para reativar em /conta).
- **Label do disco** diferente da capa e do fundo da página (controller: screenshot do jogo ou logo sobre cor da arte; nunca a capa nem o hero).
- **Miniaturas de vídeo** sem repetir: cada vídeo com a própria miniatura (thumbnail do próprio trailer Steam/YouTube).
- **Vídeo de fundo estilo Netflix** em um banner específico (o banner da página do jogo, atrás da capinha/livreto): trecho de gameplay em loop, mudo, com vinheta, bem sutil, sem atrapalhar a leitura. Controller: usar o mp4 do trailer da Steam já guardado (`GameMedia`), com fallback YouTube nocookie; desligado com reduced-motion/economia de dados; pausa fora da tela.
- **Nomes de exemplo**: trocar todos os usuários/autores fictícios (@BillyButcher, ZeroJimmy, MotocaGamer, Fuyushiro, urso, Nyx_Vortex, KairoBR, ValkyrieZero, LunaDeFerro, Rivia, Al1enado, NascimentoRE e os demais) por nomes de NPC inventados (pt-BR, estilo RPG; nada que seja handle conhecido). Manter usuários reais: MrDead_ (e Diguzz, que vai se recadastrar). Controller: `lucas` (conta demo de dev com o nome do dono) fica. Aplicar no seed, nos testes e — por script — no `gamelog_dev`.

### F6 — Highscores dopaminérgico
Tela mais bonita e animada: pódio animado do top 3, contagem subindo, barras de XP animadas, setas de subida/queda, "você está aqui" fixo, categorias: Nível, **Horas jogadas**, Conquistas, Raras/Lendárias, Platinas/100%, Acervo, por gênero/plataforma. Respeitar reduced-motion; acessível.

### F7 — Notícias: entretenimento e tecnologia
Novas categorias **Entretenimento** (animes, filmes, séries — só o que tem relação com games) e **Tecnologia** (inclui IA, onde o Lucas vai publicar matérias), com abas na home/notícias, filtros, feeds RSS externos dessas áreas (só manchete + link, como já funciona) e as categorias disponíveis no CMS e na API de robôs.

### F8 — Calendário / timeline
`/calendario`: visão de mês e linha do tempo do que aconteceu e do que vai acontecer: matérias publicadas por dia, lançamentos de jogos (datas do catálogo), eventos/missões, e — logado — as conquistas e marcos de horas do próprio usuário (no perfil de outro, os dele se o perfil for público).

### F9 — Social
- **Mensagens privadas** entre usuários: conversa 1:1, caixa de entrada, enviar pelo perfil, notificação, limite de envio, bloquear e denunciar, texto puro (sem HTML), apagar a conversa para si.
- **Seguir** jogadores e **feed** de atividade de quem você segue (conquistas raras, 100%, marcos de horas, matérias, fotos).
- **Amizade** (pedido + aceite) **sem unir à família**. Regra do Lucas: amigo é automaticamente seguidor — ao enviar o pedido, quem pede passa a seguir; ao aceitar, os dois se seguem; quem não é amigo pode ser só seguidor (seguir não exige aprovação). Desfazer a amizade não deixa de seguir (cada um decide se continua seguindo); perfil mostra seguidores, seguindo e amigos; mensagens privadas podem ser restritas a amigos/seguidos pelo próprio usuário.
- **Comentários sociais** (Lucas: "curtir, descurtir e comentar nos comentários de outras pessoas, responder"): curtir/descurtir comentários e responder em fio (até 2 níveis) em notícias, guias, fotos e fórum; notificação de resposta/curtida.
- **Recompensa por interação saudável** (controller): XP para quem **recebe** curtida em comentário (ledger `source='comment_liked'`, valor baixo, teto diário por usuário) e para resposta marcada como útil pelo autor do comentário original (`comment_helpful`); quem curte não ganha XP; curtida própria não conta; pares que trocam curtidas entre si param de render após 3 por dia; novo atributo **Carisma** (curtidas recebidas, respostas úteis, amigos). Descurtidas não tiram XP; comentário com saldo muito negativo fica recolhido ("ver mesmo assim"). Bloquear um usuário impede mensagens, respostas e menções dele. Denúncia/moderação existentes valem para tudo; comentário removido anula o XP que gerou.

### F10 — Lançamentos (últimos e próximos)
Pedido: "conectar com alguma fonte que mostrasse os próximos lançamentos e os últimos… card na tela principal… principalmente do PC".
- Fontes (controller): **Steam Store** para PC (listas públicas de novos lançamentos e "em breve", ex. `store.steampowered.com/api/featuredcategories` — verificar o formato atual; sem chave), e **IGDB** `release_dates` por plataforma (PS5/PS4, Xbox Series/One, Switch, PC) quando `IGDB_CLIENT_ID/SECRET` existirem. Cron a cada 6 h; jogos desconhecidos entram no catálogo (`syncGame`).
- **Card "Lançamentos" na home**: abas **Últimos** (últimos 30 dias) e **Próximos** (próximos 90 dias), PC primeiro, filtro por plataforma; capa, data (ou "a definir"), plataformas; link para a página do jogo.
- Página `/lancamentos` com a lista completa e os mesmos filtros; os lançamentos alimentam o calendário (F8).
- **Catálogo completo de consoles** (Lucas: "não esqueça de escanear todos os jogos possíveis"): com as chaves IGDB, importar todos os jogos das plataformas PlayStation (PS1–PS5), Xbox (todas), Nintendo (Switch e anteriores) e PC que não estejam no catálogo, como stubs (nome, plataformas, IGDB id, data), paginado e retomável (cursor em `SyncCursor`), respeitando o limite da IGDB; casar com jogos já existentes (Steam appid/IGDB id/nome normalizado) para não duplicar; detalhes e arte pela mesma fila de prioridade. Somado ao catálogo Steam completo (F1), a busca de `/jogos` encontra "todos os jogos possíveis".

### F11 — Jogos e Família organizados (paginação)
Pedido: "não ficar tudo mostrando numa lista infinita, até uns 80 por página, escolha de no mínimo 10 por página, ou algo que deixe mais bonito".
- `/jogos`: grade de capas com **paginação numerada** (anterior/próxima, primeira/última, reticências), seletor **10 / 20 / 40 / 80 por página** (padrão 40), filtros e ordenação no topo (plataforma, gênero, popular, nome, lançamento, "quase lá"); estado na URL (`?pagina=&por=&…`), funciona sem JS; contagem "X jogos no catálogo"; stubs fora.
- `/familia`: resumo dos integrantes no topo; **biblioteca da família** em grade paginada com o mesmo seletor; filtro por integrante, "todos têm"/"só alguém tem"; seções organizadas em vez de uma lista única.
- **Buscador por nome** nas duas páginas (Lucas): campo no topo, resultado enquanto digita (debounce) e também por envio sem JS; ignora acentos e maiúsculas; mantém filtros e volta à página 1. Em `/jogos` a busca **inclui os jogos do catálogo completo ainda sem detalhes** (stubs), marcados "detalhes em breve" (controller: achar qualquer jogo da Steam pelo nome é o que torna a biblioteca "completíssima"); exige índice de busca adequado para ~150k nomes (ex. `pg_trgm` + `unaccent`, ou coluna normalizada indexada). Na Família, busca dentro da biblioteca da família.
- O mesmo componente de paginação (e o buscador) serve à lista de jogos do perfil (F3).

### F12 — Do guia e da notícia para a página do jogo
Pedido: "se eu abrir o guia do jogo ou uma notícia referente ao jogo, consiga ir para a página do game também".
- **Notícia**: logo abaixo do título, chips com capa real (arte do catálogo) e nome de cada jogo ligado, com "Ver jogo" (página do jogo) e "Guia 100%" quando existir; o bloco do fim ("Jogo desta notícia") passa a ter os dois links (hoje só leva ao guia quando há guia). Stubs aparecem com nome, sem capa quebrada.
- **Guia**: cabeçalho com capa + nome do jogo e link "Página do jogo"; trilha `Jogos › <Jogo> › Guia`.
- Depende da Parte A do Robô de Notícias (mexe em `noticias/[slug]/page.tsx`): implementar depois que ela entrar, só acrescentando.

## Ordem (controller)
- Onda 1 (paralela, áreas separadas): **F1+F2** (sync + RPG), **F4** (e-mail + Google), **F5** (marca/nav/capinha/nomes).
- Onda 2: **F3** (perfil) + **F11** (paginação Jogos/Família) + **F12** (links para a página do jogo), **F6** (highscores), **F7+F8+F10** (notícias + calendário + lançamentos).
- Onda 3: **F9** (social).
- Depois: emulador (Plano 3) e hospedagem definitiva.

## Do Lucas (credenciais; ele mesmo coloca em `app/.env.production.local`)
`STEAM_API_KEY` (essencial para F1/F3), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` (+ registros DNS do Resend no Cloudflare), `XBOX_OPENXBL_KEY`, `PSN_NPSSO` (conta de serviço), `RA_API_KEY`. Tudo funciona em dev sem elas (fixtures), e em produção cada parte sem chave fica desligada com aviso.

## Restrições
As de sempre (`.superpowers/sdd/2026-10-31-tralked-plano-2/global-constraints.md`): pt-BR, tokens visuais, zod, sessão/papel, axe 0 serious/critical, reduced-motion, banco próprio por worktree, nunca escrever em `gamelog`/`gamelog_dev` (o controller aplica migrations/scripts), `NEXT_BUILD_CPUS=4`, nada de fixture em produção.
