# GAMELOG — Especificação da plataforma

Data: 2026-10-31 · Dono do produto: Lucas (Ludai Labs) · Status: aprovado para execução (fase MVP)

## 1. Intenção

GAMELOG é um portal de games onde **cada jogo que você termina vira evolução do seu personagem**. Notícias trazem o público, guias de conquistas fazem o jogador completar jogos (100%), e um personagem RPG no estilo Tibia — com nível geral e skills por gênero — faz ele voltar todo dia.

Loop central: lê notícia ou guia → joga → conquista é importada da Steam → ganha XP e sobe skill → recebe nova missão/meta → volta.

Público: jogadores de PC (Steam) brasileiros, caçadores de conquistas e leitores de notícias de games. Idioma: português do Brasil.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Catálogo com todos os jogos da Steam que têm conquistas, com raridade global por conquista.
- Guias de 100% num modelo padronizado (o "modelo de guia" da prévia).
- Sistema RPG: nível geral (curva Tibia), skills por gênero, vocações, missões, sequência, highscores.
- Portal de notícias com a identidade visual do handoff (PXN → GAMELOG).
- Família GAMELOG: grupo por convite que junta as bibliotecas dos membros.
- Retenção: missões diárias/semanais, sequência com escudo, "quase lá", level up com animação.

**Não-objetivos (agora)**
- PlayStation/Xbox/RetroAchievements (fase 3).
- App mobile nativo.
- Detecção automática da Família Steam (endpoints não documentados; ver §8).

**Anti-objetivos (falha mesmo se funcionar)**
- Vantagem de XP paga, caixas de recompensa pagas, qualquer mecânica de aposta.
- Pedir ao usuário token de sessão/senha da Steam.
- Scraping de How Long to Beat ou Metacritic.
- Rankings que aceitam conquistas fraudadas (desbloqueio em massa).

## 3. Restrições

- Login somente via Steam OpenID 2.0 no MVP (sem senha própria).
- Dados de conquistas somente da Steam Web API oficial; perfil do usuário precisa ser público.
- Nunca chamar API externa durante a renderização de página: tudo passa por sincronização em segundo plano para o banco do GAMELOG.
- Créditos visíveis a IGDB, RAWG e SteamGridDB (rodapé + página do jogo).
- LGPD: consentimento, exportação e exclusão de dados do usuário.
- O app precisa rodar 100% localmente sem chaves de API (adaptadores com dados de exemplo / fixtures).

## 4. Decisões já tomadas

**Pelo Lucas**
- Nome: **GAMELOG**.
- Identidade visual: a do `design_handoff_pxn_games_home` (tokens, tipografia Archivo + JetBrains Mono, acento lima `#C6F432`, raio 2–4px, cards, header, newsletter, rodapé).
- Gamificação estilo Tibia por gênero, XP por raridade, missões, sequência, vocações (aprovado na prévia).
- Família GAMELOG por convite (alternativa segura à Família Steam).
- Lista de funcionalidades por fase aprovada (seção 6).

**Do Claude (podem ser revistas)**
- Logo: mantém o símbolo "Badge" do handoff (quadrado com canto cortado) trocando o X por um ✓ (marca de conquista) e o losango central; logotipo "GAME**LOG**" com LOG no acento; tagline "Feito por pessoas que amam jogar".
- Stack: Next.js (App Router) + TypeScript + Tailwind CSS, Postgres 16, Prisma, Vitest, pnpm. Postgres local via Docker Compose. Hospedagem alvo: Vercel + Postgres do Marketplace.
- Sessão: cookie assinado (JWT via `jose`) após verificação OpenID.
- Jobs: funções de sincronização idempotentes, disparadas por rotas de cron protegidas; em produção, Vercel Cron / Queues.
- Notícias no MVP: CMS próprio simples (Markdown) dentro do painel admin.
- **Histórico conta**: conquistas desbloqueadas antes do cadastro valem XP (o primeiro login vira o "Despertar" do personagem, com level up em sequência). O XP de cada conquista é **congelado** no momento em que é registrado no ledger (raridade daquele dia); mudanças de raridade depois não alteram XP já ganho.
- **Antifraude usa os horários reais da Steam** (`unlocktime`), não o horário da importação; importar histórico antigo não dispara a regra de rajada sozinho. "Tempo médio" do speed-platinum = `game_time_to_beats.completely` do IGDB; sem esse dado a regra não roda. Revisão de casos suspeitos: admins (Plano 2); contestação pelo usuário: F2.
- **Catálogo sob demanda**: no lançamento, catálogo semeado com os jogos mais populares com conquistas + qualquer jogo importado por um usuário entra automaticamente; um job de varredura progressiva completa o resto respeitando o limite diário da Steam.
- **Papéis**: `admin`, `editor` (equipe), `author` (comunidade aprovada) e usuário comum. Guias são escritos por editores e autores aprovados e passam por revisão; qualquer usuário logado envia dicas e vota.
- **Skill Sábio no MVP**: ganha XP com votos recebidos em dicas (25 XP por voto) e, a partir do Plano 2, com guias/trechos publicados.

