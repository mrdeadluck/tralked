# Robôs no Tralked: guia para quem escreve os robôs

Este documento explica como um robô cria notícias e guias de conquistas no Tralked pela API `/api/v1`, e como o robô de guias pega os pedidos da fila e envia as imagens. O mesmo conteúdo está no site em `/desenvolvedores`. A descrição OpenAPI 3.1 fica em `/api/v1/openapi.json`. Para validar os payloads antes de enviar, use os JSON Schemas em `/api/v1/schemas/article.json` e `/api/v1/schemas/guide.json`.

Os exemplos usam duas variáveis de ambiente: `TRALKED_URL` guarda o domínio do Tralked e `TRALKED_KEY` guarda a chave.

## Como funciona

- Corpo e respostas são JSON em UTF-8. Envie `Content-Type: application/json`.
- O conteúdo é escrito em blocos (`ContentBlock[]`), sem HTML. O site renderiza os blocos com a identidade do Tralked.
- Toda escrita (POST e PATCH) leva um `Idempotency-Key` novo, por exemplo um UUID.
- Sem o escopo `publish`, notícias e guias entram com status `review` na fila de revisão do admin, e um editor os publica.
- Notícias de robô são assinadas como `Robô <nome da chave>` e nunca recebem o selo "Autoria humana". Quando um editor aprova a notícia, ela mostra "Gerado por robô · revisado pela redação". Uma notícia publicada direto, por uma chave com `publish`, mostra só "Gerado por robô".

## Chave e escopos

Um administrador cria a chave no admin e escolhe os escopos. A chave tem o formato `tk_live_` seguido de 43 caracteres. Ela aparece uma única vez, porque o Tralked guarda só o hash SHA-256. Guarde a chave num cofre de segredos e envie em toda requisição:

```
Authorization: Bearer tk_live_…
```

Uma chave revogada para de funcionar na hora e passa a receber `401`. Cada chave só vê e altera o conteúdo que ela mesma criou.

| Escopo | Permite |
| --- | --- |
| `articles:write` | Criar notícias, alterar as próprias e consultar o status delas. |
| `guides:write` | Criar o guia de um jogo, atualizar os próprios e consultar o status deles. Pegar e relatar os pedidos de guia da fila e ler o dossiê completo de um jogo (`?all=1`). |
| `publish` | Publicar direto, sem passar pela fila de revisão, e alterar o que já está publicado. |
| `media:write` | Enviar imagens (PNG, JPEG ou WebP, até 4 MiB) em `POST /api/v1/media`. |

## Endpoints

| Método | Caminho | Escopo | O que faz |
| --- | --- | --- | --- |
| GET | `/api/v1/articles` | qualquer chave | Lista as notícias publicadas recentemente, de qualquer autor. |
| POST | `/api/v1/articles` | `articles:write` | Cria uma notícia e responde 201. |
| GET | `/api/v1/articles/{id}` | `articles:write` | Mostra o status de uma notícia desta chave. |
| PATCH | `/api/v1/articles/{id}` | `articles:write` | Altera campos de uma notícia desta chave. |
| POST | `/api/v1/guides` | `guides:write` | Cria o guia de um jogo (um guia por jogo) e responde 201. |
| GET | `/api/v1/guides/{id}` | `guides:write` | Mostra o status e a versão de um guia desta chave. |
| PATCH | `/api/v1/guides/{id}` | `guides:write` | Atualiza um guia desta chave e salva uma nova versão. Num guia publicado, sem `publish`, responde `202 pending_review` e a atualização espera um editor. |
| POST | `/api/v1/guide-requests/next` | `guides:write` | Pega o próximo pedido de guia da fila. Responde 204 quando não há pedido. |
| PATCH | `/api/v1/guide-requests/{id}` | `guides:write` | Relata o andamento de um pedido: `researching`, `writing`, `review`, `waiting_sources` ou `failed`. |
| POST | `/api/v1/media` | `media:write` | Envia uma imagem (corpo cru) e responde 201 com a URL https da versão WebP. |
| GET | `/api/v1/games` | qualquer chave | Procura jogos por nome, slug, `steamAppId` ou `igdbId`; esconde os stubs do catálogo e ordena por popularidade. |
| GET | `/api/v1/games/{slug}/insights` | qualquer chave | Dados agregados do jogo entre os jogadores do Tralked. |
| GET | `/api/v1/games/{slug}/dossie` | qualquer chave (`?all=1`: `guides:write`) | Dossiê do jogo: ficha, números do Tralked e todas as conquistas visíveis. Com `?all=1`, também as ocultas, com os nomes em PT-BR. |
| GET | `/api/v1/games/{slug}/media` | qualquer chave | Imagens largas (banner, capturas de tela, artes) e vídeos do YouTube que o catálogo guarda do jogo. |
| GET | `/api/v1/openapi.json` | pública | Descrição OpenAPI 3.1 da API inteira. |
| GET | `/api/v1/schemas/article.json` | pública | JSON Schema do corpo de uma notícia. |
| GET | `/api/v1/schemas/guide.json` | pública | JSON Schema do corpo de um guia. |

## Criar uma notícia

Campos obrigatórios:

- `title`
- `category`: `GAMES`, `GUIAS` ou `COMUNIDADE`
- `blocks`: pelo menos um bloco

Campos opcionais:

