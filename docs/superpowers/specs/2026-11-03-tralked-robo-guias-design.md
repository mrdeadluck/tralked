# Tralked: Robô de Guias (detonados de platina)

Data: 2026-11-03. Brainstorm com o Lucas. **(Lucas)** marca o que ele decidiu. **(controller)** marca o que eu decidi e que ele pode mudar.

Mockups aprovados nesta conversa, ao lado deste documento, em `docs/superpowers/specs/2026-11-03-robo-guias/`:
- `roadmap-hibrido.html`: a opção **1, "jornada no topo, que encolhe"**, foi a escolhida (Lucas);
- `abertura-guia.html`: o topo do guia (capa, ficha, "leia antes", roadmap);
- `detonado-pagina.html`: a página do detonado, com a arte oficial e as conquistas reais do Phantom Blade Zero e a recompensa ao marcar uma conquista. Abra no navegador: tem JS de demonstração.

## Por quê

O Tralked quer ser a central de games que liga as melhores fontes e as reescreve com a identidade e a inteligência da Tralked (Lucas). O Robô de Notícias já faz isso com notícias. O próximo passo é ter **guias e detonados próprios**. Mais tarde vêm uma wiki da Tralked e uma IA que ajuda o usuário a fechar e platinar jogos (Lucas). Este documento cobre **só o robô de guias e a experiência do detonado no site**. A wiki e a IA ficam para depois, e os guias estruturados daqui são a base delas.

Referência de qualidade: **PowerPyx** (Lucas: "consigo seguir 100% de todos os detonados do PowerPyx"). Ele faz um detonado em ordem exata, cronológica, que pega todos os coletáveis e troféus sem o jogador precisar procurar nada em outro lugar. Antes do detonado, ele mostra horas, número de troféus, troféus com bug, o mais difícil, quantos são online, quantos são perdíveis, quantas zeradas são necessárias e o que fazer em cada uma, a dificuldade e uma introdução do que saber para não perder nada. O problema dele é a interface velha. O Tralked quer o mesmo nível de dados e de sequência numa experiência **premium, memorável e agradável para o gamer** (Lucas), na identidade visual Tralked (grafite + lima, cantos chanfrados, densidade de informação; ver a memória de preferências visuais).

Primeiro guia: **Phantom Blade Zero** (Lucas). Steam appid `4115450`, lançado em 28/10/2026, com 66 conquistas, a maioria ocultas.

## Objetivos

1. **Guias sob demanda, nunca automáticos (Lucas).** O Lucas escolhe o jogo (e a plataforma), o pedido entra numa fila, e o robô processa só o que estiver na fila. Nada roda sozinho escolhendo jogos.
2. **A Steam é a lista-mestre, com um detonado por jogo (Lucas).** O guia é montado sobre a lista oficial de conquistas da Steam. Não existe guia separado por plataforma: **um detonado por jogo, foco sempre na Steam**. O guia avisa a compatibilidade (Lucas):
   - **"COMPATÍVEL COM PSN E XBOX"** (ou só com a que existir) quando as listas dessas plataformas têm as mesmas conquistas;
   - **"APENAS STEAM"** quando as listas são diferentes. É o caso do Phantom Blade Zero: Steam com 66, PS5 com 36, sem versão de Xbox;
   - **Controller:** com listas diferentes, cada conquista do detonado ganha uma tag "também no PS5 / Xbox" quando casa por nome e descrição em inglês com um troféu da outra lista. O mockup `guia-final-v3.html` mostra o selo e as tags.
   - As listas de PSN e Xbox vêm do catálogo quando algum usuário já sincronizou o jogo, ou das fontes (PSNProfiles, TrueAchievements, Exophase). Isso conversa com a unificação de troféus (`2026-11-03-trophy-unification-design.md`).
   - Exclusivos sem Steam (GTA 6, Wolverine, Ghost of Yōtei) ficam fora por enquanto (Lucas).
   - **Nomes (Lucas):** em PT-BR, com o inglês entre parênteses na primeira menção, tanto nas conquistas (os nomes PT-BR oficiais vêm do schema da Steam com `l=brazilian`) quanto nos itens e lugares do jogo, por exemplo "Lâmina Espectral Escarlate (Scarlet Wraithblade)". Para itens e lugares sem tradução oficial encontrada, fica o nome em inglês. Hoje o `syncGame` importa a lista sem idioma, ou seja, em inglês. O builder decide como guardar os dois nomes sem mudar os nomes no resto do site.
