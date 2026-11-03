---
target: Personagem (/personagem e /jogador)
total_score: 24
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 2
target_identity: "file:C:\\projetos\\Nova pasta\\app\\src\\app\\personagem\\page.tsx"
target_fingerprint: "sha256:21b571ef94816ec463dad027bf02c8e090b740f12f4a62c023a2ebaab1f75a00"
target_path: "C:\\projetos\\Nova pasta\\app\\src\\app\\personagem\\page.tsx"
timestamp: 2026-11-02T22-26-20Z
slug: src-app-personagem-page-tsx
---
# Crítica: Personagem (/personagem e /jogador/[handle]), produção 02/11
Method: dual-agent (A: design review · B: detector + browser)

## Nota: 24/36 (67%, Aceitável). n/a: 5 (Prevenção de erros, ficha só de leitura)
| # | Heurística | Nota | Problema |
|---|---|---|---|
| 1 | Status | 3 | XP bar honesta; visitante não vê a última sincronização |
| 2 | Mundo real | 3 | Metáfora RPG forte; "55 da comunidade", "Sem escudo" opacos |
| 3 | Controle | 3 | |
| 4 | Consistência | 2 | 3 estilos de estado ativo; barra de skill mede progresso no nível, não o nível |
| 5 | Prevenção | n/a | |
| 6 | Reconhecimento | 3 | |
| 7 | Flexibilidade | 2 | sem comparar, ordenar, cartão para compartilhar |
| 8 | Estética | 2 | ~19 barras iguais; só o "115" tem hierarquia |
| 9 | Recuperação | 3 | |
| 10 | Ajuda | 3 | |

## Especificidade
Vocabulário autoral (Vocação, Atributos, Sequência), linguagem visual genérica: grade de estatísticas e barras lima, rótulos mono maiúsculos. Paleta preto + lima-ácido = o padrão "gamer" de gerador de interface. Detector: kicker "Ficha" acima do h1 (jogador), 3× nested-cards (dl em grade com gap-px = falso positivo provável). Scan do .tsx é só regex (inconclusivo).

## Problemas
- [P1] Sem identidade nem arte na dobra (avatar 64px, primeira arte ~2.800px abaixo). Cartão do jogador + vitrine de raras/100%.
- [P1] h1 de /personagem transborda entre 961–1150px (personagem/page.tsx:84; 588 vs 462).
- [P2] Barras de skill: Plataforma 11 maior que RPG 14 (progresso no nível). Lê como bug.
- [P2] Atributos e Skills: duas paredes iguais. Radar/bloco compacto + top 4 skills.
- [P2] ProfileTabs com scrollbar vertical (ProfileTabs.tsx:19, falta overflow-y-hidden).
- [P2] Nenhum momento de recompensa para o visitante; "#2 geral" no mesmo peso de "Jogos 100%".

## Personas
Caçador de conquistas: raridade só em texto, sem parede de 100%. Primeira visita: jargão, missões diárias do dono para quem não é dono. Mobile: ~10 cards altos antes de qualquer arte.