- `subtitle`
- `excerpt`: o resumo mostrado nos cartões
- `slug`: gerado do título se não for enviado
- `platforms`: `PC`, `PLAYSTATION`, `XBOX` ou `NINTENDO`
- `games`
- `imageLabel`
- `status`
- `publishedAt`

Cada item de `games` indica o jogo por exatamente um destes campos: `slug`, `steamAppId` ou `igdbId`. O jogo precisa existir no catálogo.

`status` aceita `review` ou `published`. Sem ele, a notícia vai para a revisão, ou é publicada direto se a chave tiver o escopo `publish`. Pedir `published` sem esse escopo dá `403`.

`publishedAt` data a notícia para trás, por exemplo para uma pauta atemporal que não deve aparecer como a mais nova do site. Regras:

- Exige o escopo `publish` (sem ele, `403` em `/publishedAt`) e uma notícia publicada: com `status: "review"`, a resposta é `422`.
- É um horário ISO 8601 com fuso, como `2026-10-01T12:00:00-03:00`. Não pode estar mais de 5 minutos no futuro nem mais de 120 dias no passado; fora disso, `422` em `/publishedAt`.
- Sem `status`, uma chave com `publish` publica a notícia com essa data.

O exemplo abaixo usa todos os tipos de bloco:

<!-- exemplo:noticia -->
```json
{
  "title": "Hades recebe atualização com novo modo de desafio",
  "subtitle": "O pacote traz um modo de provações semanais e ajustes de equilíbrio em três armas.",
  "excerpt": "Novo modo de provações semanais chega com recompensas exclusivas e mudanças no Escudo do Caos.",
  "category": "GAMES",
  "platforms": [
    "PC",
    "PLAYSTATION",
    "XBOX",
    "NINTENDO"
  ],
  "games": [
    {
      "slug": "hades"
    }
  ],
  "imageLabel": "hades",
  "blocks": [
    {
      "type": "paragraph",
      "text": "A Supergiant liberou nesta terça a atualização **1.4** de Hades. O destaque é um modo de *provações semanais*, com regras novas a cada segunda-feira. As notas completas estão no [site oficial](https://www.supergiantgames.com/)."
    },
    {
      "type": "heading",
      "level": 2,
      "text": "O que muda"
    },
    {
      "type": "list",
      "ordered": false,
      "items": [
        "Provações semanais com placar entre amigos",
        "Escudo do Caos: o golpe carregado ficou **15% mais rápido**",
        "Correções de desempenho no Switch"
      ]
    },
    {
      "type": "heading",
      "level": 3,
      "text": "Como liberar o modo"
    },
    {
      "type": "list",
      "ordered": true,
      "items": [
        "Termine uma fuga do Tártaro",
        "Fale com Hipnos no saguão",
        "Escolha a provação da semana"
      ]
    },
    {
      "type": "quote",
      "text": "Queríamos um motivo para voltar ao Submundo toda semana.",
      "author": "Equipe da Supergiant"
    },
    {
      "type": "image",
      "url": "https://cdn.exemplo.com.br/hades/provacoes.jpg",
      "alt": "Zagreus diante do quadro de provações no saguão da Casa de Hades",
      "credit": "Divulgação/Supergiant Games"
    },
    {
      "type": "video",
      "youtubeId": "ID_DO_VIDEO",
      "title": "Trailer do modo de provações de Hades II"
    },
    {
      "type": "callout",
      "tone": "info",
      "text": "A atualização é gratuita e chega a todas as plataformas no mesmo dia."
    },
    {
      "type": "callout",
      "tone": "aviso",
      "text": "Saves do modo de provações não contam para as conquistas da campanha."
    },
    {
      "type": "callout",
      "tone": "spoiler",
      "text": "A provação final libera uma conversa inédita com Perséfone."
    },
    {
      "type": "table",
      "header": [
        "Arma",
        "Antes",
        "Depois"
      ],
      "rows": [
        [
          "Escudo do Caos",
          "1,2 s",
          "1,0 s"
        ],
        [
          "Lança Eterna",
          "0,8 s",
          "0,8 s"
        ],
        [
          "Arco Coronacht",
          "1,5 s",
          "1,4 s"
        ]
      ]
    },
    {
      "type": "achievement",
      "apiName": "HELLBENT",
      "platform": "steam"
    },
    {
      "type": "divider"
    },
    {
      "type": "paragraph",
      "text": "*Texto gerado por robô a partir das notas oficiais da atualização.*"
    }
  ]
}
```

```bash
curl -X POST "$TRALKED_URL/api/v1/articles" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data @noticia.json
```

A resposta é `201`. A URL só abre no site depois que a notícia é publicada:

```json
{
  "id": "cmh1x9q0k0001qz8f3v2b7d4e",
  "status": "review",
  "url": "https://seu-dominio/noticias/hades-recebe-atualizacao-com-novo-modo-de-desafio"
}
```

### Acompanhar e corrigir

`GET /api/v1/articles/{id}` devolve o `status`, o campo `reviewed` (se um editor aprovou a notícia) e as datas.

`PATCH /api/v1/articles/{id}` troca só os campos enviados:

- `blocks` e `games` são substituídos por inteiro.
- O `slug` não muda.
- Depois que a redação publica a notícia, só uma chave com o escopo `publish` pode alterá-la. Sem ele, a resposta é `409 published_locked`.
- `status` aceita `review`, `published` e `archived`. Arquivar exige o escopo `publish`: a notícia sai do site e das listas, e o POST continua recusando `archived`. Publicar de novo uma notícia arquivada devolve a notícia ao site com a data que ela já tinha (inclusive uma `publishedAt` do POST); só a primeira publicação usa o horário do momento.

```bash
curl "$TRALKED_URL/api/v1/articles/ID_DA_NOTICIA" \
  -H "Authorization: Bearer $TRALKED_KEY"
```

### Evitar repetição

`GET /api/v1/articles` lista as notícias publicadas, da mais nova para a mais antiga, de qualquer autor: da redação e de qualquer robô. Use antes de escrever, para não repetir o que o site já cobriu. Parâmetros:

- `since`: horário ISO 8601 com fuso. Devolve as notícias publicadas a partir dele. O padrão é 7 dias atrás. Codifique o `+` de um fuso como `%2B`.
- `limit`: de 1 a 200. O padrão é 100.

Rascunhos, notícias na fila de revisão e notícias arquivadas não aparecem. Um parâmetro inválido dá `400 bad_request`, com o nome dele em `issues[].path` (`?since` ou `?limit`).

```bash
curl "$TRALKED_URL/api/v1/articles?since=2026-10-01T00:00:00Z&limit=50"   -H "Authorization: Bearer $TRALKED_KEY"
```

Cada item traz `id`, `slug`, `title`, `category`, `publishedAt`, `source` (`editorial` ou `bot`) e `games` (os slugs dos jogos da notícia, sem os stubs do catálogo):

```json
{
  "articles": [
    {
      "id": "cmh1x9q0k0001qz8f3v2b7d4e",
      "slug": "hades-recebe-atualizacao-com-novo-modo-de-desafio",
      "title": "Hades recebe atualização com novo modo de desafio",
      "category": "GAMES",
      "publishedAt": "2026-10-28T14:00:00.000Z",
      "source": "bot",
      "games": ["hades"]
    }
  ]
}
```

## Blocos de conteúdo

Notícias e guias usam o mesmo formato de blocos. Campos desconhecidos são recusados. Nenhum texto aceita HTML, nem URLs `javascript:`, `data:` ou `vbscript:`.

Parágrafos, itens de lista, citações, avisos e células de tabela aceitam uma marcação inline restrita:

- `**negrito**`
- `*itálico*`
- `[texto](https://…)`, com link http ou https
- `||spoiler||`, só nos detonados (guia formato 2): um trecho escondido até o leitor ligar os spoilers, como o nome de um chefe, uma reviravolta ou o nome de uma conquista oculta no meio do texto. Vale também nos textos do "leia antes", no `location` dos itens, no `deadline` dos capítulos e nas etapas do roadmap (título e texto), que a página também esconde. Nos dados para buscadores (JSON-LD) o trecho sai sem as marcas, com o texto. Nos outros campos de texto puro (nomes, títulos de capítulo, capa, visão geral) `||` não esconde nada: não ponha spoiler ali. Nos blocos `heading` e no cabeçalho (`header`) das tabelas de um passo do detonado, `||` é recusado com `422`, porque a página mostraria as barras. Todo `||` precisa fechar; fora dos detonados, `||` é texto comum.

Títulos, legendas e créditos são texto puro.

As quebras de linha `\r\n` e `\r` viram `\n` antes da validação. Os outros caracteres de controle são recusados, com exceção da tabulação.

| type | Campos | Regras |
| --- | --- | --- |
| `heading` | `level` (2 ou 3), `text` | Texto puro, até 200 caracteres. |
| `paragraph` | `text` | Marcação inline, até 5000 caracteres. |
| `list` | `ordered`, `items[]` | De 1 a 100 itens, com marcação inline. |
| `quote` | `text`, `author?` | Citação com marcação inline. O autor é texto puro. |
| `image` | `url`, `alt`, `credit` | Só `https://`. O texto alternativo e o crédito são obrigatórios. |
| `video` | `youtubeId`, `title?` | Os 11 caracteres do ID do YouTube, não a URL. `title` (texto puro, até 200 caracteres) diz o que é o vídeo: vira a legenda e o nome acessível do player. O site embute pelo youtube-nocookie.com, com carregamento preguiçoso e proporção 16:9. |
| `callout` | `tone`, `text` | `tone` é `info`, `aviso` ou `spoiler`. O spoiler aparece fechado. |
| `table` | `header[]`, `rows[][]` | Até 8 colunas. Toda linha tem o mesmo número de colunas do cabeçalho. |
| `achievement` | `apiName`, `platform?` | Mostra o cartão da conquista com raridade e XP. `platform` é `steam` (padrão), `psn`, `xbox` ou `retro`. |
| `divider` | nenhum | Separador horizontal. |

## Criar um guia

Cada jogo tem um único guia. O corpo traz:

- o jogo (`game`);
- a ficha (`facts`): dificuldade de 1 a 10, horas, número de jogadas, conquistas perdíveis e conquistas online;
- `overview` e `warnings`, em texto puro;
- uma introdução opcional em blocos (`body`);
- as etapas (`steps`);
- as notas por conquista (`achievementNotes`);
- os coletáveis (`collectibles`);
- as fontes (`sources`).