3. **Importar as conquistas só de quem ganha guia (Lucas).** Nada de varrer a Steam inteira. Quando um guia é pedido, o robô importa (ou atualiza) o jogo e as conquistas da Steam antes de escrever.
4. **Nenhuma conquista esquecida.** Cobertura de 100% da lista oficial, verificada por máquina antes do envio (ver "Regras de correção").
5. **Fatos cruzados entre várias fontes confiáveis.** O PowerPyx é a referência principal (Lucas). Outras fontes confiáveis cruzam os dados.
6. **Detonado cronológico completo** no formato PowerPyx, sem spoilers por padrão, longo e completo (Lucas: "os guias são longos e completos, e de algumas formas sem spoilers. É esse meu foco").
7. **Experiência premium no site**, conforme os mockups.
8. **Sincronização com recompensa (Lucas).** Quando o usuário marca uma conquista no guia, o site confere na Steam se ela já destravou e dá a sensação de recompensa ("dopamina"). Se a Steam ainda não confirmou, o guia segue normalmente.
9. **Jogo sem guia (Lucas).** A página de guia mostra só a lista de conquistas já sincronizadas daquele jogo, de qualquer plataforma.

## Não-objetivos

- Wiki da Tralked e IA de platina (vêm depois).
- Importar o catálogo inteiro de conquistas da Steam.
- Guias de jogos sem versão Steam.
- Robô que roda em ciclo e escolhe jogos sozinho.
- Recriar mapas do zero (Lucas: "primeiro só traga a imagem com recortes próprios, sem criar do zero coisas inexistentes").

## Anti-objetivos (seria fracasso mesmo funcionando)

- **Um guia que o jogador não consegue seguir até a platina.** Falta de coletável, contagem que não bate, perdível sem aviso antes do ponto de não retorno.
- **Informação inventada.** Todo local, requisito e número sai de uma fonte. Dado incerto é marcado, não chutado.
- **Parecer "o PowerPyx com outra roupa".** O texto é sempre reescrito com voz própria e nunca copia parágrafos. A ordem segue a estrutura do próprio jogo e é cruzada entre as fontes.
- **Esconder a origem de uma imagem de terceiro** (ver "Imagens").
- **Spoiler na cara do jogador.** Nome de chefe, reviravolta e conquista oculta aparecem sem ele pedir.
- **Um guia bonito, mas lento ou cansativo** para quem está com o jogo pausado consultando. As animações são curtas e não atrapalham a leitura.

## Vocabulário: "Tralked", não "platina" (Lucas)

Na Tralked, **o Tralked é a platina e/ou o 100% do jogo**. Todo texto do guia, do site e do robô usa essa palavra:
- "Guia Tralked", não "guia de platina";
- "Tempo até o Tralked";
- "O caminho até o Tralked";
- "Tralked 100% offline";
- "Do início ao Tralked";
- o selo da revista diz "TRALKED EM 30–40 h".

Isso entra no prompt de estilo do robô como regra fixa.

## O guia: conteúdo

**A versão final da página é `guia-final-v3.html`** (aprovada pelo Lucas: "gostei muito da página, pode deixar assim"). Ela é a v2 mais o selo de compatibilidade e o mini player da trilha. Os outros mockups da pasta são etapas intermediárias.

