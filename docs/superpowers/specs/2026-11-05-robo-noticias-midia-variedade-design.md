# Robô de Notícias: mídia certa e variedade de assuntos

Data: 2026-11-05. Pedido do Lucas, conversado em chat.
Complementa `2026-10-31-tralked-robo-noticias-design.md`.

## Por que

As matérias do robô estão fracas justamente quando a imagem e o vídeo importam. Os exemplos que o Lucas mostrou:

- **The Elder Scrolls VI: Sentinel (03/11)**
  - No destaque da home, a capa é uma arte do Morrowind.
  - Na página da matéria, a capa é a ilustração genérica do site (morros verdes).
  - A frase do Todd Howard aparece sem o vídeo de onde ela saiu.
  - Todos os sites usaram o mesmo logotipo oficial do Sentinel. O nosso não usou.
- **"Xbox Wire publica post sobre The Elder Scrolls VI"**
  - A capa sai preta, com o logotipo cortado.
  - O texto não traz fato nenhum.
  - Nas fontes, "Steam News" aparece 7 vezes.
  - Saiu no mesmo dia que a matéria do Sentinel.
- **Imagem errada ou ausente**
  - itch.io saiu sem imagem e, ainda por cima, duas vezes no mesmo dia.
  - As notícias de mobile saem sem imagem.
  - A matéria sobre a BioWare saiu com imagem do FIFA.
- **Vídeo errado:** quando a notícia é um trailer novo, entra um gameplay genérico do catálogo, não o trailer da notícia.
- **Post do X ausente:** quando a notícia vem de um post no X, o post não aparece na matéria.

A referência do Lucas é a matéria da PXN Games sobre o Sentinel (`https://pxngames.com/noticia/bethesda-confirma-the-elder-scrolls-vi-sentinel`):

- a capa é o logotipo oficial;
- o post oficial da Bethesda no X aparece incorporado, com "Não carregou? Abrir no X" embaixo;
- o vídeo oficial do YouTube aparece incorporado, com "Não carregou? Abrir no YouTube" embaixo.

A variedade de assuntos também deve seguir a da PXN, menos o que o Lucas tirou (ver Não objetivos).

## Objetivos

1. **Imagem certa.** Toda matéria tem a imagem do assunto certo: do jogo, do console ou da empresa de que ela fala.
2. **Imagem da fonte, quando oficial.** Se a imagem que a fonte usou for material oficial (logotipo, arte de divulgação, capa do trailer, foto oficial do produto), ela vem para a nossa matéria com crédito e link para a fonte.
3. **Banco junto.** As imagens oficiais da fonte se misturam com as do nosso banco, desde que sejam do jogo exato.
4. **Vídeo certo.** Quando a notícia é sobre um vídeo (trailer, gameplay, apresentação), entra exatamente aquele vídeo, com link para abrir no YouTube.
5. **Post do X.** Quando a notícia vem de um post no X (anúncio oficial, declaração de alguém), o post entra incorporado na matéria, com link para abrir no X.
6. **Créditos clicáveis.** Todo elemento de fora (imagem, vídeo, post) dá o crédito e leva ao original.
7. **Variedade de assuntos no dia**, no modelo da PXN (ver Variedade).
8. **Qualidade:**
   - sem a mesma notícia duas vezes;
   - sem notícia sem fato;
   - sem fonte repetida na lista de fontes;
   - sem capa cortada ou vazia.

## Não objetivos

- **Retroativo.** O Lucas não quer mais notícia retroativa, só atuais. Isso inclui as 90 pautas retroativas.
- **Opinião e listas**, como "Questionando GOTYs" e "jogos imperdíveis de JRPG". Decisão do Lucas.
- **Assuntos fora de games**, como K-pop, futebol e animes que não são de jogos (Bleach). Decisão do Lucas. Cinema, séries e animes **baseados em jogos** continuam valendo.
- **Review com nota escrita pelo robô.** O robô não jogou o jogo.
- **Mudar a voz e o estilo do texto** (`prompts/estilo.md`), além do necessário para encaixar a mídia nova.
- **Posts de outras redes** (Bluesky, Threads, Instagram). Ficam para depois.

## Antiobjetivos (o que seria fracasso, mesmo funcionando)

- **Imagem do assunto errado.** Outro jogo da série, outro console, outro jogo da mesma empresa. Imagem errada é pior que imagem nenhuma.
- **Imagem produzida pelo site de notícias**: foto própria, montagem, arte com o logo ou a marca d'água do site. Isso não vale nem com crédito. Decisão do Lucas: nesse caso, usa uma imagem nossa.
- **Gameplay genérico apresentado como "o trailer" da notícia.**
- **Post do X de terceiros** (um fã, um perfil de vazamentos) apresentado como se fosse o anúncio oficial.

