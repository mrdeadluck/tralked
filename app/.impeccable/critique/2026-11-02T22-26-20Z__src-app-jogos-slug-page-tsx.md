---
target: Página do jogo com disco
total_score: 25
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 3
target_identity: "file:C:\\projetos\\Nova pasta\\app\\src\\app\\jogos\\[slug]\\page.tsx"
target_fingerprint: "sha256:88f72cf616a871cbe7b5e16df40264d471780bdc2c632bc7e8b80930d6864311"
target_path: "C:\\projetos\\Nova pasta\\app\\src\\app\\jogos\\[slug]\\page.tsx"
timestamp: 2026-11-02T22-26-20Z
slug: src-app-jogos-slug-page-tsx
---
# Crítica: Página do jogo com caixa e disco (/jogos/hollow-knight, elden-ring, gta-vi), produção 02/11
Method: dual-agent (A: design review · B: detector + browser)

## Nota: 25/36 (69%, Aceitável quase Bom). n/a: 5
| # | Heurística | Nota | Problema |
|---|---|---|---|
| 1 | Status | 3 | anel + contagens; deslogado só CTA |
| 2 | Mundo real | 4 | metáfora de mídia física consistente |
| 3 | Controle | 3 | Pular, Esc, mudo, não mostrar; auto-abre em 6 s |
| 4 | Consistência | 2 | CTA principal muda por jogo; aba ativa branca, não lima |
| 5 | Prevenção | n/a | |
| 6 | Reconhecimento | 3 | |
| 7 | Flexibilidade | 3 | |
| 8 | Estética | 3 | herói forte; palco vazio; parte de baixo genérica |
| 9 | Vazios | 2 | GTA VI "Sem conquistas" em vez de "ainda não lançado" |
| 10 | Ajuda | 2 | "+1 Platina Tralked" sem explicação |

## Especificidade
A ideia mais autoral do site (lacre, capa, disco, encarte, sons). Abaixo da dobra cai em trilhos genéricos. Detector: content-hidden-at-rest 73–76% do texto oculto na 1ª visita (intro ~10 s deslogado: 6 s de auto-abertura + ~4 s); CLS 0,12 (1440) e 0,45 (390) no voo do disco, pois CaseIntro.tsx ~452–454 anima left/top/width/height. hard-offset-shadow ×8 em .gpe-box (lombada, provável intencional), eyebrow de gêneros acima do h1, wide-tracking em .gp-aside. Sem long tasks; reduced-motion respeitado (CLS ~0).

## Problemas
- [P1] Palco da intro pequeno e vazio (--cw min(280px,34vw)); luz neutra em vez da cor do jogo.
- [P1] CLS 0,45 no mobile na animação do disco: trocar por transform (FLIP real).
- [P1] Qualidade de dados: GTA VI "FPS · Co-op" e lede em inglês; HK "Soulslike · Plataforma" vs "Metroidvania".
- [P2] Deslogado: lado do disco sem recompensa (anel vazio + CTA).
- [P2] 1ª visita leva ~10 s até a página; volta frequente sem versão curta.
- [P2] A página não veste o jogo: título digitado na fonte Tralked, nota e CTAs em lima.
- [P3] Parte de baixo genérica ("Trailer 2/3/4").

## Personas
Caçador: sem link para a lista de conquistas no herói, sem distribuição de raridade. Primeira visita: o primeiro texto lido é "Não mostrar a animação nos próximos jogos". Mobile: o rótulo da preferência quebra em 3–4 linhas sobre o palco.