## 5. Regras do sistema RPG (fonte da verdade)

- **XP total para o nível L** (curva Tibia): `expFor(L) = round(50/3 · (L³ − 6L² + 17L − 12))`.
- **XP de uma conquista** pela raridade global `p` (% de jogadores): `xp(p) = round(1500 + 60000 / (p + 1.5))`.
- **Raridade**: ≤3% Lendária · ≤8% Épica · ≤20% Rara · ≤50% Incomum · resto Comum.
- **Skills por gênero**: FPS, Survival Horror, Soulslike, RPG, Roguelike, Plataforma, Estratégia, Simulação, Puzzle, Co-op, Sábio (guias). Pontos de skill por conquista = `round(xp/12 / nºGêneros)` divididos igualmente entre os gêneros do jogo. Pontos para subir do nível L: `round(120 · 1.085^L)`.
- **Mapeamento jogo → gêneros**: automático a partir de gêneros/temas/modos/palavras-chave do IGDB (ex.: Shooter + primeira pessoa → FPS; tema Horror + Survival → Survival Horror; modo Co-operative → Co-op; palavra-chave "soulslike"/"roguelike"), com override manual no admin.
- **Vocação**: definida pelo par das duas skills mais altas (tabela da prévia; fallback "Andarilho de <skill>").
- **Platinado**: 100% das conquistas de um jogo; bônus de XP = 10% da soma de XP das conquistas do jogo.
- **Sequência**: dia ativo = ao menos 1 conquista válida no dia (fuso America/Sao_Paulo). 1 escudo a cada 7 dias seguidos (máx. 2) cobre 1 dia perdido.
- **Missões**: diárias (3) e semanais (2), geradas de templates com condições sobre conquistas (raridade, gênero, jogo). Recompensa em XP.
- **Antifraude**: conquistas de um mesmo usuário desbloqueadas em rajada (≥ 10 conquistas em ≤ 60 s, ou 100% de um jogo com tempo jogado < 5% do tempo médio) são marcadas como suspeitas: não contam XP nem ranking até revisão.
- XP é registrado num livro-razão (ledger) imutável; nível e skills são derivados dele.

## 6. Funcionalidades por fase

Legenda: [MVP] lançamento · [F2] comunidade e retenção · [F3] expansão.

