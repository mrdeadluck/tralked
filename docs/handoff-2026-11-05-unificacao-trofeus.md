# Handoff: unificação de troféus e jogos (Tralked), 05/11/2026

Este documento é para quem continua o trabalho num chat novo. Leia-o inteiro antes de mexer em qualquer coisa.

## Onde estão as coisas

| O quê | Onde |
|---|---|
| Design aprovado (a autoridade) | `docs/superpowers/specs/2026-11-03-trophy-unification-design.md` |
| Plano (tarefas A1–E3) | `docs/superpowers/plans/2026-11-05-unificacao-trofeus.md` |
| Ledger do SDD (todas as decisões, "rulings" e pendências menores) | `C:\projetos\tralked-trophy-lists\.superpowers\sdd\2026-11-05-unificacao-trofeus\progress.md` (fora do git; não apagar até o fim do plano) |
| Worktree de trabalho | `C:\projetos\tralked-trophy-lists`, branch `feat/trophy-lists` |
| Backups e relatórios | `C:\Users\luck_\tralked-backups\` |
| Chaves das plataformas | `C:\projetos\Nova pasta\.env.chaves` (ler com `app/scripts/lib/keys.ts`, nunca imprimir valores) |

## Como trabalhar (regras do Lucas que continuam valendo)

- **Pastas que não se tocam:** `C:\projetos\Nova pasta` (checkout), `C:\projetos\tralked-robo-guias`, `C:\projetos\rg-wt\t15`, `t40`, `t41` e `C:\projetos\tralked-steam-recentes`. Esta última tem a `main` aberta.
- **Merge na `main`:**
  - fazer numa worktree temporária: `git worktree add --detach ../tralked-merge-tmp origin/main`, depois `git merge --no-ff feat/trophy-lists`, depois `git push origin HEAD:main`, depois remover a worktree;
  - esperar o status "Vercel" `success` com `gh api repos/mrdeadluck/tralked/commits/<sha>/status`.
- **Método:** `superpowers:subagent-driven-development`, com TDD, revisão por tarefa e revisão final do branch.
- **Testes:**
  - banco `gamelog_test`: `DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test`;
  - antes do `tsc`, rodar `pnpm exec next typegen`;
  - a suíte inteira, o `tsc` e o lint precisam passar (hoje são 2.051 testes).
- **Visual:**
  - grafite com verde-limão, cantos `tk-cut*`, telas densas, sem cores novas sem perguntar;
  - **mockup em artifact antes de codar as telas das fases (b) e (c).**
- **Produção:**
  - leitura: `docker exec -e U="$U" gamelog-db psql "$U" ...`, com `U` = `DATABASE_URL_UNPOOLED` do `.env.local` da raiz de `Nova pasta`;
  - **antes de qualquer escrita em produção:**
    - `pg_dump` (Postgres 18 via `docker run postgres:18-alpine`);
    - dizer ao Lucas exatamente o que muda e esperar o "ok";
  - migrations só com `prisma migrate deploy`, depois do backup;
  - Neon no plano grátis: jobs pesados em lotes.
- **Durante operações em produção:**
  - desligar os 5 workflows agendados: `gh workflow disable platform-import steam-details steam-players catalog-enrich retro-catalog`;
  - religar no fim e conferir com `gh workflow list --all`;
  - janelas sem crons da Vercel que escrevem no banco:
    - os crons rodam aos :17–:19 a cada 6 h;
    - e aos :23–:28 das horas ímpares;
    - e às 03:19–03:22 UTC.
- **Steam:** não muda nada (nem `recentBorrowed` nem `lastPlayedOf`). O snapshot de comparação tem de dar "Steam: identical".
- **Fechar cada fase:** resumo ao Lucas em português simples, com o que mudou e o que falta.

## O que já foi feito

### Fase (a), etapas 1–2: NO AR desde 05/11/2026 22:05 UTC (`main` `b5aba98`)

- **Modelo novo:**
  - `TrophyList` (plataforma + id externo) e `UserTrophyList` (progresso por lista);
  - `Achievement.listId`;
  - migration `20261108090000_trophy_lists`.
- **Escrita por lista:** os syncs de PSN, Xbox, Steam e RA gravam por lista. As listas regionais da PSN se agrupam pelo conceito da Sony.
- **Regra de XP por versão (`settleListXp`):**
  - PS4 e PS5 contam 2 platinas;
  - listas regionais contam uma vez por console;
  - o total de troféus conta tudo.
- **Resultado em produção:**
  - diguzz: PSN 16.310 → **18.981 (igual à Sony)**; 891 listas, igual à Sony; nível 194 → 197; XP +6,08 mi;
  - MrDead_: igual à Sony, XP sem mudança;
  - Steam: idêntica.
- **Limpeza:**
  - 3.793 linhas antigas "colapsadas" foram apagadas, com 2.993 desbloqueios duplicados;
  - o usuário de exemplo "lucas" foi apagado com os dados de seed dele. O SQL está em `tralked-backups\seed-purge-20261105.sql`.
- **Backup de antes:** `tralked-backups\neon-before-trophy-lists-20261105-2143.dump`.
- **Xbox 360:**
  - A rota do OpenXBL para 360 devolve **só as conquistas obtidas**, e com isso todo jogo de 360 viraria 100%.
  - Ficou desligada (`XboxClientConfig.x360Route`, padrão `false`, commit `7c51387`). Os jogos de 360 seguem como antes.
  - O conserto certo fica para a fase (e), com a lista completa de cada jogo de 360.
- **OpenXBL:** limite de 150 chamadas por hora. O Lucas mandou a chave no chat, e ela não foi gravada em nenhum repositório. Se for preciso, peça para ele colocá-la no `.env.chaves`.

### Ferramentas prontas (em `app/`)

- `pnpm trophy-lists:backfill [--dry-run]`;
- `pnpm trophy-lists:finish [--dry-run]`;
- `pnpm trophy-lists:snapshot --label x` e `--compare a b`;
- `pnpm psn:compare --user diguzz`.
- **Atenção:** o snapshot só funciona com a migration aplicada.

## O que falta (na ordem)

1. **Antes de começar:**
   - `git fetch` na worktree e `git merge --ff-only origin/main` (o branch está um commit de merge atrás da `main`);
   - conferir que a suíte passa.
2. **Fase (b), etapa 3: página do jogo e perfil**, tarefas B0–B4 do plano.
   - **B0:** mockup em artifact com 3 quadros:
     - GTA V do diguzz com uma linha por console e abas;
     - o perfil em grade de capas com selos `PS5 ✓²`, `PS4 ✓` e `PC 64%`;
     - os botões da busca.
   - **Esperar a aprovação do Lucas** antes de codar.
   - B1 consultas, B2 página do jogo, B3 perfil, B4 publicação (sem migration).
   - **Investigar também:** a 1 platina a mais do diguzz (Tralked 521 contra Sony 520 em `psn:compare`).
3. **Fase (c), etapa 4: busca**, tarefas C1–C4.
   - Consoles do IGDB por jogo, filtros "Só exclusivos" e "Só com troféus", com PS3 e 360.
   - As chaves IGDB existem nos secrets do GitHub, mas não no `.env.chaves` local.
4. **Fase (d), etapas 5–6: duplicados e limpeza**, tarefas D1–D6.
   - Gerar o relatório de duplicados **sem mudar nada**, salvar num arquivo e mostrar ao Lucas.
   - Juntar só o que ele aprovar:
     - tudo o que tem `gameId` muda de jogo;
     - o nome descartado vira alias;
     - slug antigo redireciona com 301;
     - nunca juntar jogos com `steamAppId` diferentes e não nulos.
   - Manter o `robots.txt` coerente (regras de `/forum/` e `/galeria?jogo=`).
   - Exemplo conhecido: o GTA V da Steam está em dois jogos (`grand-theft-auto-v-enhanced` e `-legacy`), separados das listas da PSN em `grand-theft-auto-v`.
5. **Fase (e), etapa 7: troféus do catálogo inteiro**, tarefas E0–E3.
   - **E0 precisa do "sim" do Lucas** para enumerar os ids NPWR da Sony num índice leve. As definições da Sony são lidas sem conta de jogador; o mapa título→lista, não.
   - Incluir aqui o Xbox 360 correto.
6. **Fim do plano:**
   - revisão final do plano inteiro e a lista de rulings para o Lucas;
   - atualizar as pendências em `docs/handoff-2026-11-02-tralked.md`;
   - apagar a pasta do SDD;
   - limpar o container docker `tralked-rehearsal` (porta 5434, bancos de ensaio) e o banco `gamelog_trophy_shadow`.

## Ordem decidida pelo Lucas em 05/11 (vale sobre a ordem da lista acima)

- **A fase (d) fica para o fim**, depois de (b), (c) e (e).
- **Três frentes em paralelo, cada uma na sua worktree saída de `origin/main`:**
  - **Frente (b):** B0 mockup, que espera a aprovação, depois B1, B2, B3 e B4.
  - **Frente (c):** C1 e C2 já. C3 (botões) só depois do mockup B0 aprovado, porque usa o quadro 3. Depois C4.
  - **Frente (e):** E0 primeiro (pesquisa e pergunta ao Lucas). Depois do "sim", E1. **E2 só depois que B2 estiver na `main`**, porque mexe na mesma página do jogo.
- **Regras para as frentes não se atrapalharem:**
  - Quem implementa nunca roda em paralelo **dentro** da mesma frente.
  - **Produção sobe em fila, uma frente por vez, na ordem (b), (c), (e).** Cada uma passa por backup, pelo "ok" do Lucas e pela espera da Vercel.
  - Antes do merge, a frente que vem depois atualiza seu branch com a `main` nova e reroda a suíte.
  - Migrations (C1, E1): a segunda a subir é refeita em cima da `main` atualizada (timestamp posterior, `prisma migrate deploy` limpo no `gamelog_test`).
  - **`gamelog_test` é um banco só.** Para as suítes de frentes diferentes não se pisarem, cada frente cria e usa o seu banco: `gamelog_test_b`, `gamelog_test_c` e `gamelog_test_e`, no mesmo container `gamelog-db`, com `prisma migrate deploy`. Antes de cada merge, a suíte roda no `gamelog_test`.
- **Efeitos de deixar a (d) para o fim, já aceitos pelo Lucas:**
  - o GTA V da Steam continua num jogo separado das listas PSN;
  - "Só exclusivos" pode marcar como exclusivo um jogo cujo PC está num duplicado;
  - duplicados aparecem como duas capas no perfil.

## Enquanto a fase (b) não entra

A página do jogo e a biblioteca somam todas as listas da PSN num número só. Um jogo com PS4 + PS5 pode mostrar "PLATINA" com porcentagem abaixo de 100%. É esperado: as linhas por versão são a fase (b).

## Prompt para colar no chat novo

O prompt completo está na resposta do chat de 05/11. Em resumo: ler este handoff e o ledger, deixar a fase (d) para o fim e rodar (b), (c) e (e) em paralelo, conforme a seção "Ordem decidida pelo Lucas".