## O que o Lucas decidiu

### Imagens

- Imagem oficial que a fonte usou (logotipo, arte de divulgação, capa do trailer, foto oficial de produto): usa, com crédito e link para a fonte.
- Imagem feita pela própria fonte (com o logo dela, montagem dela): não usa. Cai para uma imagem nossa.
- A imagem tem que ser do assunto certo. O Lucas citou a matéria do Sentinel: "precisa estar correto".
- Matérias sobre console ou empresa ("Microsoft fala de novo console", "PS5 vendeu tanto") também têm que vir com a imagem certa.

**Como o robô decide se uma imagem é oficial** (aprovado pelo Lucas como regra, os detalhes ficam com o builder):

1. **Repetição.** A mesma imagem aparece em duas ou mais fontes diferentes da história. Foi o caso do Sentinel. Compara por semelhança visual, não pela URL, porque cada site hospeda a sua cópia.
2. **Origem oficial.** A imagem vem:
   - da mídia de um post do perfil oficial no X;
   - da capa (thumbnail) de um vídeo de canal oficial;
   - da loja (Steam, PlayStation Store, eShop, Xbox Store);
   - de uma página de imprensa da produtora.
3. **Conferência visual pela IA.** A IA olha a imagem e recusa se tiver:
   - marca d'água ou logo de um site de notícias;
   - montagem ou colagem;
   - texto do site sobreposto;
   - assunto diferente do da matéria.

   Ela também confirma o assunto, por exemplo o logotipo com o nome do jogo certo.

Para entrar, uma imagem precisa passar no item 3 e em pelo menos um dos itens 1 ou 2.

### Galeria em notícia de imagens novas (acréscimo do Lucas, 05/11)

- **O problema:** "Rockstar solta novas imagens de GTA 6 com Jason e Lucia" falava da galeria oficial, com 38 ou 39 capturas, e não mostrou nenhuma. Quando a notícia é sobre imagens novas, as imagens têm que vir.
- **Quando entra:** quando a notícia é sobre imagens ou galeria nova: novas imagens, screenshots, galeria, capturas, fotos oficiais, key art.
- **Quais imagens:** as das fontes, pelas mesmas regras da capa:
  - repetidas em mais de um site, ou vindas de origem oficial;
  - aprovadas na conferência visual;
  - sem quase-duplicatas;
  - nunca a própria capa.
- **Quantas:** até 8, hospedadas por nós, cada uma com "Divulgação/<Empresa>" e link. Com menos de 3 aprovadas, não há galeria: a matéria fica com capa e imagem do corpo.
- **No site:** um bloco de galeria em grade (2 colunas no celular, 3 no computador). O clique abre a imagem grande, com Esc para fechar e as setas para navegar.
- **Posição:** a galeria entra logo depois do primeiro parágrafo. Com galeria, não há imagem avulsa no corpo.

### Consoles e empresas

- **Acervo próprio, pequeno**, com imagens oficiais:
  - uma ou duas por console atual (PS5, PS5 Pro, Xbox Series X|S, Switch 2, Steam Deck…);
  - uma ou duas por empresa grande (Sony/PlayStation, Microsoft/Xbox, Nintendo, Valve, EA, Ubisoft, Take-Two/Rockstar, Bethesda, Capcom, Square Enix, Sega, Bandai Namco, Epic, Embracer…);
  - cada uma com crédito "Divulgação/Empresa".
- **Ordem de uso** em matéria de console ou empresa:
  1. a imagem oficial que veio da fonte, pelas mesmas regras acima;
  2. o acervo;
  3. nunca a arte de um jogo qualquer.

### Variedade

Os tipos de assunto que entram, tirados da PXN menos os excluídos:

- anúncio de jogo;
- trailer ou gameplay;
- data, lançamento ou adiamento;
- atualização, DLC ou conteúdo grátis;
- vendas e números (jogos e consoles);
- console e hardware;
- negócios e indústria (compra de empresa, demissões, fechamento, resultados);
- promoções e grátis:
  - PS Plus do mês;
  - novidades do Game Pass;
  - jogo grátis da Epic;
  - promoções grandes de loja;
- notas da imprensa ("as notas que X vem recebendo");
- cinema, séries e animes baseados em jogos;
- mobile;
- indie;
- rumor ou vazamento, sempre marcado como rumor, como já acontece hoje;
- declaração ou entrevista;
- curiosidade ou comunidade ligada a games.