Em `steps[].achievements` vão os apiNames Steam liberados naquela etapa. Cada nota indica a conquista por `apiName` e `platform` (o padrão é `steam`). A categoria da nota é `historia`, `chefes`, `coletaveis`, `desafio` ou `dlc`. Toda conquista citada precisa existir no jogo. Se não existir, a resposta é `422` com o caminho exato do campo.

<!-- exemplo:guia -->
```json
{
  "game": {
    "steamAppId": 1145360
  },
  "version": "v1.0",
  "facts": {
    "difficulty": 6,
    "hoursMin": 40,
    "hoursMax": 60,
    "playthroughs": "1 (várias fugas)",
    "missables": 0,
    "online": 0
  },
  "overview": [
    "Hades é um roguelike de ação: cada fuga do Submundo leva de 30 a 50 minutos, e o progresso permanente vem dos espelhos, das armas e das relações com os deuses.",
    "Nenhuma conquista é perdível. A mais demorada pede 10 fugas completas, e a mais difícil exige Calor 32 no Pacto da Punição."
  ],
  "warnings": [
    "Não gaste Diamantes na decoração antes de liberar as melhorias do Contrato da Casa que dão Recursos."
  ],
  "body": [
    {
      "type": "paragraph",
      "text": "Este guia segue a ordem mais rápida para o 100%: história primeiro, depois relações e por fim o Calor alto."
    }
  ],
  "steps": [
    {
      "title": "Primeira fuga e história principal",
      "hours": "15 a 25 h",
      "body": [
        {
          "type": "paragraph",
          "text": "Jogue no ritmo normal até completar a **primeira fuga**. Invista no Espelho da Noite: *Persistência da Morte* e *Defesa Sombria* primeiro."
        },
        {
          "type": "list",
          "ordered": true,
          "items": [
            "Libere as seis armas",
            "Complete 10 fugas para ver o epílogo"
          ]
        }
      ],
      "achievements": []
    },
    {
      "title": "Calor alto",
      "hours": "10 a 20 h",
      "body": [
        {
          "type": "paragraph",
          "text": "Com as armas melhoradas, suba o Pacto da Punição aos poucos. O Escudo do Caos com o aspecto de Beowulf é a escolha mais segura."
        },
        {
          "type": "callout",
          "tone": "aviso",
          "text": "Calor acima de 20 deixa os chefes com fases extras."
        }
      ],
      "achievements": [
        "HELLBENT"
      ]
    }
  ],
  "achievementNotes": [
    {
      "apiName": "HELLBENT",
      "platform": "steam",
      "category": "desafio",
      "spoiler": false,
      "tip": [
        {
          "type": "paragraph",
          "text": "Ative condições até somar **Calor 32** e vença uma fuga. Prefira Tempo Limitado e Sem Recompensas a aumentar o dano dos inimigos."
        }
      ],
      "steps": [
        "Melhore o Espelho da Noite por completo",
        "Use o Escudo do Caos (aspecto de Beowulf)"
      ]
    }
  ],
  "collectibles": [
    {
      "name": "Armas infernais",
      "total": 6,
      "description": "Cada uma com quatro aspectos."
    },
    {
      "name": "Lembranças",
      "total": 25,
      "description": "Presentes dados pelos personagens em troca de néctar."
    }
  ],
  "sources": [
    {
      "title": "Hades, página oficial",
      "url": "https://www.supergiantgames.com/games/hades/"
    }
  ]
}
```

```bash
curl -X POST "$TRALKED_URL/api/v1/guides" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data @guia.json
```

A resposta é `201` com `id`, `status`, `url` e `revision: 1`. Se o jogo já tiver um guia, a resposta é `409 guide_exists` com o id desse guia.

### Atualizar

`PATCH /api/v1/guides/{id}` aceita qualquer campo do guia, menos `game`.

- Cada campo enviado substitui o atual por inteiro.
- As etapas e o progresso dos leitores (a marca de "feita" em cada etapa):
  - Dê a cada etapa uma `key` estável (letras minúsculas, números e hífens, por exemplo `"chefe-final"`), em todas as etapas ou em nenhuma. Com `key`, as etapas são casadas pela `key`: você pode reordenar, incluir e remover etapas, e a marca de cada leitor continua na etapa certa. Uma etapa removida perde só as marcas dela. Um guia antigo, cujas etapas ainda não têm `key`, adota as `key` por posição no primeiro envio com o mesmo número de etapas.
  - Sem `key`, as etapas são casadas por posição, e só quando o número de etapas não muda. Se o número mudar, a resposta é `422` em `/steps`: mande `key` em cada etapa para incluir, remover ou reordenar.
- Toda criação e toda atualização salvam uma versão completa do guia, que a redação pode comparar e restaurar. A resposta traz o número dessa versão em `revision`.
- **Guia já publicado, chave sem `publish`:** a resposta é `202` com `{ "id", "status": "pending_review", "pendingId" }`. O guia no ar não muda. A atualização fica guardada até um editor aplicá-la ou descartá-la no admin. Uma atualização nova do mesmo guia substitui a que ainda esperava (o robô manda o guia inteiro a cada vez), e aplicar uma descarta as mais antigas. Uma chave com `publish` altera o guia publicado direto, com `200`.
- **Um guia publicado continua publicado:** o `status` que vier num PATCH (`review` ou `draft`) é ignorado num guia já publicado, direto ou ao aplicar a atualização pendente. Só a redação tira um guia do ar.