1. **Capa (Lucas):**
   - à esquerda, uma **capa de revista "TRALKED · Guias · Edição #N"** (`revista-v3.html`) montada sobre a arte vertical oficial do jogo (capsule da Steam), com:
     - o logotipo TRALKED na largura toda, ajustado para nunca cortar;
     - uma coluna de 3 chamadas com o número em destaque, escolhidas pelo robô entre os números mais fortes da ficha;
     - o selo "TRALKED EM x h · n zeradas";
     - a manchete com o nome do jogo e a linha fina;
     - um código de barras de enfeite com o appid.

     Todo texto da capa precisa ser legível (o Lucas reprovou uma versão em que a manchete passava por cima das chamadas e o logotipo saía cortado);
   - à direita: o nome do jogo (o **logotipo oficial** quando o catálogo tiver, via `logoUrl`), uma linha de resumo, os selos de plataforma e de "Treina…" (como no guia do Hollow Knight de hoje), a edição, as fontes, o link da página do jogo e o anel de progresso;
   - o fundo é a arte larga oficial (`heroUrl`).
2. **Ficha ("a tabelinha"; Lucas)**, com 8 números:
   - dificuldade de 1 a 10, com uma frase de justificativa;
   - horas até a platina, com a média dos jogadores do Tralked quando existir;
   - total de conquistas (lista Steam) e quantas são ocultas;
   - zeradas mínimas;
   - perdíveis;
   - online;
   - **com bug**;
   - **a mais difícil**, com a raridade global da Steam.
   - Também entram o **XP do guia**, como no Hollow Knight hoje, e a coluna lateral **Seu progresso / Neste guia** (índice).
   - **Visão geral** (Lucas, do guia atual): dois ou três parágrafos corridos sobre o jogo e o que pesa no Tralked.
3. **"Leia isto para não perder nada"** (a caixa "Antes de começar" do guia atual), com os perdíveis em selos: pontos de não retorno, o que dá para pegar depois (seleção de capítulo, pós-jogo), conquistas com bug e como contornar, avisos de dificuldade (se acumulam ou não). Os itens com spoiler ficam borrados até o leitor tocar.
4. **Roadmap por etapas**: zerada 1, limpeza, zerada 2…, platina. Cada etapa tem uma descrição curta, horas e número de conquistas.
5. **Detonado cronológico**: **etapa → capítulo → passo**. Em cada passo:
   - o texto do que fazer, na ordem em que o jogador avança;
   - os **coletáveis** que aparecem nesse ponto ("Flor da Memória 3/10"), cada um com local, imagem e selo **"dá para voltar depois"** ou **"perdível · pegue agora"**;
   - as **conquistas** que destravam nesse ponto, com o ícone, o nome, a descrição e a raridade oficiais da Steam;
   - um **aviso de perdível antes** do ponto de não retorno, nunca depois;
   - no fim do capítulo, uma caixa dizendo o que dá para pegar depois (Lucas: "sempre avisando que é possível voltar e coletar depois").
6. **Limpeza**: o que sobra depois da história (missões, armas, dificuldade, pós-jogo), também em passos.
7. **Fontes**: lista com links.

**Sem spoilers por padrão:** o botão "Spoilers" fica desligado. Desligado, ele esconde o nome e o ícone das conquistas ocultas da Steam e os trechos marcados como spoiler. O leitor pode revelar um item só ("mostrar") ou ligar tudo.

## A experiência no site

Base: o mockup `detonado-pagina.html` e a opção 1 do `roadmap-hibrido.html`.

