# Handoff: PXN Games — Home de notícias

## Overview
Redesign da home do portal de notícias de games PXN Games: nova identidade visual (logo "Badge X"), header com mega-menus e busca com sugestões, destaque principal, lista de notícias filtrável por plataforma, ranking da comunidade, newsletter e rodapé. Layout responsivo (desktop + mobile com menu gaveta).

## About the Design Files
Os arquivos deste pacote são **referências de design feitas em HTML**: protótipos que mostram aparência e comportamento, **não código de produção**. A tarefa é **recriar esses designs no ambiente do codebase de destino** (React, Next.js, Vue etc.) seguindo os padrões e bibliotecas já existentes. Se ainda não houver projeto, sugerimos **Next.js + React + Tailwind CSS** (ou CSS Modules).

Para ver o protótipo: abra `PXN Games v2.dc.html` no navegador (precisa de `support.js` na mesma pasta; sirva via servidor local, ex.: `npx serve .`).

## Fidelity
**High-fidelity.** Cores, tipografia, espaçamentos e interações são finais. Recriar pixel-perfect. As imagens são placeholders listrados com legenda `[ nome da imagem ]` e devem ser trocadas por imagens reais (capas 16:10).

## Design Tokens

### Cores
| Token | Valor | Uso |
|---|---|---|
| `bg` | `#0B0C0F` | fundo da página |
| `bg-deep` | `#08090B` | rodapé |
| `bg-outer` | `#060608` | fora do frame mobile |
| `surface` | `#121317` | card do ranking |
| `surface-2` | `#141519` | input de busca, dropdowns |
| `surface-hover` | `#1C1E24` / `#17191E` | hover de itens de menu |
| `border` | `#1E2026` | divisores principais |
| `border-2` | `#23252C` / `#2A2C33` / `#2C2E36` | bordas de inputs, tags, dropdowns |
| `divider-soft` | `#1A1C21` | linhas do ranking/rodapé |
| `text` | `#ECECE6` | texto principal (off-white) |
| `text-2` | `#C9CBD1` | autores, links do rodapé |
| `text-3` | `#B9BBC2` | links do nav, subtítulo do hero |
| `text-muted` | `#9EA1A9` | descrição das notícias |
| `text-dim` | `#8A8D96` / `#7C7F88` / `#6E717A` | meta, labels |
| `placeholder-label` | `#5D6068` | legenda das imagens placeholder |
| **`accent`** | **`#C6F432`** (lima) | marca, CTAs, links "VER TUDO", destaques |
| `discord` | `#5865F2` | card do Discord |
| `ps` | `oklch(0.74 0.14 255)` ≈ `#6FA4FF` | PlayStation |
| `xbox` | `oklch(0.74 0.14 145)` ≈ `#6CC66E` | Xbox |
| `nintendo` | `oklch(0.74 0.14 25)` ≈ `#F2817A` | Nintendo |
| `pc` | `oklch(0.74 0.14 75)` ≈ `#D99F4A` | PC |

Accent alternativos testados: `#FF4D2E`, `#8B6CFF`, `#2EE6C9`. Implementar o accent como variável CSS (`--acc`).

### Tipografia (Google Fonts)
- **Archivo** (eixo variável de largura `wdth` 62–125, peso 400–900): títulos e corpo. Títulos usam `font-stretch: 112–125%` (expandido) + peso 800–900 + `letter-spacing` negativo.
- **JetBrains Mono** (400/500/700): tags, meta, labels, nav, botões.

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

| Uso | Família | Tamanho | Peso | Stretch | Letter-spacing | Line-height |
|---|---|---|---|---|---|---|
| H1 hero | Archivo | clamp(30px, 4.2vw, 56px) | 900 | 112% | -0.035em | 0.98 |
| H2 seção ("ÚLTIMAS NOTÍCIAS") | Archivo | 28px, uppercase | 900 | 125% | -0.03em | 1 |
| H2 newsletter | Archivo | clamp(26px, 3vw, 38px) | 900 | 120% | -0.035em | 1 |
| Título notícia (lista) | Archivo | 23px | 800 | 105% | -0.02em | 1.12 |
| Título card lateral | Archivo | 19px | 800 | 100% | -0.015em | 1.15 |
| Corpo / descrição | Archivo | 15.5–17px | 400 | 100% | 0 | 1.5 |
| Nav desktop | JetBrains Mono | 12px uppercase | 500 | — | 0.08em | — |
| Tags | JetBrains Mono | 9.5–10.5px | 400 | — | 0.1em | — |
| Meta (autor, tempo) | JetBrains Mono | 11–12px | 400 | — | 0 | — |
| Labels de seção | JetBrains Mono | 10–11px | 400/700 | — | 0.14em | — |

Usar `text-wrap: balance` nos títulos e `text-wrap: pretty` nos parágrafos.