```bash
curl -X PATCH "$TRALKED_URL/api/v1/guides/ID_DO_GUIA" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{"version": "v1.1", "warnings": ["Aviso revisado."]}'
```

## Guia formato 2 (roteiro do robô)

O robô de guias envia `"format": 2`. O guia de formato 2 é um roteiro (`walkthrough`) que o leitor segue e marca item por item. O corpo traz os campos do guia clássico e mais:

- `format`: `2`. Sem ele, o guia é o clássico (`1`).
- `walkthrough`, obrigatório no formato 2:
  - `cover`: exatamente 3 destaques (`calls`), as horas do selo (`sealHours`), o título (`headline`) e a linha de apoio (`deck`);
  - `extraFacts`: conquistas bugadas (`buggedCount`), a mais difícil (`hardest`, por `apiName`, ou `null`) e as notas de jogadas e dificuldade;
  - `compat`: o selo de plataforma, `steam_only`, `psn_xbox`, `psn` ou `xbox`;
  - `scope`, opcional: a lista que o guia cobre. `steam` (o padrão) cobre todas as conquistas da Steam. `psn` segue a lista de troféus da PSN, quando nenhuma fonte explica ainda as conquistas que só existem na Steam. Com `psn`, o roteiro traz também:
    - `psnList`: `total`, o número de troféus da lista da PSN (com o troféu máximo), e `names`, os nomes em inglês como a fonte os lista (exatamente `total` nomes);
    - `steamOnly`: os apiNames Steam que o guia não cobre. A página os mostra no bloco "Só na Steam — sem roteiro ainda", sem nenhum "como fazer". A lista pode ser vazia.
  - `readFirst`: de 1 a 8 avisos de "leia antes" (`tone` `aviso` ou `info`, com `spoiler`);
  - `chapters`: os capítulos. Cada um aponta em `phaseKey` a `key` de uma das `steps` e tem os seus passos (`steps`), cada passo com até 40 itens;
  - `soundtrack`, opcional: só um vídeo (`youtubeId`) ou uma playlist (`playlistId`) oficial do YouTube, com `title` e `channel`.
- `report`, opcional: o relatório do robô (fontes lidas, divergências, cobertura, gasto). O Tralked guarda o relatório como foi enviado e o mostra só para a redação.

Cada item (`items[]`) tem `key`, `kind` (`collectible`, `achievement`, `mission`, `key_item`, `boss` ou `other`), `name`, `missable`, `returnLater`, `spoiler`, `countsFor` (os apiNames Steam para os quais o item conta), `alsoOn` (`psn`, `xbox`), `sources` (de 1 a 10, com `name` e `url`) e `review` (`true` quando o robô tem dúvida e um editor precisa olhar). São opcionais `nameEn`, `collectibleType`, `index` e `total` (sempre juntos), `location`, `achievement` (o apiName Steam que o item é) e `image` (`url` https, `credit`, `sourceName` e `sourceUrl`).

O formato 2 tem regras que a API confere com o catálogo, com `422` no caminho exato:

- toda etapa (`steps[]`) tem `key`;
- toda `key` (capítulo, passo e item) é única no guia inteiro, porque as marcas dos leitores ficam presas à `key` do item;
- toda conquista Steam do jogo, ocultas incluídas, aparece em `achievement` de algum item. Com `scope: "psn"`, cada conquista Steam aparece em `achievement` de algum item **ou** em `steamOnly`, nunca nos dois: nenhuma fica de fora sem aviso;
- todo apiName de `steamOnly` é uma conquista Steam do jogo;
- todo apiName citado existe no jogo;
- `facts.missables` é igual ao número de itens do tipo `achievement` com `missable: true`.

O exemplo abaixo mostra um capítulo só. Um guia real cobre todas as conquistas do jogo:

<!-- exemplo:guia-v2 -->
```json
{
  "game": {
    "steamAppId": 2182200
  },
  "format": 2,
  "version": "v1.0",
  "facts": {
    "difficulty": 5,
    "hoursMin": 30,
    "hoursMax": 40,
    "playthroughs": "1",
    "missables": 1,
    "online": 0
  },
  "steps": [
    {
      "key": "ate-mirage-estate",
      "title": "Até a Mirage Estate",
      "hours": "4 a 6 h",
      "body": [
        {
          "type": "paragraph",
          "text": "Weeping Creek Valley e a Crimson Forest, com os coletáveis de cada região."
        }
      ],
      "achievements": []
    }
  ],
  "walkthrough": {
    "cover": {
      "calls": [
        { "value": "5/10", "label": "Dificuldade" },
        { "value": "30–40 h", "label": "Tempo até o Tralked" },
        { "value": "66", "label": "Conquistas" }
      ],
      "sealHours": "30–40 h",
      "headline": "O caminho até o Tralked",
      "deck": "Todos os coletáveis e as 66 conquistas da Steam, na ordem em que você passa por eles."
    },
    "extraFacts": {
      "buggedCount": 0,
      "hardest": null,
      "playthroughsNote": "NG+ existe, mas é opcional, só para limpeza.",
      "difficultyNote": "Nenhuma conquista pede dificuldade."
    },
    "compat": "steam_only",
    "readFirst": [
      {
        "title": "Saves manuais",
        "text": "Faça um save manual **no começo e no fim de cada região**.",
        "tone": "aviso",
        "spoiler": false
      }
    ],
    "chapters": [
      {
        "key": "regiao-1-weeping-creek",
        "phaseKey": "ate-mirage-estate",
        "title": "Weeping Creek Valley",
        "region": "Região 1 de 9",
        "hours": "3 a 4 h",
        "deadline": "Antes do chefe principal da Crimson Forest",
        "steps": [
          {
            "key": "r1-1",
            "body": [
              {
                "type": "paragraph",
                "text": "Siga até o andaime e desça a escada da direita para chegar ao sino **The Lady's Rift**."
              }
            ],
            "items": [
              {
                "key": "sino-lady-rift",
                "kind": "collectible",
                "name": "Sino · The Lady's Rift",
                "collectibleType": "sino",
                "index": 2,
                "total": 22,
                "location": "Ao pé da escada da direita, depois do andaime.",
                "missable": false,
                "returnLater": true,
                "spoiler": false,
                "countsFor": ["ACH_BELLS"],
                "alsoOn": [],
                "image": {
                  "url": "https://exemplo.public.blob.vercel-storage.com/guias/2026/11/3f2c9a7e-5b1d-4c2e-9a10-7d4e2b8c6f01.webp",
                  "credit": "Imagem: PowerPyx",
                  "sourceName": "PowerPyx",
                  "sourceUrl": "https://www.powerpyx.com/"
                },
                "sources": [
                  { "name": "PowerPyx", "url": "https://www.powerpyx.com/" },
                  { "name": "Guia Steam", "url": "https://steamcommunity.com/sharedfiles/filedetails/?id=1" }
                ],
                "review": false
              },
              {
                "key": "conquista-legado-curandeira",
                "kind": "achievement",
                "name": "Legado da Curandeira",
                "nameEn": "Healer's Legacy",
                "achievement": "ACH_HEALER_LEGACY",
                "location": "Conclua as três missões da curandeira antes do chefe da Crimson Forest.",
                "missable": true,
                "returnLater": false,
                "spoiler": false,
                "countsFor": [],
                "alsoOn": [],
                "sources": [
                  { "name": "PowerPyx", "url": "https://www.powerpyx.com/" }
                ],
                "review": true
              }
            ]
          }
        ]
      }
    ]
  },
  "report": {
    "sourcesRead": [
      { "name": "PowerPyx", "url": "https://www.powerpyx.com/", "ok": true }
    ],
    "divergences": [],
    "singleSource": ["ACH_HEALER_LEGACY"],
    "coverage": { "steam": 66, "covered": 66, "steamOnly": 0 },
    "spendUsd": 3.1
  }
}
```

## Pedidos de guia (robô de guias)

O robô de guias não escolhe jogos. Ele atende os pedidos que a redação põe na fila do admin, um por vez. Os dois endpoints exigem `guides:write`.

`POST /api/v1/guide-requests/next` pega o próximo pedido: o de maior prioridade e, entre eles, o mais antigo. Um pedido em `waiting_sources` volta a ser pego quando chega a hora da nova tentativa. Um pedido parado há mais de 4 horas em `researching` ou `writing` (o robô caiu no meio) também volta a ser pego, como nova tentativa; relate o andamento para que isso não aconteça com um pedido em curso. O pedido passa a `researching` e nenhum outro robô o recebe. Sem pedido, a resposta é `204`, sem corpo. Com pedido, a resposta é `200`:

```json
{
  "request": {
    "id": "cmw0d15eg0000m4tsev1lx0vq",
    "steamAppId": 4115450,
    "gameSlug": "phantom-blade-zero",
    "attempts": 1
  }
}
```

`gameSlug` é o slug para ler `GET /api/v1/games/{slug}/dossie?all=1`. `attempts` conta esta tentativa.

`PATCH /api/v1/guide-requests/{id}` relata o andamento. O corpo leva `status` e, se quiser, `reason` (texto até 2000 caracteres), `report` (objeto ou lista JSON) e `guideId`:

| `status` | Quando usar |
| --- | --- |
| `researching` | Lendo as fontes. |
| `writing` | Escrevendo o guia. |
| `review` | O guia foi criado ou atualizado e está na fila de revisão. Mande o `guideId`. Quando a redação publicar o guia, o pedido passa sozinho a `published`. |
| `waiting_sources` | Faltam fontes para cobrir o jogo. Mande em `report` o que falta. O Tralked agenda nova tentativa em 3 dias. Depois de 30 dias esperando, o pedido vira `failed` com o motivo "fontes insuficientes após 30 dias". |
| `failed` | O robô desistiu. Mande o motivo em `reason`. |

A resposta é `200` com `id`, `status`, `attempts` e `nextAttemptAt` (ou `null`). Um pedido cancelado ou já publicado não aceita relato: a resposta é `422 validation_failed`, e o robô deve parar. Um pedido que não existe dá `404`. Como toda escrita, o PATCH leva `Idempotency-Key`.

```bash
curl -X PATCH "$TRALKED_URL/api/v1/guide-requests/ID_DO_PEDIDO" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{"status": "review", "guideId": "ID_DO_GUIA"}'
```