- **Jornada de capítulos no topo**: diamantes por capítulo, com a contagem feita/total e os perdíveis, e uma divisória para a fase de limpeza. Ao rolar além dela, ela vira uma **barra fina presa no topo**, com um segmento de progresso por capítulo, a contagem geral e o botão de spoilers. Funciona igual no celular (Lucas escolheu a opção 1).
- **Cena por capítulo**: um bloco grande com screenshot oficial, título em tipografia larga e os números do capítulo (itens, conquistas, coletáveis, perdíveis, horas). Os passos entram com uma animação curta ao aparecer na tela. A inspiração vem das referências do Lucas (everylastdrop.co.uk, zentry.com), dosada para um guia de consulta.
- **Linha verde acompanhando o guia (Lucas):** uma linha vertical à esquerda do detonado que se enche de lima com brilho conforme o leitor rola, com um losango na ponta. Cada passo tem um losango que acende quando é ultrapassado.
- **Fundo animado (Lucas):** atrás da página, screenshots oficiais do jogo escurecidas e levemente desfocadas, que trocam com fade conforme a rolagem e se movem mais devagar que o conteúdo. Os cartões têm vidro fosco para manter a leitura. Quem pede movimento reduzido (`prefers-reduced-motion`) vê uma imagem fixa (controller).
- **Trilha sonora de fundo (Lucas: "volume padrão bem baixinho"):** um mini player no canto da página do detonado toca a trilha do jogo. Regras:
  - **volume inicial bem baixo**, perto de 8%;
  - botões de pausar, volume e fechar. A escolha fica salva no navegador;
  - **só fontes oficiais** (controller, direito autoral): um vídeo ou playlist do YouTube publicado pela produtora, pela gravadora ou pelo compositor, tocado pelo player embutido do YouTube (o próprio dono do vídeo autoriza a incorporação). O Tralked **nunca hospeda o arquivo de áudio**. O robô procura a trilha oficial e guarda o link no guia. Se não achar, o guia sai sem música (no Phantom Blade Zero, uma busca rápida ainda não achou uma trilha oficial publicada);
  - **os navegadores não deixam tocar som antes do primeiro clique ou toque** do leitor na página. A música começa nesse primeiro clique, nunca de surpresa ao abrir. Ela não toca no celular sem o leitor apertar o play (controller).
- **Coluna lateral fixa** (desktop): contagem do capítulo e do jogo todo por tipo de coletável, e uma explicação da sincronização.
- **Marcar como feito** em cada coletável e em cada conquista. O progresso é salvo na conta. Hoje o progresso é por etapa (`GuideStepProgress`) e passa a ser **por item**.
- **Sincronização e recompensa (Lucas):**
  - quando o leitor marca uma conquista, o site pede à Steam o estado das conquistas **só desse jogo** para esse usuário (Lucas: "hoje já está assim na página do catálogo do game, só queria trazer pra página do detonado também"). A leitura do código pelo revisor mostrou que hoje existe só o `syncNow` (`app/src/app/jogador/[handle]/actions.ts`), que sincroniza a biblioteca inteira e tem espera de 2 minutos. Por isso, **decisão do controller**: criar uma conferência nova, de um jogo só, que passa pelo mesmo caminho de XP, antifraude, missões e nível do `syncUser`, com um limite de frequência próprio e curto;
  - se a Steam confirmar, aparece a recompensa (o selo **TRALKED!**, o ícone da conquista e o XP), como no mockup;
  - se ainda não confirmou, o item fica "marcado por você · aguardando a Steam" e é conferido de novo depois, sem bloquear nada. O guia segue (Lucas). **Controller:** enquanto a página está aberta, ela tenta de novo algumas vezes; depois disso, a sincronização normal do usuário confirma, sem job novo;
  - leitor sem Steam ligada, com perfil privado ou jogando em outra plataforma: o guia funciona como checklist, sem conferência e sem recompensa, e mostra um convite para ligar a Steam (controller);
  - **o XP só vem da confirmação da Steam**, nunca do check manual (controller: evita trapaça no ranking). O builder confirma que isso já é o comportamento atual.
- **Jogo sem guia (Lucas):** hoje `/jogos/[slug]/guia` redireciona para a página do jogo quando não existe guia (`app/src/app/jogos/[slug]/guia/page.tsx`). Isso muda: a página passa a mostrar só a lista de conquistas já sincronizadas daquele jogo, de todas as plataformas que o banco tiver, no visual da página de guia. Um jogo sem nenhuma conquista no banco continua como hoje.
- Hollow Knight é o guia de exemplo atual (Lucas). Ele continua funcionando no formato novo, sem perder as marcas dos leitores.

## O robô

### Onde roda e como é acionado

- **Botão "Pedir guia" no admin** (controller): escolher o jogo (busca no catálogo, ou o appid da Steam se ainda não estiver no catálogo) e a plataforma (Steam por padrão). O pedido entra numa fila com status: na fila → pesquisando → escrevendo → em revisão → publicado. Ou então **aguardando fontes**, com o relatório do que falta, ou falhou, com o motivo. O Lucas pode reordenar e cancelar.
- **O robô roda no PC do Lucas, como o Robô de Notícias** (controller): pesquisa longa, com muitas páginas e imagens, sem limite de tempo de função. Ele busca o próximo pedido da fila pela API do site. O builder decide se é uma pasta nova (`ROBO GUIAS/`) que reaproveita módulos do `ROBO NOTICIAS/` (cliente de IA com controle de gasto, checador, cliente da API Tralked) ou um comando novo dentro do mesmo projeto. Preferência do controller: uma pasta irmã, com os módulos comuns compartilhados, para que um robô não derrube o outro.