**Peso das plataformas (decisão do Lucas).** A Steam é a plataforma principal do site, e o público é gamer em geral. Todas as plataformas têm importância, mas com um leve puxão para a Steam e para quem joga no PC. A Nintendo não pode ficar de fora.

- **Steam e PC: a maior fatia do dia, mas sem dominar.** Assuntos que precisam aparecer com frequência:
  - eventos e promoções da Steam (de verão, de inverno, temáticas, Next Fest com demos);
  - fins de semana grátis e jogos que ficaram grátis;
  - recordes de jogadores simultâneos e o mais vendido da semana;
  - jogo bem avaliado ou mal avaliado nas análises da Steam, e "review bombing";
  - Steam Deck (verificação, desempenho) e o hardware da Valve;
  - notícias da Valve;
  - grandes atualizações de jogos de PC;
  - jogo chegando ou saindo da Steam;
  - requisitos de PC de lançamentos grandes;
  - portes de console para PC.
- **Nintendo: presença garantida.** Assuntos que precisam aparecer:
  - Nintendo Direct;
  - Switch 2 (vendas, atualizações, jogos);
  - promoções da eShop;
  - jogos novos no Nintendo Switch Online;
  - lançamentos e datas de jogos da Nintendo.
- **PlayStation e Xbox continuam com a mesma importância** (PS Plus, Game Pass, State of Play, Xbox Showcase), assim como mobile e o resto.
- **Como fazer isso:**
  - a triagem marca também a **plataforma** de cada história;
  - a meta de mistura do dia dá um pequeno bônus à Steam e ao PC;
  - a Nintendo tem presença mínima no dia, quando houver história boa dela;
  - nenhuma plataforma passa de um teto no dia, para não virar um site só de Steam.

  Os números ficam com o builder.
- **Fontes:** confere se as atuais cobrem bem a Steam (eventos, recordes, Steam Deck) e a Nintendo (Direct, eShop, Switch Online) e acrescenta o que faltar, com preferência por fontes oficiais. O site já mede os jogadores simultâneos da Steam (worker `steam-players`), o que pode virar matéria de recorde com dado próprio. Fica como opção para o builder avaliar, não é obrigatório.

As Pautas Tralked continuam no dia a dia, com as mesmas regras (até 2 por dia, horário das 20h). O que muda é só a perda das retroativas.

## Restrições

- **O robô roda no PC do Lucas.** A escrita passa a ser feita pelo Claude Code (`claude -p`) com a assinatura dele, em vez da API. Essa troca é uma mudança separada, já combinada, que vem antes deste projeto (ver Ordem). Tudo que aqui usa IA, inclusive a conferência visual das imagens, precisa funcionar por esse caminho.
  - A troca mantém a entrada de imagens que `structured()` já aceita (`images`). As imagens vão para arquivos temporários que o Claude Code lê.
  - O limite da assinatura é semanal e dividido com o uso do Lucas. Por isso a conferência visual manda **todas as candidatas de uma matéria numa única chamada**, no máximo umas 6 imagens, e não uma chamada por imagem. (Decisão minha.)
- **Limites que continuam:** até 15 publicações por dia; até 4 matérias que são só vídeo por dia; regras das pautas como estão.
- **Imagens hospedadas por nós.** A imagem escolhida é enviada pela API do site (`POST /api/v1/media`, a mesma que o robô de guias usa, que devolve a URL em WebP no Vercel Blob). Nunca se aponta para o servidor da fonte, porque esses links quebram, mudam e expõem o leitor ao site de fora. A chave do robô de notícias precisa do escopo `media:write`. (Decisão minha: ver lista no fim.)
- **Agentes da unificação de troféus rodando em paralelo** (fases B, C e E, em worktrees próprios).
  - Este projeto mexe em `ROBO NOTICIAS/` e, no site, só em:
    - blocos de conteúdo (`app/src/lib/content/schema.ts` e `render.tsx`);
    - na página e nas consultas de notícias (`app/src/app/noticias/`, `app/src/lib/queries/news.ts`);
    - na API do robô.
  - Não toca em jogos, conquistas, sincronização, perfil nem busca.
  - O trabalho começa de uma branch nova a partir da `origin/main` atual.
- **Escrita no banco de produção:** do jeito de sempre, pelo Lucas.

## Mudanças no site (pequenas, só em notícias)