## Enviar imagens

`POST /api/v1/media` (escopo `media:write`) recebe uma imagem para usar num guia. O corpo é o arquivo cru, não JSON:

- `Content-Type`: `image/png`, `image/jpeg` ou `image/webp`. Outro tipo dá `415 unsupported_media_type`.
- Até 4 MiB. Acima disso, `413 payload_too_large`.
- O Tralked decodifica a imagem, converte para WebP com no máximo 2048 px no lado maior e remove os metadados. Um arquivo que não é imagem de verdade dá `415`.
- O `Idempotency-Key` vale como nas outras escritas: o mesmo arquivo com a mesma chave devolve a mesma resposta.

A resposta é `201` com a URL https da versão WebP e o tamanho dela. Use essa URL em `image.url` de um item do roteiro:

```json
{
  "url": "https://exemplo.public.blob.vercel-storage.com/guias/2026/11/3f2c9a7e-5b1d-4c2e-9a10-7d4e2b8c6f01.webp",
  "width": 1280,
  "height": 720
}
```

```bash
curl -X POST "$TRALKED_URL/api/v1/media" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: image/png" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data-binary @sino.png
```

## Encontrar o jogo

Antes de escrever, confirme que o jogo existe no catálogo. Informe um destes parâmetros:

- `q`: parte do nome ou um apelido do jogo
- `slug`
- `steamAppId`
- `igdbId`

A resposta traz até 20 jogos e, para cada um, o guia que ele tiver. A busca esconde os stubs do catálogo (jogos importados só com o nome, sem ficha) em todos os parâmetros, e a busca por `q` ordena por popularidade, do mais popular para o menos, e depois por nome. Um jogo escondido não pode ser usado como fonte: `/insights` e `/dossie` respondem 404 para ele e o feed não lista o slug dele. Se a notícia citar o jogo de forma explícita em `games`, ele ainda é aceito.

```bash
curl "$TRALKED_URL/api/v1/games?q=hades" \
  -H "Authorization: Bearer $TRALKED_KEY"
```

```json
{
  "games": [
    {
      "id": "cmh0a1b2c0003qz8f9k1m2n3o",
      "slug": "hades",
      "name": "Hades",
      "steamAppId": 1145360,
      "igdbId": null,
      "aliases": [],
      "guide": null
    }
  ]
}
```

## Dados de um jogo

Três endpoints dão ao robô material sobre um jogo. Os três aceitam qualquer chave ativa e devolvem `404 not_found` para um slug que não existe no catálogo ou que é um stub. `/insights` e `/dossie` trazem só números agregados, nunca usuários; `/media` traz a mídia oficial que o catálogo já guarda.

`GET /api/v1/games/{slug}/insights` é o resumo curto:

- `game`: `slug`, `name`, `releaseDate`, `platforms`, `achievementCount` e `timeToBeatCompleteMin`;
- `tralked`: `players` (usuários com o jogo na biblioteca) e `avgPlaytimeMin`;
- `rarest`: as 5 conquistas visíveis com a menor raridade global, da mais rara para a menos (`platform`, `apiName`, `name`, `globalPct`).

`GET /api/v1/games/{slug}/dossie` é o dossiê completo, para uma pauta atemporal:

- `game`: `slug`, `name`, `steamAppId`, `summary`, `developer`, `publisher`, `releaseDate`, `platforms`, `criticScore`, `timeToBeatCompleteMin` e `achievementCount`. Os campos sem dado vêm `null`.
- `tralked`: `players`, `avgPlaytimeMin` e `completedPlayers` (usuários que zeraram o jogo).
- `achievements`: todas as conquistas visíveis, com `platform`, `apiName`, `name`, `description` e `globalPct`, da mais rara para a menos. As sem raridade vêm no fim. A lista tem no máximo 500 itens.

Conquistas ocultas não aparecem. A exceção é `?all=1`, que exige o escopo `guides:write`: a lista traz todas as conquistas, ocultas incluídas, cada uma com `hidden`, `namePt` e `descriptionPt` (o nome e a descrição em PT-BR da Steam, ou `null`), e o limite sobe para 5000. O robô de guias usa essa lista para conferir que o guia cobre o jogo inteiro. Para proteger os jogadores, `avgPlaytimeMin` só vem preenchido quando 3 ou mais jogadores jogaram o jogo; com menos, vem `null`.

```bash
curl "$TRALKED_URL/api/v1/games/hades/dossie"   -H "Authorization: Bearer $TRALKED_KEY"
```

`GET /api/v1/games/{slug}/media` é a mídia do jogo, para ilustrar uma matéria cuja fonte não trouxe imagem nem vídeo:

- `game`: `slug`, `name`, `developer` e `publisher` (para o crédito);
- `images`: até 12 imagens largas, todas https: primeiro o banner (`kind: "hero"`), depois as capturas de tela (`screenshot`) e as artes (`artwork`), na ordem do catálogo, com `width`, `height` e `source` (`igdb`, `sgdb`, `steam`…) quando conhecidos. Imagens do IGDB vêm no tamanho 1080p. A capa em retrato e o logo não entram;
- `videos`: até 6 vídeos do YouTube (`youtubeId`), na ordem do IGDB, que lista o trailer principal primeiro.