### Pipeline de um pedido

1. **Lista-mestre.** Importa ou atualiza o jogo e as conquistas pela Steam (`syncGame(appId)` em `app/src/lib/sync/catalog.ts` já faz isso por jogo, inclusive a raridade). O robô aciona isso pelo site (endpoint novo ou etapa do pedido; decide o builder) e lê a lista pelo `/api/v1/games/{slug}/dossie`.
2. **Pesquisa em várias fontes confiáveis de 100% (Lucas).** O PowerPyx segue a lista da PSN, que pode ser diferente da Steam: no Phantom Blade Zero, o PS5 tem 36 troféus e a Steam tem 66. Por isso, num guia Steam, o robô **sempre** precisa de pelo menos uma fonte nativa da Steam com 100% além do PowerPyx (Lucas). As fontes, por papel:

   | Papel | Fontes | Para quê |
   |---|---|---|
   | **Roteiro 100% (PSN)** | **PowerPyx** (principal; Lucas), PSNProfiles (guias e fórum de troféu) | Ordem cronológica, coletáveis por região, perdíveis, roadmap |
   | **Roteiro 100% (Steam)** | **Guias da Comunidade Steam** com a tag Achievements, os mais bem avaliados que dizem cobrir todas as N conquistas (em qualquer idioma), e **TrueSteamAchievements** (solução por conquista e walkthroughs) | As conquistas que só existem na Steam e a confirmação da lista Steam |
   | **Coletáveis e locais** | Grindnstrat, Game8, IGN, games.gg, allthings.how (mapas), wikis do jogo (Fextralife, Fandom), Mobalytics | Cruzar cada item, local e contagem |
   | **Confirmação** | Vídeos do YouTube (títulos, descrições e legendas), Reddit (sub do jogo, r/Trophies, r/Achievements) | Bugs, mudanças de patch, locais disputados; frames de mapa |
   | **Dados oficiais** (não são guia) | API da Steam (lista, descrições PT-BR e EN, ocultas, raridade), dados do Tralked (mediana de horas), HowLongToBeat (tempo de 100%) | Lista-mestre, raridade e horas |

   Regras da pesquisa:
   - **Toda conquista exclusiva da Steam** (que não casa por nome com nenhum troféu da PSN) precisa vir de uma fonte nativa da Steam. O casamento PSN ↔ Steam é feito pelo nome em inglês e pela descrição.
   - **Fontes independentes de verdade.** Muitos sites copiam o PowerPyx. Se dois textos são quase iguais, contam como **uma** fonte só (o builder define a medida de semelhança).
   - **Qualquer idioma serve.** Em jogo recém-lançado, os guias completos costumam sair primeiro em chinês e russo (no Phantom Blade Zero, o primeiro guia da comunidade com as 66 conquistas era chinês). O robô lê e cruza, e o texto final sai em PT-BR.
   - **Guia marcado como incompleto (WIP)** vale como fonte secundária, nunca como a única.
   - Respeita o robots.txt e um ritmo educado de requisições, e guarda em cache o que já leu. Alguns sites bloqueiam leitura simples (o TrueSteamAchievements respondeu 403, e a Comunidade Steam devolve 429 se o robô ler rápido demais). O builder decide entre um navegador automatizado, um ritmo mais lento ou pular a fonte, e o relatório mostra qual fonte não foi lida.