1. **Crédito clicável na imagem.** O bloco `image` ganha um link opcional para o original (`creditUrl`, https), mostrado no crédito.
2. **Bloco de post do X.**
   - Um bloco novo guarda:
     - a URL do post;
     - o autor (nome e @);
     - o texto do post, como reserva;
     - a data.
   - O site mostra o post incorporado oficial do X. O script do X carrega só nas páginas que têm post.
   - Embaixo vai "Não carregou? Abrir no X". Se o script não carregar, aparece o texto guardado com o autor e o link.
3. **Bloco de galeria** (`gallery`): de 3 a 12 imagens, cada uma com `url`, `alt`, `credit` e `creditUrl`; grade e imagem grande ao clicar. (Acréscimo de 05/11.)
4. **Link de reserva no vídeo.** O bloco `video` passa a mostrar "Não carregou? Abrir no YouTube" embaixo do player.
5. **Capa das matérias.** Hoje a capa é a primeira imagem do texto. Sem imagem, vira a arte do primeiro jogo ligado à matéria ou, sem jogo, a ilustração genérica. Com o robô colocando a imagem certa como primeira imagem, a capa sai certa sem mudar essa regra. Isso explica os dois erros do Sentinel:
   - **o Morrowind:** a matéria foi ligada a um jogo errado da série, cuja arte virou capa;
   - **os morros verdes:** como faltava imagem, o site usou a ilustração genérica.

   O builder confirma o motivo exato e corrige na origem (ver Qualidade).

## Mudanças no robô

### Ler a mídia das fontes

O robô já baixa o HTML de cada matéria de fonte para extrair o texto (`src/collect/extract.ts`, Readability). Do mesmo HTML, antes do Readability, ele passa a guardar:

- a imagem principal (`og:image` / `twitter:image`) e as imagens do corpo, com dimensões quando houver;
- os vídeos do YouTube incorporados ou linkados (ID e canal, quando der para saber);
- os posts do X incorporados ou linkados (`x.com/.../status/...`, `twitter.com/.../status/...`, `blockquote.twitter-tweet`).

### Escolher a imagem

- **Candidatas:**
  - as imagens das fontes da história;
  - a mídia dos posts oficiais do X;
  - as capas dos vídeos oficiais;
  - a arte do catálogo do jogo exato;
  - o acervo de consoles e empresas.
- **Escolha:** aplica as regras do Lucas (repetição ou origem oficial, mais a conferência visual) e escolhe:
  - **capa:** a melhor imagem oficial, larga, com tamanho bom;
  - **corpo, se fizer sentido:** uma imagem do catálogo do jogo exato, para misturar com a oficial.
- **Arte do catálogo:** só entra se o jogo da matéria for o jogo exato. Isso corrige o caso Morrowind/Sentinel: um jogo da mesma série não serve.
- **Crédito:**
  - "Divulgação/Bethesda" quando a origem oficial é conhecida;
  - "Divulgação/Bethesda, via IGN" quando ela chegou por um site;
  - sempre com link.

### Escolher o vídeo

- **Notícia sobre um vídeo:** entra o próprio vídeo. Pode vir:
  - de um canal oficial que o robô já acompanha;
  - do vídeo incorporado na matéria da fonte, desde que seja de canal oficial e o título combine com a notícia.
- **Gameplay do catálogo:** nunca entra no lugar do trailer da notícia. (Decisão minha: ele só pode aparecer no fim, como "Vídeo de X", em matéria que não fala de vídeo nenhum.)

### Incorporar posts do X

- **Quais posts entram:**
  - posts do perfil oficial do jogo, da empresa ou da plataforma;
  - posts da pessoa que a notícia cita, quando a declaração dela é a notícia.
  - Post de fã ou de perfil de vazamento só entra em notícia marcada como rumor, e com o texto deixando claro quem é o autor.
- **De onde vêm:** só dos posts que as páginas das fontes incorporam ou linkam. Não seguimos perfis do X diretamente, porque isso exigiria a API paga do X ou um endpoint não oficial.
  - O texto, o autor e a data vêm do HTML da fonte ou do oEmbed público e documentado do X (`publish.twitter.com/oembed`).
  - A mídia de um post só conta como imagem oficial quando a própria página da fonte a traz. (Decisão minha.)
- **Na escrita:** quem posiciona é o código, como já acontece com o vídeo, que o `assemble.ts` coloca depois do primeiro parágrafo. O post entra depois do primeiro parágrafo que cita o autor dele. Se nenhum citar, entra logo depois do primeiro parágrafo (e depois do vídeo, se houver). O texto da IA só é avisado de que o post vai aparecer. (Decisão minha.)
- **Cookies:** o script do X grava cookies de rastreamento, e o site tem aviso de consentimento ("necessários" ou "todos"). O script só carrega com "todos".
  - Sem esse consentimento, aparece um cartão com o texto guardado do post, o autor, a data, o botão "Carregar post" e o link "Abrir no X". O clique no botão vale como consentimento só para aquele post.
  - `/privacidade` ganha uma linha sobre o X. (Decisão minha.) O YouTube já usa `youtube-nocookie.com`.