Use a imagem num bloco `image` com crédito (por exemplo, "Divulgação/Supergiant Games") e o vídeo num bloco `video`. A página da notícia não repete na capa uma imagem que já está no corpo.

## Respostas e erros

Em caso de sucesso, a API responde `201` ao criar e `200` ao alterar ou consultar. Há duas exceções: `202` no PATCH de um guia publicado feito por uma chave sem `publish`, e `204` em `POST /api/v1/guide-requests/next` quando a fila está vazia.

Todo erro tem o mesmo formato. Em `issues`, `path` é um JSON Pointer para o campo do corpo, e `""` indica o corpo inteiro. Em `GET /api/v1/games`, `path` indica o parâmetro, como `?steamAppId`.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "O corpo tem campos inválidos; veja issues.",
    "issues": [
      { "path": "/blocks/3/url", "message": "A imagem precisa de uma URL https://" },
      { "path": "/blocks/0/text", "message": "HTML não é permitido; use texto puro" },
      { "path": "/games/0", "message": "Jogo não encontrado (slug \"hadez\"). Procure o jogo em GET /api/v1/games?q=…" },
      { "path": "/html", "message": "Campo desconhecido" }
    ]
  }
}
```

| HTTP | code | Quando acontece |
| --- | --- | --- |
| 400 | `bad_request` | Um parâmetro de busca de `GET /api/v1/games` ou `GET /api/v1/articles` é inválido. |
| 400 | `invalid_json` | O corpo não é JSON. |
| 400 | `idempotency_key_required` | Falta o cabeçalho `Idempotency-Key` em POST ou PATCH. |
| 401 | `unauthorized` | A chave está ausente, é inválida ou foi revogada. |
| 403 | `forbidden` | A chave não tem o escopo do endpoint, ou pediu `published` sem o escopo `publish`. |
| 404 | `not_found` | O id não existe, ou o conteúdo foi criado por outra chave. Em `/insights`, `/dossie` e `/games/{slug}/media`, o jogo não existe no catálogo ou é um stub. |
| 409 | `slug_conflict` | Já existe uma notícia com esse slug (enviado ou gerado do título). |
| 409 | `guide_exists` | O jogo já tem guia. A mensagem traz o id; se o guia for desta chave, use PATCH. |
| 409 | `published_locked` | A redação já publicou a notícia, e só uma chave com `publish` pode alterá-la. Num guia publicado, o PATCH não dá este erro: responde `202 pending_review`. |
| 409 | `idempotency_conflict` | O `Idempotency-Key` já foi usado com outro corpo ou em outro endpoint. |
| 413 | `payload_too_large` | O corpo passa de 1 MiB, ou a imagem de `POST /api/v1/media` passa de 4 MiB. |
| 415 | `unsupported_media_type` | Em `POST /api/v1/media`, o `Content-Type` não é `image/png`, `image/jpeg` ou `image/webp`, ou o arquivo não é uma imagem válida. |
| 422 | `validation_failed` | Há campos inválidos. Cada item de `issues` aponta o campo por JSON Pointer. Em `PATCH /api/v1/guide-requests/{id}`, também quando o pedido foi cancelado ou já foi publicado. |
| 429 | `rate_limited` | A chave passou de 60 requisições no minuto. Espere os segundos indicados em `Retry-After`. |

## Idempotência

Gere um `Idempotency-Key` para cada conteúdo, com 1 a 255 caracteres ASCII visíveis. Reutilize a mesma chave só para repetir o mesmo envio, por exemplo depois de um timeout.

- **Mesma chave e mesmo corpo:** a API devolve a resposta original com o cabeçalho `Idempotent-Replayed: true` e não cria nada de novo. A ordem dos campos no JSON não importa.
- **Mesma chave com outro corpo ou em outro endpoint:** a resposta é `409 idempotency_conflict`.
- **Requisição recusada (`403`, `409` ou `422`):** a chave não é gasta. Corrija o corpo e reenvie com a mesma chave.
- Cada chave de API tem os seus próprios valores de `Idempotency-Key`.

## Limites

- **60 requisições por minuto por chave.** Toda resposta autenticada traz os cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (segundos até a janela zerar). Acima do limite, a resposta é `429` com o cabeçalho `Retry-After`.
- **Corpo de até 1 MiB** (imagem de até 4 MiB em `POST /api/v1/media`), com no máximo 64 níveis de listas e objetos aninhados (acima disso: `422 validation_failed`, sem `issues`).
- **Tamanho do conteúdo:** até 300 blocos por notícia, 60 etapas por guia e 10 jogos por notícia. No formato 2, até 60 capítulos, 80 passos por capítulo e 40 itens por passo.
- **Imagens:** por URL https, com texto alternativo e crédito. Para hospedar a imagem no Tralked, envie o arquivo em `POST /api/v1/media` (escopo `media:write`) e use a URL da resposta.

## Checklist do robô

1. Procure o jogo em `GET /api/v1/games` e confira em `GET /api/v1/articles` se o site já cobriu o assunto.
2. Monte o payload e valide com o JSON Schema.
3. Gere um `Idempotency-Key` e envie.
4. Em caso de timeout ou erro 5xx, reenvie com a mesma chave.
5. Se receber `422`, corrija os campos apontados em `issues` e reenvie, que pode ser com a mesma chave.
6. Guarde o `id` da resposta para consultar o status e fazer PATCH depois.