3. **Extração para um dossiê estruturado**, com a fonte de cada fato: etapas e zeradas, capítulos em ordem, cada coletável (tipo, número, capítulo, local, se é perdível e até quando, se volta depois), cada conquista (como destravar, em que ponto, se é perdível, se tem bug, se é online), dificuldade, horas e avisos.
4. **Cruzamento.** Um fato confirmado por 2 ou mais fontes entra normalmente. Um fato com uma fonte só (por exemplo, só o PowerPyx) ou com fontes que se contradizem entra **marcado para revisão**, com as versões de cada fonte lado a lado.
5. **Porta de completude** (ver "Regras de correção"). **O robô só cria o guia quando encontrou tudo e consegue montar a cronologia completa (Lucas).** Se não passar, nada é enviado. O pedido fica com o status **"aguardando fontes"** e um relatório do que falta, por exemplo "faltam 3 Flores da Memória, as fontes não cobrem" ou "30 conquistas só da Steam sem fonte nativa". O Lucas pode mandar tentar de novo. A nova tentativa reaproveita a pesquisa guardada e busca só o que faltou. **Controller:** o mesmo pedido também é tentado de novo sozinho a cada 3 dias, por até 30 dias. Isso não é o robô escolhendo jogo: é um pedido que o Lucas já colocou na fila.
6. **Escrita** na voz Tralked: português do Brasil, de gamer para gamer, texto próprio e sem cópia. O estilo segue `ROBO NOTICIAS/prompts/estilo.md`, adaptado para guia. O robô define a dificuldade de 1 a 10 com justificativa (Lucas: "ele sabe medir dificuldade"). Os critérios ficam com o builder, publicados no prompt.
7. **Imagens** (ver "Imagens").
8. **Checagem de fatos**: uma segunda passada compara o guia escrito com o dossiê (o mesmo papel do `checker.ts` do Robô de Notícias).
9. **Envio** pela API de guias, sempre para a **fila de revisão** (controller: os primeiros guias, a começar pelo Phantom Blade, passam pelo Lucas, porque o guia-modelo define o padrão; quando o modelo estiver validado, a chave pode ganhar `publish`). O envio leva junto o **relatório do robô**: fontes usadas, fatos com uma fonte só, divergências e cobertura.

### Atualização

O Lucas pode pedir a **atualização** de um guia existente (patch do jogo, nova fonte, correção). O robô refaz o pipeline aproveitando a pesquisa guardada e envia um `PATCH`, que vira uma nova versão comparável no admin (o versionamento de guias já existe). As `key` estáveis das etapas e dos itens preservam as marcas dos leitores.

**Guia já publicado (controller):** hoje a API recusa o `PATCH` de uma chave sem `publish` num guia publicado (`409 published_locked`, `app/src/lib/api/guides.ts`). No fluxo novo, **a versão no ar continua no ar** e a atualização fica como uma **versão pendente** esperando a revisão do Lucas. Aprovar troca a versão no ar. Isso pede um conceito de versão pendente no modelo.

## Regras de correção (porta de completude)

Verificadas por código, não pela IA, antes do envio:

- **Toda conquista da lista Steam** aparece no detonado (em um passo ou na limpeza) com pelo menos uma fonte. O site já recusa conquista que não existe no jogo (`422`); a porta nova recusa conquista **que falta**.
- **Toda contagem fecha.** Se uma conquista pede "colete 10 Flores da Memória", o guia lista exatamente 10, numeradas, cada uma com local. Se as fontes discordam do total, o item vai para revisão.
- **Todo perdível** tem aviso **antes** do passo do ponto de não retorno.
- **As zeradas mínimas** batem com o roadmap: cada zerada tem uma etapa.
- **A ficha bate com o detonado**: o número de perdíveis, online e com bug é igual ao número de itens marcados assim.

## Imagens

Regras (Lucas, com a trava do controller):