### Espaçamento / raio / sombra
- Largura máxima do conteúdo: **1320px**, padding lateral 20px.
- Gap entre seções principais: 56px. Gap coluna principal ↔ sidebar: 48px. Gap do grid do hero: 12px.
- Border-radius: **2px** (botões, inputs, tags, nav), **3–4px** (cards). Avatares 50%.
- Sombra só em dropdowns: `0 20px 40px rgba(0,0,0,.5)`.
- Placeholder de imagem: `repeating-linear-gradient(135deg,#16181D 0 10px,#1B1D23 10px 20px)`.

## Logo — "Badge X" (final)
- **Símbolo**: quadrado 44×44px, fundo `accent`, canto inferior direito cortado: `clip-path: polygon(0 0,100% 0,100% 72%,72% 100%,0 100%)`. Dentro, um **X** formado por 2 barras `#0B0C0F` de 30×7px rotacionadas ±45°, centralizadas; sobre o cruzamento, um losango 7×7px na cor `accent` (quadrado girado 45°), que dá o "furo" central.
- **Logotipo**: "P**X**N" em Archivo 900, 25px, stretch 125%, letter-spacing -0.03em, com o X na cor `accent`. Ao lado (baseline), "GAMES" em JetBrains Mono 700, 11px, letter-spacing 0.24em.
- **Tagline** abaixo: "FEITO POR PESSOAS QUE AMAM JOGAR", JetBrains Mono 9.5px, letter-spacing 0.18em, `#7C7F88`.
- Gap símbolo↔texto 12px. No rodapé: símbolo 34px (barras 23×5px, sem losango) + "PXN" 22px.
- Recomendação: exportar o símbolo como **SVG** no codebase.

Alternativas exploradas no protótipo (prop `logo`): "Blocos" (P/X/N em 3 blocos), "Pixel" (X em grade 5×5 de pixels), "Mira" (X dentro de círculo). Não usar, salvo decisão em contrário.

## Screens / Views

### 1. Header (sticky)
- `position: sticky; top: 0; z-index: 20`; fundo `rgba(11,12,15,.94)` + `backdrop-filter: blur(10px)`; borda inferior `1px #1E2026`.
- Linha flex, `gap: 24px`, padding 14px 20px, wrap.
- Ordem: Logo · Nav · Busca (flex 1 1 240px) · Avatar (40px círculo, borda 2px accent).
- **Nav (desktop ≥ 900px)**: Início (ativo: fundo `#ECECE6`, texto `#0B0C0F`), Games ▾, Entretenimento ▾, Tecnologia, Calendário. Padding 9×12px. Hover: fundo `#17191E`, texto `#ECECE6`.
- **Dropdown Games** (abre no hover, fecha ao sair): painel 260px, `#141519`, borda `#2A2C33`, radius 4, padding 8. Itens: PlayStation, Xbox, Nintendo, PC, cada um com quadrado 8×8 na cor da plataforma (Archivo 14px/600). Divisor, depois "Reviews" e "Lançamentos" em mono 11px accent.
- **Dropdown Entretenimento**: 220px; Filmes, Séries, Anime, Streaming.
- **Busca**: altura 42px, `#141519`, borda `#23252C` (vira `accent` em foco). Ícone ⌕, input, atalho de teclado "/" mostrado em badge. Placeholder: "Buscar notícias, jogos, autores".

### 2. Hero (destaque)
- Linha flex wrap, gap 12px.
- **Card principal**: flex 1 1 560px, min-height 460px (420 no mobile), padding 32px (20 mobile), radius 4. Overlay `linear-gradient(180deg, rgba(11,12,15,0) 30%, rgba(11,12,15,.96) 92%)`. Selo "EXCLUSIVO" topo-direita (accent, mono 11px/700). Conteúdo no rodapé: tags → H1 → subtítulo → meta.
  - Copy: H1 "GTA 6 tem 25 minutos de gameplay vazados e Jason aparece nu"; sub "Um novo vazamento de GTA 6 revela quase 25 minutos de gameplay, incluindo cenas inéditas, spoilers e Jason completamente nu."; meta "@Fuyushiro · há 10 horas".
- **Grid lateral**: flex 1 1 520px, `grid-template-columns: repeat(auto-fit, minmax(240px,1fr))`, 4 cards (min-height 224px, padding 18px), com mesmo overlay.
- Hover em todos os cards do hero: `translateY(-3px)` + `box-shadow: 0 0 0 1px accent`, transição 0.2s.

### 3. Tags de plataforma (componente)
- "GAMES" em accent (sem borda) + chips por plataforma: borda 1px (`#2C2E36` na lista; `rgba(236,236,230,.18–.2)` sobre imagem com fundo `rgba(11,12,15,.5)`), quadrado 5–6px + texto, ambos na cor da plataforma. Mono 10px uppercase.

