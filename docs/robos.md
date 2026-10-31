# Robôs no Tralked: guia para quem escreve os robôs

Este documento explica como um robô cria notícias e guias de conquistas no Tralked pela API `/api/v1`. O mesmo conteúdo está no site em `/desenvolvedores`. A descrição OpenAPI 3.1 fica em `/api/v1/openapi.json`. Para validar os payloads antes de enviar, use os JSON Schemas em `/api/v1/schemas/article.json` e `/api/v1/schemas/guide.json`.

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
| `guides:write` | Criar o guia de um jogo, atualizar os próprios e consultar o status deles. |
| `publish` | Publicar direto, sem passar pela fila de revisão, e alterar o que já está publicado. |
| `media:write` | Reservado para o envio de imagens. Nenhum endpoint usa este escopo ainda. |

## Endpoints

| Método | Caminho | Escopo | O que faz |
| --- | --- | --- | --- |
| POST | `/api/v1/articles` | `articles:write` | Cria uma notícia e responde 201. |
| GET | `/api/v1/articles/{id}` | `articles:write` | Mostra o status de uma notícia desta chave. |
| PATCH | `/api/v1/articles/{id}` | `articles:write` | Altera campos de uma notícia desta chave. |
| POST | `/api/v1/guides` | `guides:write` | Cria o guia de um jogo (um guia por jogo) e responde 201. |
| GET | `/api/v1/guides/{id}` | `guides:write` | Mostra o status e a versão de um guia desta chave. |
| PATCH | `/api/v1/guides/{id}` | `guides:write` | Atualiza um guia desta chave e salva uma nova versão. |
| GET | `/api/v1/games` | qualquer chave | Procura jogos por nome, slug, `steamAppId` ou `igdbId`. |
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

Cada item de `games` indica o jogo por exatamente um destes campos: `slug`, `steamAppId` ou `igdbId`. O jogo precisa existir no catálogo.

`status` aceita `review` ou `published`. Sem ele, a notícia vai para a revisão, ou é publicada direto se a chave tiver o escopo `publish`. Pedir `published` sem esse escopo dá `403`.

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
      "youtubeId": "ID_DO_VIDEO"
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

```bash
curl "$TRALKED_URL/api/v1/articles/ID_DA_NOTICIA" \
  -H "Authorization: Bearer $TRALKED_KEY"
```

## Blocos de conteúdo

Notícias e guias usam o mesmo formato de blocos. Campos desconhecidos são recusados. Nenhum texto aceita HTML, nem URLs `javascript:`, `data:` ou `vbscript:`.

Parágrafos, itens de lista, citações, avisos e células de tabela aceitam uma marcação inline restrita:

- `**negrito**`
- `*itálico*`
- `[texto](https://…)`, com link http ou https

Títulos, legendas e créditos são texto puro.

As quebras de linha `\r\n` e `\r` viram `\n` antes da validação. Os outros caracteres de controle são recusados, com exceção da tabulação.

| type | Campos | Regras |
| --- | --- | --- |
| `heading` | `level` (2 ou 3), `text` | Texto puro, até 200 caracteres. |
| `paragraph` | `text` | Marcação inline, até 5000 caracteres. |
| `list` | `ordered`, `items[]` | De 1 a 100 itens, com marcação inline. |
| `quote` | `text`, `author?` | Citação com marcação inline. O autor é texto puro. |
| `image` | `url`, `alt`, `credit` | Só `https://`. O texto alternativo e o crédito são obrigatórios. |
| `video` | `youtubeId` | Os 11 caracteres do ID do YouTube, não a URL. |
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

```bash
curl -X PATCH "$TRALKED_URL/api/v1/guides/ID_DO_GUIA" \
  -H "Authorization: Bearer $TRALKED_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{"version": "v1.1", "warnings": ["Aviso revisado."]}'
```

## Encontrar o jogo

Antes de escrever, confirme que o jogo existe no catálogo. Informe um destes parâmetros:

- `q`: parte do nome ou um apelido do jogo
- `slug`
- `steamAppId`
- `igdbId`

A resposta traz até 20 jogos e, para cada um, o guia que ele tiver.

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

## Respostas e erros

Em caso de sucesso, a API responde `201` ao criar e `200` ao alterar ou consultar.

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
| 400 | `bad_request` | Um parâmetro de busca de `GET /api/v1/games` é inválido. |
| 400 | `invalid_json` | O corpo não é JSON. |
| 400 | `idempotency_key_required` | Falta o cabeçalho `Idempotency-Key` em POST ou PATCH. |
| 401 | `unauthorized` | A chave está ausente, é inválida ou foi revogada. |
| 403 | `forbidden` | A chave não tem o escopo do endpoint, ou pediu `published` sem o escopo `publish`. |
| 404 | `not_found` | O id não existe, ou o conteúdo foi criado por outra chave. |
| 409 | `slug_conflict` | Já existe uma notícia com esse slug (enviado ou gerado do título). |
| 409 | `guide_exists` | O jogo já tem guia. A mensagem traz o id; se o guia for desta chave, use PATCH. |
| 409 | `published_locked` | A redação já publicou o conteúdo, e só uma chave com `publish` pode alterá-lo. |
| 409 | `idempotency_conflict` | O `Idempotency-Key` já foi usado com outro corpo ou em outro endpoint. |
| 413 | `payload_too_large` | O corpo passa de 1 MiB. |
| 422 | `validation_failed` | Há campos inválidos. Cada item de `issues` aponta o campo por JSON Pointer. |
| 429 | `rate_limited` | A chave passou de 60 requisições no minuto. Espere os segundos indicados em `Retry-After`. |

## Idempotência

Gere um `Idempotency-Key` para cada conteúdo, com 1 a 255 caracteres ASCII visíveis. Reutilize a mesma chave só para repetir o mesmo envio, por exemplo depois de um timeout.

- **Mesma chave e mesmo corpo:** a API devolve a resposta original com o cabeçalho `Idempotent-Replayed: true` e não cria nada de novo. A ordem dos campos no JSON não importa.
- **Mesma chave com outro corpo ou em outro endpoint:** a resposta é `409 idempotency_conflict`.
- **Requisição recusada (`403`, `409` ou `422`):** a chave não é gasta. Corrija o corpo e reenvie com a mesma chave.
- Cada chave de API tem os seus próprios valores de `Idempotency-Key`.

## Limites

- **60 requisições por minuto por chave.** Toda resposta autenticada traz os cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (segundos até a janela zerar). Acima do limite, a resposta é `429` com o cabeçalho `Retry-After`.
- **Corpo de até 1 MiB.**
- **Tamanho do conteúdo:** até 300 blocos por notícia, 60 etapas por guia e 10 jogos por notícia.
- **Imagens:** só por URL https, com texto alternativo e crédito. A API não recebe arquivos.

## Checklist do robô

1. Procure o jogo em `GET /api/v1/games`.
2. Monte o payload e valide com o JSON Schema.
3. Gere um `Idempotency-Key` e envie.
4. Em caso de timeout ou erro 5xx, reenvie com a mesma chave.
5. Se receber `422`, corrija os campos apontados em `issues` e reenvie, que pode ser com a mesma chave.
6. Guarde o `id` da resposta para consultar o status e fazer PATCH depois.