1. **Primeira opção:** uma captura do mapa ou do local vinda de vídeo, wiki ou screenshot oficial. O robô recorta o trecho, coloca **setas e marcadores Tralked**, a **marca d'água Tralked** e uma linha de **crédito** ("Imagem: fonte X").
2. **Quando houver dúvida, a imagem do PowerPyx (Lucas)**: recorte próprio, setas e marcadores Tralked por cima, **a marca d'água do PowerPyx mantida** e **um link de referência para a página dele** (Lucas: "ou com a própria marca d'água dele e referência que leva ao site deles").
3. **Nunca** remover, cobrir ou recortar fora a marca d'água de terceiro, nem esconder a origem de uma imagem (controller: remover a identificação de autoria é infração clara de direito autoral, aqui e nos EUA). Se a marca cair no trecho que importa, a imagem é usada inteira, com a marca, ou o robô busca outra fonte.
4. Nada de recriar mapas do zero (Lucas, por enquanto).
5. O processamento é recorte, desenho das marcações e marca d'água (por exemplo com `sharp`), e a imagem fica guardada pelo Tralked (Vercel Blob ou o que o builder escolher). Hoje o escopo `media:write` da API existe, mas nenhum endpoint o usa. O builder cria o envio de imagem.
6. Ideia do controller, fora do escopo: propor ao PowerPyx uma parceria ou licença de imagens com crédito e link.

## Mudanças no site (`app/`)

O builder detalha. Pelo que vi no código:

- **Modelo do guia** (`prisma/schema.prisma`: `Guide`, `GuideStep`, `GuideAchievementNote`; JSON Schema em `/api/v1/schemas/guide.json`). Hoje `collectibles` é uma lista simples `{name, total, description}` e o progresso é por etapa. O formato novo precisa de:
  - etapa/zerada → capítulo → passo, com `key` estável em todos os níveis;
  - coletável como item dentro do passo, com tipo, número/total, local, imagem, perdível ou "volta depois", e as conquistas para as quais conta;
  - referência de conquista dentro do passo;
  - marca de spoiler por passo e por item;
  - na ficha: número de conquistas com bug, a mais difícil, e as zeradas com descrição;
  - a seção "leia antes";
  - o relatório do robô (só para o admin);
  - progresso do leitor por item.

  Os guias atuais (Hollow Knight) migram ou continuam renderizando.
- **API de bots**: o formato novo do guia no `POST/PATCH /api/v1/guides`, o envio de imagem (`media:write`), a fila de pedidos (o robô lê o próximo pedido e informa o status) e o gatilho de importação Steam por appid.
- **Admin**: botão e fila "Pedir guia". A revisão do guia mostra o relatório do robô e os fatos marcados.
- **Página do guia** (`app/src/app/jogos/[slug]/guia/`, `components/guide/*`): a experiência nova (revista, ficha, linha verde, fundo animado, trilha), o selo de compatibilidade, a conferência de um jogo só com recompensa e a página "só conquistas" para jogo sem guia.
- **Versão pendente de guia publicado**: a atualização do robô espera revisão sem tirar a versão no ar.
- **Guia ↔ plataformas**: continua **um guia por jogo** (`Guide.gameId @unique` fica). A compatibilidade com PSN e Xbox é um dado do guia e das conquistas, não um guia novo.
- **Docs**: `docs/robos.md` e `/desenvolvedores` ganham o formato novo.

## Restrições

- Produção: Vercel + Neon. O robô fala com o site só pela API `/api/v1`, com chave e escopos.
- Gasto de IA com teto por pedido, como o controle de gasto do Robô de Notícias. Os modelos seguem o cliente de IA atual (`ROBO NOTICIAS/src/ai/client.ts`).
- Identidade visual: grafite + lima, cantos chanfrados (`tk-cut*`), Archivo + JetBrains Mono. Nenhuma cor de destaque nova sem perguntar ao Lucas.
- A unificação de troféus entre plataformas (`2026-11-03-trophy-unification-design.md`) corre em paralelo. Guias de PSN e Xbox devem esperar por ela.

## Deixado para o builder

- Onde o robô mora (pasta nova ou comando no projeto atual) e como compartilha código com o Robô de Notícias.
- O desenho exato do modelo e da migração dos guias existentes.
- Como ler cada fonte (HTML, busca, vídeos) e o formato do cache.
- Os critérios de dificuldade de 1 a 10.
- O armazenamento das imagens.
- Como o site dispara a importação Steam para o robô.
- O teto de gasto por guia (estimar com o Phantom Blade).

## Do Lucas (para depois)

- Revisar o guia do Phantom Blade na fila e dizer se o padrão está bom antes de liberar `publish`.
- Depois deste projeto: a wiki da Tralked e a IA de platina, cada uma com o seu brainstorm.