1. **Conta e perfil**: [MVP] login Steam, importação de jogos/conquistas/horas, perfil público com privacidade · [F2] login e-mail/Google para leitores · [F3] multiplataforma.
2. **Catálogo**: [MVP] jogos Steam com conquistas e raridade, ficha (IGDB), arte (SteamGridDB), nota da crítica (RAWG/IGDB), busca e filtros · [F2] Tempo GAMELOG (horas reais até o 100%), preços (GG.deals).
3. **Guias**: [MVP] modelo padronizado (ficha, visão geral, rota em etapas, conquistas com dicas e passo a passo, coletáveis, dicas da comunidade, revisões), editor estruturado, moderação, versões, spoilers, perdíveis · [F2] progresso automático no guia, alerta de perdível, votos que dão XP Sábio.
4. **RPG**: [MVP] nível geral, skills, vocações, level up animado, platinado, títulos e badges, missões, sequência com escudo, highscores global e por gênero · [F2] highscores por país e amigos, raridade GAMELOG, "Primeiro a platinar" · [F3] promoção de vocação no nível 100, cosméticos.
5. **Notícias**: [MVP] home do handoff, editorias, plataformas, autores, selo "Autoria humana", CMS, notícia ligada a jogo/guia, newsletter · [F2] comentários com nível/vocação.
6. **Social**: [MVP] **Família GAMELOG** (convite por link, biblioteca conjunta com "quem tem", ranking da família, "quase lá" da família) · [F2] seguir amigos, feed, corrida contra amigo, grupos co-op + Discord, missões em família · [F3] guildas.
7. **Ferramentas do caçador**: [MVP] "Quase lá", backlog · [F2] planejador de 100%, janela de ouro (preço), R$ por hora de platina, roleta de backlog, retrospectiva.
8. **Eventos**: [F2] temporada mensal por gênero, jogo diário de adivinhar · [F3] boss mundial, contratos de caça, pactos públicos.
9. **Coleção**: [F3] cartas colecionáveis por conquista.
10. **Integrações e notificações**: [MVP] Steam, IGDB, RAWG, SteamGridDB com sync em segundo plano; notificações no site e e-mail · [F2] bot Discord, push, GG.deals · [F3] extensão Twitch, assistente IA.
11. **Operação**: [MVP] painel admin, moderação, antifraude, SEO das páginas de guia/jogo, LGPD, acessibilidade, métricas de retenção.
12. **Monetização**: [MVP] espaço de anúncio no editorial · [F2] afiliados · [F3] premium só cosmético, contratos patrocinados.

## 7. Arquitetura

- **App**: Next.js App Router, Server Components por padrão; Server Actions para mutações; rotas `/api/cron/*` protegidas por segredo para sincronização.
- **Domínio puro** (`src/lib/engine`): fórmulas de XP, raridade, skills, vocações, missões, sequência, antifraude — sem I/O, 100% testado.
- **Integrações** (`src/lib/integrations/<fonte>`): cada fonte implementa uma interface; existe implementação `fixture` usada quando a chave não está configurada.
- **Dados**: Postgres + Prisma. Entidades principais: User, SteamProfile, Game, GameExternalId, Genre/GameSkill, Achievement, UserGame, UserAchievement, XpLedgerEntry, SkillProgress (derivado/cache), Mission, MissionProgress, Streak, Title/Badge/UserTitle, Guide, GuideVersion, GuideStep, GuideAchievementNote, GuideTip, GuideVote, Article, Author, Family, FamilyMember, FamilyInvite, Notification, NewsletterSubscriber, FraudFlag.
- **Sincronização**: catálogo (semanal), raridade global (diária), conquistas do usuário (no login + a cada 6 h), metadados IGDB/RAWG/SGDB (semanal). Idempotente, com limite de taxa por fonte.
- **Rotas públicas**: `/` (notícias), `/noticias/[slug]`, `/jogos`, `/jogos/[slug]`, `/jogos/[slug]/guia`, `/jogador/[handle]`, `/highscores`, `/familia`, `/familia/convite/[token]`, `/admin/*`, `/privacidade`, `/termos`.

## 8. Riscos e pontos em aberto

- Termos da Steam Web API falam em exibir dados "para uso pessoal" do usuário; rankings públicos são prática de mercado, mas pedem revisão jurídica.
- Família Steam: endpoints `IFamilyGroupsService` não documentados e exigem token de sessão → descartado; usamos Família GAMELOG.
- Conteúdo: meta de guias próprios no lançamento (sugestão: 100 jogos mais populares); o resto, comunidade.
- Nome "GAMELOG": fazer busca de marca (INPI) antes do lançamento.
- Licença de arte do SteamGridDB para uso comercial: confirmar.

## 9. Deixado para quem constrói

- Escolha de bibliotecas auxiliares (validação, Markdown, e-mail) dentro da stack.
- Estrutura interna de componentes, desde que siga os tokens do handoff.
- Ordem fina de tarefas dentro de cada marco do plano.
