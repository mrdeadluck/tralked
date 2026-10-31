# Tralked — Robô de Notícias

Data: 2026-10-31. Conversa com o Lucas. O que ele disse aparece como **(Lucas)**. O que eu decidi aparece como **(controller)**. Ele pode mudar qualquer decisão minha.

## Por quê

O Tralked é novo ("Seu ecossistema gamer": tracker, conquistas, horas, perfil). O Lucas quer um **site movimentado** desde já: um canal de notícias gamer unificado, com "tudo de mais interessante para o público gamer", com alcance máximo e identidade própria. Não é para ser cópia de portal. O robô lê muitas fontes confiáveis, **cruza os dados e escreve a própria matéria** com IA, publicando sozinho.

Sucesso, na prática:
1. O site amanhece com **3 meses de notícias retroativas** de todos os temas (Lucas).
2. A partir daí, o robô acompanha as fontes a cada 30 minutos e publica **uma matéria por hora, das 06h às 00h, no máximo 15 por dia** (Lucas).
3. As matérias têm cara de Tralked, são bem formatadas e geram engajamento.

## Identidade editorial

### Para quem
Para qualquer gamer: o casual e o caçador de 100% (Lucas: "além do cara que quer 100%, quero atrair o cara que joga casualmente também, mas que seja Tralked também").

### Formato fixo de cada matéria
Montado com os blocos de conteúdo que o site já tem (`heading`, `paragraph`, `list`, `quote`, `callout`, `table`, `achievement`, `video`, `divider`):

1. **Título** direto, que desperta curiosidade sem enganar (sem clickbait).
2. **Linha fina** (`subtitle`): o fato em uma frase. `excerpt` para os cards.
3. **"Em 3 pontos"**: lista com o essencial para quem só passa o olho.
4. **Corpo**: a matéria em si, sintetizando e cruzando 2 ou mais fontes quando existirem, com intertítulos quando for longa. Usa tabela quando houver números (vendas, specs, preços, datas).
5. **"No Tralked"** (`callout`): o olhar de tracker, em uma ou duas partes:
   - *Pra quem joga de boa*: vale a pena, quanto tempo leva, preço/promoção/Game Pass/fim de semana grátis, se roda no PC, quando sai.
   - *Pra quem caça 100%*: conquistas/troféus novos, mudança na dificuldade da platina, conquistas perdíveis.
   Se a notícia não tiver nada útil para nenhum dos dois, o bloco **não aparece** (controller: melhor do que forçar).
   O bloco pode usar **dados do próprio catálogo do Tralked** além das fontes (controller): número de conquistas do jogo, as mais raras (com o bloco `achievement`), horas médias dos jogadores do Tralked, plataformas, data de lançamento. Esses dados vêm do site, não são inventados. Para isso, o site ganha um endpoint de leitura (ver "Mudanças no site").
6. **Pergunta neutra ao leitor** no fim, para puxar comentários ("Vai jogar no lançamento?").
7. **Fontes**: lista com o nome da publicação e o link de cada fonte usada.
8. **Jogos ligados**: a matéria é associada aos jogos do catálogo (`games`), para o leitor cair na página do jogo no tracker.

### Voz e postura
- Português do Brasil, de gamer para gamer, informal sem ser bobo.
- **Imparcial em tudo** (Lucas): não toma lado em guerra de console, política, briga de empresas ou polêmica. Quando existem lados, mostra o que cada um disse e cita quem disse.
- **Único lado permitido: o do gamer/consumidor** (Lucas). Quando a notícia prejudica jogadores (aumento de preço, DRM, servidores desligados, jogo removido de loja, microtransação agressiva, demissões que afetam um jogo, perda de compras), o enquadramento puxa **sutilmente** para "o que isso significa pra você", com uma linha leve de defesa do consumidor. Ele sempre inclui a posição da empresa, sem xingamento e sem campanha.
- **Nunca inventa**: só afirma o que está nas fontes. Números, datas, nomes e citações têm que bater com elas. Rumor e vazamento entram como tal ("segundo X, sem confirmação oficial") (controller).
- **Não copia**: reescreve com palavras próprias. Citação direta só curta, entre aspas e atribuída. Não reutiliza fotos de outros portais (controller: direitos autorais). A capa vem da arte oficial que o Tralked já tem do jogo (Steam/IGDB) ou da arte gerada por `imageLabel`, que o site já faz.