### 4. Últimas notícias (coluna principal, flex 1 1 600px)
- Cabeçalho: H2 + "VER TUDO →" (accent), borda inferior 2px `#ECECE6`.
- **Filtros**: chips TODAS / PLAYSTATION / XBOX / NINTENDO / PC, altura 34px. Ativo: fundo `#ECECE6`, texto `#0B0C0F`. Inativo: transparente, borda `#2C2E36`, texto `#B9BBC2`. Filtra a lista pela plataforma. Estado vazio: "Nenhuma notícia recente nessa plataforma."
- **Item**: imagem 280px (16:10) + texto; wrap em telas estreitas. Padding 24px 12px, divisor `#1E2026`, hover fundo `#121318`. Meta: autor · tempo · ▲ curtidas · ◼ comentários · selo "● Autoria humana" (accent).

### 5. Sidebar (flex 1 1 340px, max 440px, gap 20px)
- **Discord**: `#5865F2`, padding 18, ícone 44px, "Comunidade no Discord" / "Converse sobre games com a gente", seta →; hover translateY(-2px).
- **Ranking da comunidade**: card `#121317`. Linhas em grid `28px 40px 1fr auto`: posição (Archivo 900/125%, 20px; 1º em accent, 2º–3º `#ECECE6`, demais `#5D6068`), avatar, nome + barra de XP (3px, fill accent proporcional ao 1º), XP + "NV n".
  - Dados: @BillyButcher 7/639, @ZeroJimmy 6/563, @MotocaGamer 6/504, @Fuyushiro 5/458, @urso 5/449.
- **Política editorial**: card `#ECECE6`, texto escuro: label "POLÍTICA EDITORIAL" + "Feito pela redação, vigiado por você" (Archivo 900, 26px).

### 6. Rodapé
- Fundo `#08090B`, borda superior.
- **Newsletter**: bloco accent, padding 32, radius 4. Label "NEWSLETTER", H2 "As principais notícias da semana no seu e-mail". Form: input e-mail 52px (borda 2px `#0B0C0F`, transparente) + botão "INSCREVER →" (fundo `#0B0C0F`). Após enviar: "Pronto! Confirme a inscrição em {email}."
- **Colunas** (`repeat(auto-fit,minmax(160px,1fr))`, gap 32): marca + "Feito por pessoas que amam jogar." · EDITORIAS (Games, Entretenimento, Tecnologia, Calendário) · PLATAFORMAS (PlayStation, Xbox, Nintendo, PC) · COMUNIDADE (Discord, Ranking) · INSTITUCIONAL (Sobre, Política editorial, Contato, Anuncie).
- Linha final: "© 2026 PXN Games" · Termos · Privacidade (mono 11px).

## Interactions & Behavior
- **Menus**: abrem em `mouseenter`, fecham em `mouseleave` (wrapper com `padding-top: 8px` para não fechar no vão). Em produção, adicionar suporte a teclado/foco.
- **Busca**: em foco, mostra painel de sugestões. Sem texto: grupo "EM ALTA" (GTA 6, ARC Raiders, Gears of War: E-Day, Silver Pines). Com texto: grupos JOGOS (até 3), NOTÍCIAS (até 4), AUTORES (até 3), filtrados por `includes` sem distinção de maiúsculas. Clicar preenche o input. Sem resultado: "Nada encontrado para “{q}”." Atalho **/** foca a busca. Blur fecha com delay de ~120ms (para permitir clique).
- **Filtro de plataforma**: client-side na lista.
- **Newsletter**: validação nativa de e-mail; troca o form pela mensagem de confirmação.
- **Hover**: cards sobem 2–3px com contorno accent (0.2s); itens da lista mudam fundo (0.15s).

## Responsive
- Breakpoint **900px**: abaixo dele, nav some; aparece botão ☰ (44×44px) que abre gaveta abaixo do header com links grandes (Archivo 800, 22px) e chips das plataformas. Ícone vira ✕ quando aberto. A busca vai para uma linha própria abaixo do logo.
- Hero e colunas usam flex-wrap: no mobile tudo empilha em uma coluna.
- Alvos de toque ≥ 44px no mobile.

## State Management
- `openMenu: 'games' | 'ent' | null`
- `searchQuery: string`, `searchFocused: boolean`
- `drawerOpen: boolean`
- `platformFilter: 'TODAS' | 'PLAYSTATION' | 'XBOX' | 'NINTENDO' | 'PC'`
- `newsletterEmail: string`, `subscribed: boolean`
- Dados (notícias, destaques, ranking, sugestões) estão mockados no protótipo; em produção virão da API/CMS. Modelo de notícia: `{ image, platforms[], title, description, author, publishedAt, likes, comments, humanAuthored }`.

## Assets
Nenhum asset de imagem. Todas as imagens são placeholders a substituir: destaque GTA 6, gta 6 gameplay, gta 6 xbox, playstation studios, gears of war e-day, silver pines, arc raiders frozen trail, gta 6 vice city, avatares. Logo feito em CSS (recriar como SVG). Ícone do Discord: usar o oficial.

## Files
- `PXN Games v2.dc.html`: protótipo final (referência principal).
- `support.js`: runtime necessário para abrir o protótipo no navegador.