### Variedade no dia

- A triagem passa a dar um **tipo** a cada história (lista em Variedade).
- **Escolha de cada horário:**
  - continua pela pontuação;
  - com uma meta de mistura no dia: o mesmo tipo não se repete além de um teto enquanto houver história boa de outro tipo;
  - um tipo que ficou de fora ganha prioridade quando tiver história acima da nota mínima;
  - notícia bomba continua furando a fila.
- **Itens recorrentes:** cada anúncio é coberto uma vez. Isso dá:
  - PS Plus: um por mês;
  - Game Pass: um por leva, normalmente duas por mês;
  - jogo grátis da Epic: um por semana.

  A chave para não repetir é o anúncio, não o mês. (Decisão minha.)
- **Fontes:** confere se as atuais cobrem cada tipo (mobile, promoções, cinema e séries de jogos) e acrescenta as que faltarem. Hoje são 67, e a lacuna mais provável é mobile.

### Qualidade

- **Mesma notícia duas vezes** (itch.io 2×, Elder Scrolls 2× no dia 03/11): reforça a junção de histórias. Uma história que só repete outra do mesmo dia vira atualização ou é descartada.
- **Notícia sem fato** ("X publicou um post sobre Y"): a triagem ou a checagem recusa história sem um fato novo concreto.
- **Fonte repetida** ("Steam News" 7×): a lista de fontes junta itens do mesmo veículo e da mesma URL, e cita cada veículo uma vez.
- **Capa cortada ou vazia:** a imagem de capa precisa ter proporção e tamanho que caibam no quadro do site e não pode ser quase toda vazia. Senão, vai para a próxima candidata.
- **Matéria ligada ao jogo errado:** o vínculo com o catálogo precisa ser do jogo exato. "The Elder Scrolls VI" não liga em outro jogo da série.

## Deixado para o builder

- Como comparar imagens por semelhança, com que limites, e o tamanho mínimo de capa.
- Como reconhecer perfis e canais oficiais: lista própria, nome da empresa, selo.
- Os números da meta de mistura (teto por tipo, nota mínima) e quais fontes acrescentar.
- O formato exato dos blocos novos no site e como o robô os envia.
- Montar o acervo de consoles e empresas a partir de kits de imprensa oficiais. O Lucas confere o acervo uma vez antes de ligar.
- O que fazer com matérias já publicadas que estão com mídia errada (ver Pergunta em aberto, se houver).

## Ordem

1. **Antes deste projeto:** a troca da escrita para o Claude Code no PC do Lucas, já combinada, testada com uma notícia que ele confere. Depois disso o robô volta a rodar. Ele está parado desde 03/11, 16:45.
2. **Este projeto**, em duas entregas:
   - (a) mídia certa: imagens, vídeo, posts do X e as mudanças no site;
   - (b) variedade e qualidade.
3. **Depois:** a revisão das Pautas (item 19) e a revisão final do robô.

## Decisões minhas (para o Lucas conferir)

- **Imagens hospedadas por nós** (Vercel Blob, pela API de mídia), nunca apontando para o servidor da fonte. Para isso, a chave do robô de notícias precisa ganhar o escopo `media:write`. É uma escrita no banco de produção, que eu passo ao Lucas como comando.
- **Post do X:**
  - posicionado pelo código, depois do parágrafo que cita o autor;
  - vem só das páginas das fontes, com o oEmbed oficial para o texto;
  - o script do X carrega só com consentimento "todos". Sem ele, aparece o cartão com o botão "Carregar post".
- **Itens recorrentes** (PS Plus, Game Pass, Epic): uma matéria por anúncio.
- **Conferência visual:** uma chamada por matéria, com todas as candidatas juntas.
- **Gameplay do catálogo** só entra no fim de matéria que não é sobre vídeo, rotulado "Vídeo de X". Nunca no lugar do trailer.
- **Sem nenhuma imagem certa** (nem oficial, nem do jogo exato, nem do acervo): a matéria sai sem imagem no corpo e o site usa a capa de reserva. Preferi isso a uma imagem errada.
- **Notas da imprensa** entram como tipo de assunto (a PXN faz, e o Lucas não tirou). O robô reúne as notas e não dá a dele.
- **Posts de fã ou de perfil de vazamento** só entram em matéria de rumor.