### Assinatura
- As matérias aparecem assinadas por **"Equipe Tralked"**, **sem** o selo "Gerado por robô" (Lucas: "não quero que apareça que foi feito por um robô").
- Elas **não** recebem o selo "Autoria humana", que continua exclusivo de matérias escritas por pessoas (controller: seria uma afirmação falsa).
- Internamente continuam marcadas como `source = bot`. O admin continua filtrando "Robôs", para dar para achar e corrigir em lote.
- Registrado na conversa: regras como a lei de IA da União Europeia (texto, desde agosto de 2026) pedem identificação de texto de IA sobre assuntos públicos sem revisão humana. O Lucas escolheu não marcar matéria por matéria. Uma linha genérica no rodapé ("a redação usa ferramentas de IA") fica como opção futura, desligada.

## Temas e fontes

**Todos os temas** (Lucas), com o objetivo de máximo alcance:

| Categoria no site | O que entra |
|---|---|
| Games (já existe) | lançamentos, anúncios, patches, trailers, análises técnicas, eventos, rumores sinalizados |
| **Mercado** (nova, controller) | vendas e estimativas (Alinea Analytics, Circana), resultados e ações de empresas, aquisições, demissões |
| **Entretenimento** (nova, Plano 4 F7) | filmes, séries e animes ligados a games |
| **Tecnologia** (nova, Plano 4 F7) | hardware, consoles, PC, IA, tudo que tenha ligação com games |

A categoria GUIAS fica fora do robô de notícias. COMUNIDADE também fica fora (controller).

**Fontes** (Lucas pediu os maiores portais confiáveis, Digital Foundry, as maiores produtoras e Alinea; o resto é controller). A lista mora em um arquivo de configuração editável, para entrar ou sair fonte sem mexer no código:

- **Portais**: IGN, GameSpot, Eurogamer, PC Gamer, Polygon, VGC (Video Games Chronicle), Rock Paper Shotgun, GamesIndustry.biz, The Verge (games), Kotaku.
- **Técnica**: Digital Foundry (Eurogamer/DF).
- **Mercado**: Alinea Analytics (sem RSS: o robô lê a página de publicações), Circana/Mat Piscatella (quando houver página pública), páginas de investidores e press releases de Take-Two, Sony, Nintendo, Microsoft Gaming, Ubisoft, EA, Capcom, Bandai Namco, Square Enix, CD Projekt, Embracer.
- **Oficiais**: Steam (notícias da loja/eventos), PlayStation Blog, Xbox Wire, Nintendo (notícias), Rockstar Newswire, blogs/press das produtoras acima, Epic Games Store.
- **Brasil**: grandes portais BR de games/tecnologia, para cruzar e pegar o que é nacional (preço em real, lançamento no Brasil, eventos BR). O builder escolhe 3 a 5 confiáveis.
- **Entretenimento/Tecnologia**: seções de games/entretenimento/tecnologia de portais grandes (ex.: Variety, Deadline, The Verge, Ars Technica, Tom's Hardware), filtradas para o que tem ligação com games.

Cada fonte tem: nome, tipo (RSS/Atom, sitemap, página HTML), URL, categoria padrão, peso de confiança (oficial > portal grande > outros) e se serve para o retroativo.

Assuntos quentes (ex.: **GTA 6**, lançamento marcado para 19/11/2026) recebem cobertura forte. Mesmo assim, vale a regra da próxima seção: várias fontes falando do mesmo fato viram **uma** matéria completa, e não cinco repetidas.

## Como o robô funciona

### Onde e com o quê (controller)
- Pasta **`ROBO NOTICIAS/`** na raiz do repositório (Lucas), como projeto Node/TypeScript independente (mesma linguagem do site).
- IA: **Claude, pela chave da Anthropic do Lucas**, com o SDK oficial `@anthropic-ai/sdk`.
  - **Redação**: `claude-opus-5-5` em tudo, no retroativo e no dia a dia (Lucas aprovou), com troca por configuração para `claude-sonnet-5-5`. Usa `fallbacks: "default"` para recusas.
  - **Triagem, agrupamento e checagem**: `claude-haiku-5-5` (centavos por dia).
  - As instruções fixas (manual de estilo, formato, exemplos) ficam em **cache de prompt**.
- Estado local em **SQLite** dentro de `ROBO NOTICIAS/`: itens vistos (URL, hash, data, texto extraído), histórias (agrupamentos), matérias publicadas (id/slug no site, fontes usadas) e custos por execução.
- Publica **somente pela API de robôs do site** (`/api/v1/articles`, chave com escopo `publish`, `Idempotency-Key` por matéria). Nunca escreve no banco do site.
- Roda **neste PC** com o **Agendador de Tarefas do Windows**, chamando `https://tralked.com` (ou `localhost:3100`, configurável). Duas rotinas: **coleta a cada 30 min, 24 h por dia**, e **publicação de hora em hora, das 06h às 00h** (horário de Brasília).

### Coleta e preparo (a cada 30 min, 24 h)
1. **Coleta**: lê todas as fontes ativas e guarda só os itens novos (sem repetir URL ou conteúdo). Extrai o texto completo da página de cada item. O texto é usado só como insumo e nunca é publicado como está.
2. **Triagem** (Haiku): descarta o que não interessa ao público gamer, define a categoria, identifica os jogos e empresas citados e marca se é rumor.
3. **Agrupamento** (Haiku): junta itens que falam do **mesmo fato** em uma "história", comparando com as histórias abertas das últimas ~72 h.
4. **Decisão** (controller):
   - História nova com pelo menos uma fonte confiável vira matéria. Fonte oficial sozinha basta. Rumor precisa de fonte com boa reputação e sai marcado como rumor.
   - História já publicada que ganhou **fato novo relevante**: no mesmo dia, **atualiza** a matéria (PATCH, com nota "Atualizado às HH:MM"). Em outro dia, ou quando o desenvolvimento for grande, sai **matéria nova de continuação**, ligada à anterior.
   - Prioridade por relevância (peso das fontes, número de fontes, tamanho do jogo/empresa, interesse do público BR).
   - **Não repete a redação humana**: antes de escrever, o robô consulta as matérias publicadas no site nos últimos dias (de qualquer autor) e descarta a história se a equipe já cobriu o fato.
   - A história aprovada entra na **fila de publicação** com sua pontuação.
5. **Redação** (Opus): recebe a história com o texto de todas as fontes e devolve a matéria em **saída estruturada**, no formato exato do payload da API (título, linha fina, excerpt, blocos, categoria, plataformas, jogos, imageLabel).
6. **Checagem** (Haiku): compara números, datas, nomes e citações da matéria com as fontes. Se algo não bater, o robô reescreve uma vez. Se falhar de novo, a matéria não é publicada e fica registrada no log.
7. **Jogos**: resolve os jogos citados no catálogo do Tralked (a API exige que existam) usando a API de jogos do site. Jogo não encontrado fica de fora da ligação, sem travar a publicação.
8. A matéria pronta fica guardada esperando o horário (a redação pode acontecer na hora da publicação ou um pouco antes; decisão do builder).

### Grade de publicação (Lucas)
- **Uma matéria por hora, das 06h às 00h, no máximo 15 por dia.** São 18 horários. Nos dias calmos, o robô pula horários e fica abaixo de 15. Ele nunca publica fora da grade, a não ser na exceção abaixo.
- Em cada horário sai **a história de maior pontuação da fila**. O que chegou de madrugada (muita notícia gringa) abre o dia às 06h.
- **Exceção para notícia bomba** (controller): um fato de impacto enorme (ex.: trailer ou data de GTA 6, anúncio surpresa de console) sai na hora, mesmo fora do horário cheio, e conta dentro das 15 do dia. O critério de "bomba" é estrito: peso alto das fontes, várias fontes ao mesmo tempo, jogo/empresa de primeira linha.
- **Validade da fila** (controller): história pequena que passa de ~24 h sem vez é descartada. História grande que não coube num dia ainda pode sair no dia seguinte, se continuar relevante.
- **Horário com variação de alguns minutos** (controller), para não ficar com cara de robô batendo ponto às :00 em ponto.
- Atualizações (PATCH) de matérias já publicadas não contam no limite de 15.
- Tudo **indexado no Google desde o primeiro dia** (Lucas aprovou). O volume moderado e a barreira de qualidade (fonte cruzada ou oficial, checagem, nada repetido) são o que protege o domínio da política de "conteúdo em escala".

### Retroativo (3 meses)
- Período: **os últimos 3 meses até hoje**, de **todos os temas**, com **~750 matérias no total** (Lucas). Dá umas 8 por dia, e entram **as histórias mais relevantes de cada dia**.
- Como RSS só guarda as últimas dezenas de itens, o retroativo também lê **sitemaps e arquivos** das fontes. Fonte sem histórico acessível entra só no ritmo diário.
- Mesmo pipeline (triagem → agrupamento → redação → checagem), mas a redação usa a **API de lotes** da Anthropic (metade do preço).
- Cada matéria entra com a **data do fato** e um **horário entre 06h e 00h** daquele dia (controller), para o arquivo parecer natural. A publicação vai da mais antiga para a mais nova.
- Custo estimado: **~US$ 45 de redação (Opus em lote)**, mais alguns dólares de triagem. Tem orçamento próprio, separado do teto diário.
- **Não dispara** notificações, newsletter nem push para matéria retroativa. Também não toma os destaques da home (`featured = 0`).
- Pode ser interrompido e retomado sem duplicar nada. A grade diária só começa depois que o retroativo termina, ou roda em paralelo sem repetir histórias (decisão do builder, desde que não haja duplicata).

### Custo do dia a dia
~US$ 60 a 70 por mês: redação com Opus de até 15 matérias por dia (~US$ 55) mais a triagem com Haiku de tudo o que chega (~US$ 7).

### Segurança operacional (controller)
- **Teto de gasto diário** de **US$ 5** (configurável; o normal fica em torno de US$ 2). Ao atingir o teto, o robô para até o dia seguinte e avisa. O retroativo tem um teto separado (**US$ 70**).
- **Interruptor**: um arquivo/variável `PAUSADO` faz o ciclo não publicar nada.
- **Log** por execução e um resumo diário: coletados, descartados, publicados, atualizados, falhas, custo.
- Comando para **despublicar/arquivar em lote** as matérias de um período ou de uma fonte, caso algo dê errado.
- **Alertas** (checagem que falhou duas vezes, teto de gasto atingido, robô pausado, fonte quebrada há mais de um dia, erro da API do site) vão para o log, entram no resumo diário e são enviados por **e-mail ao Lucas** quando o Resend estiver configurado (`RESEND_API_KEY`, Plano 4 F4). Sem a chave, ficam só no log.

## Mudanças necessárias no site (`app/`)
1. **Assinatura "Equipe Tralked"** para `source = bot`: sem selo de robô na matéria, na lista, nos cards e no JSON-LD/metadata, e sem selo "Autoria humana". O admin continua mostrando a origem. Vale só para notícias (o robô não escreve guias).
2. **Data retroativa na API**: campo opcional `publishedAt` (somente passado, até 3 meses e pouco atrás) para chaves com escopo `publish`. Matéria retroativa não gera notificação, newsletter nem push.
3. **Categorias novas**: `MERCADO`, `ENTRETENIMENTO`, `TECNOLOGIA` no schema da API, nas abas/filtros de /noticias e da home, e no CMS. Isso adianta **só a parte de categorias** da F7 do Plano 4. As manchetes externas (RSS de manchete + link) de Entretenimento/Tecnologia continuam no Plano 4.
4. **Leitura para o robô** (escopo de leitura da chave):
   - **Dados do jogo** para o bloco "No Tralked": conquistas (com `apiName`, nome, raridade), horas médias dos jogadores do Tralked, plataformas e data de lançamento. Só dados agregados, nunca de usuário individual.
   - **Matérias publicadas recentes de qualquer autor** (título, slug, data, jogos), para o robô não repetir o que a equipe já cobriu. Hoje a API só mostra à chave as próprias matérias.
5. A documentação da API (`/desenvolvedores`, OpenAPI) é atualizada com o que mudou.

Valem as restrições de sempre do site (pt-BR, zod, axe sem erros sérios, migrations aplicadas pelo controller, nunca escrever em `gamelog`/`gamelog_dev`).

## Não-objetivos
- Guias e matérias de comunidade.
- Revisão humana antes de publicar (Lucas: "entram sozinhas").
- Publicar em redes sociais (fica para depois).
- Gerar imagens com IA.

## Anti-objetivos (seria fracasso mesmo funcionando)
- Inventar fato, número ou citação.
- Matérias repetidas sobre o mesmo fato, inclusive repetindo o que a equipe humana já publicou.
- Volume que pareça fábrica de conteúdo e arrisque punição do Google ao domínio inteiro.
- Tomar partido em qualquer coisa que não seja a defesa do gamer/consumidor.
- Clickbait que engana.
- Copiar texto ou foto de outros portais.
- Carimbar matéria de IA como "Autoria humana".
- Conta de IA estourando sem controle.

## Do Lucas
- Chave da Anthropic (`ANTHROPIC_API_KEY`) no `.env` do robô.
- Criar no admin do site uma chave de API de robô com escopo `publish` (ou deixar o builder criar via script no banco de dev e ele cria a de produção).

## Deixado para o builder
Biblioteca de RSS/extração de texto, formato exato do prompt de estilo, critérios finos de relevância, URLs exatas das fontes (verificar cada uma), estrutura interna do SQLite, como resolver jogos ausentes no catálogo e se o retroativo e o ciclo normal rodam em paralelo.

## Adendo — Pautas Tralked (matérias especiais sobre jogos famosos)

Pedido do Lucas (2026-10-31): o robô também cria matérias sobre jogos famosos, "iguais às de exemplo" do site (Hollow Knight, Hades, Civilization VI, Baldur's Gate 3), "para ter insumos no site". Ele aprovou a proposta abaixo ("ok").

- **O que são:** matérias especiais atemporais sobre jogos famosos, com olhar de caçador de conquistas e de jogador casual. Não são notícias do dia.
- **Escolha do jogo:** lista curada de ~150 jogos famosos em `ROBO NOTICIAS/config/jogos-famosos.json`, com nome, `steamAppId` quando houver e URL da wiki. O robô sorteia um jogo que não ganhou pauta nos últimos **60 dias**, e só se o jogo existir no catálogo do Tralked (e não for stub).
- **Formatos:**
  1. "*Jogo* tem N conquistas: vale a pena caçar o 100%?"
  2. "As 5 conquistas mais raras de *jogo* e o que cada uma pede"
  3. "Conquistas perdíveis de *jogo*: o que saber antes de começar"
  4. "*Jogo* para iniciantes: por onde começar"
- **Fontes, para não inventar nada:** os dados do Tralked (lista completa de conquistas com descrição e raridade, tempo para zerar e completar, horas médias), a página do jogo na Steam e a wiki do jogo. Todas são citadas em "Fontes". Sem material suficiente para um formato, o robô troca de formato, e se nenhum servir pula o jogo. Ele nunca chuta.
- **Cara:** a mesma das notícias. Assinatura "Equipe Tralked", "Em 3 pontos", "No Tralked", pergunta no fim. Categoria **GAMES**, ou **GUIAS** para os formatos 3 e 4.
- **Quantidade (Lucas aprovou):**
  - **Retroativo:** +90 pautas, uma por dia nos 3 meses, além das ~750 notícias, com horário entre 06h e 00h.
  - **Dia a dia:** até **2 por dia, dentro do limite de 15**. A pauta ocupa um horário em que a melhor notícia da fila tem pontuação menor que 60. Se até o horário das 20h nenhuma pauta saiu no dia, o horário das 20h é de pauta. Notícia bomba sempre tem prioridade.
- **Custo extra:** ~US$ 6 no retroativo e ~US$ 7 por mês.
- **No site:** um endpoint de leitura com o dossiê do jogo (todas as conquistas visíveis, com descrição e raridade, resumo, datas, tempos, `steamAppId`), só com dados agregados.
