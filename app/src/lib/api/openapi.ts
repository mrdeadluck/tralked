import { z } from "zod";
import { guidePatchSchema, guidePayloadSchema } from "@/lib/content/guide-schema";
import { EXAMPLE_GUIDE, EXAMPLE_GUIDE_V2 } from "./examples";
import { articlePatchSchema, articlePayloadSchema } from "./article-schema";
import { ERROR_STATUS } from "./errors";
import { API_SCOPES } from "./keys";
import { RATE_LIMIT } from "./rate-limit";

/**
 * JSON Schema (draft 2020-12) of the request bodies, generated from the same zod schemas the API
 * validates with, plus the OpenAPI 3.1 document. Text rules (no HTML, http(s) links only) are
 * checked by the API but cannot be expressed in JSON Schema; the descriptions say so.
 */

type JsonSchema = Record<string, unknown>;

const TEXT_RULES =
  "Textos não aceitam HTML nem URLs javascript:/data:. Parágrafos, listas, citações, avisos e células de tabela aceitam só **negrito**, *itálico* e [links](https://…); nos detonados (formato 2), ||spoiler|| esconde um trecho até o leitor ligar os spoilers.";

/**
 * zod renders `z.url({ protocol })` as a bare `format: uri`; add the protocol as a pattern so
 * validators catch `http:` images before the API does.
 */
function pinUrlProtocols(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(pinUrlProtocols);
  if (!node || typeof node !== "object") return;
  const schema = node as JsonSchema & { properties?: Record<string, JsonSchema> };
  const props = schema.properties;
  if (props?.url?.format === "uri") {
    const kind = (props.type as JsonSchema | undefined)?.const;
    props.url.pattern = kind === "image" ? "^https://" : "^https?://";
  }
  Object.values(schema).forEach(pinUrlProtocols);
}

function toSchema(schema: z.ZodType, extra: JsonSchema): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  pinUrlProtocols(json);
  return { ...json, ...extra };
}

export function articleJsonSchema(): JsonSchema {
  return toSchema(articlePayloadSchema, {
    $id: "/api/v1/schemas/article.json",
    title: "Notícia (POST /api/v1/articles)",
    description: TEXT_RULES,
  });
}

export function guideJsonSchema(): JsonSchema {
  return toSchema(guidePayloadSchema, {
    $id: "/api/v1/schemas/guide.json",
    title: "Guia (POST /api/v1/guides)",
    description: TEXT_RULES,
  });
}

/** For embedding in OpenAPI: no `$schema`/`$id` keys. */
function component(schema: z.ZodType, description?: string): JsonSchema {
  const json = toSchema(schema, description ? { description } : {});
  delete json.$schema;
  return json;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: JsonSchema) => ({ "application/json": { schema } });

const errorResponse = (description: string) => ({ description, content: json(ref("Error")) });

const writeHeaders = {
  "X-RateLimit-Limit": { schema: { type: "integer" }, description: "Requisições permitidas por minuto." },
  "X-RateLimit-Remaining": { schema: { type: "integer" }, description: "Requisições restantes na janela." },
};

const idempotencyParam = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description:
    "Identificador único deste envio (ex.: um UUID). Repetir a mesma chave com o mesmo corpo devolve a mesma resposta sem duplicar; com outro corpo devolve 409.",
  schema: { type: "string", minLength: 1, maxLength: 255 },
};

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

const writeErrors = {
  "400": errorResponse("JSON inválido ou Idempotency-Key ausente."),
  "401": errorResponse("Chave ausente, inválida ou revogada."),
  "403": errorResponse("A chave não tem o escopo necessário."),
  "409": errorResponse("Slug em uso, guia já existente, conteúdo publicado travado ou Idempotency-Key reutilizado."),
  "413": errorResponse("Corpo maior que 1 MiB (imagem maior que 8 MiB em /api/v1/media)."),
  "422": errorResponse("Campos inválidos; `issues` aponta cada campo por JSON Pointer."),
  "429": errorResponse(`Mais de ${RATE_LIMIT} requisições por minuto nesta chave.`),
};

export function openApiDocument(): JsonSchema {
  return {
    openapi: "3.1.0",
    info: {
      title: "Tralked: API para robôs",
      version: "1.0.0",
      description:
        "Robôs criam notícias e guias no Tralked. Sem o escopo publish, o conteúdo entra na fila de revisão da redação. Documentação: /desenvolvedores.",
    },
    servers: [{ url: "/" }],
    security: [{ bearer: [] }],
    tags: [{ name: "Notícias" }, { name: "Guias" }, { name: "Catálogo" }],
    paths: {
      "/api/v1/articles": {
        get: {
          tags: ["Notícias"],
          summary: "Notícias publicadas recentemente (de qualquer autor)",
          description:
            "Qualquer chave ativa. Só notícias publicadas, da mais nova para a mais antiga. Serve para o robô não repetir o que o site já cobriu.",
          parameters: [
            {
              name: "since",
              in: "query",
              required: false,
              description: "Horário ISO 8601 com fuso; devolve notícias publicadas a partir dele. Padrão: 7 dias atrás.",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 200, default: 100 },
            },
          ],
          responses: {
            "200": { description: "Notícias publicadas.", content: json(ref("ArticleFeed")) },
            "400": writeErrors["400"],
            "401": writeErrors["401"],
            "429": writeErrors["429"],
          },
        },
        post: {
          tags: ["Notícias"],
          summary: "Criar notícia",
          description:
            "Escopo articles:write (publicar direto: publish). Com publish, publishedAt (ISO 8601 com fuso) data a notícia entre 120 dias atrás e 5 minutos à frente; só vale com status published.",
          parameters: [idempotencyParam],
          requestBody: { required: true, content: json(ref("ArticlePayload")) },
          responses: {
            "201": { description: "Notícia criada.", headers: writeHeaders, content: json(ref("WriteResult")) },
            ...writeErrors,
          },
        },
      },
      "/api/v1/articles/{id}": {
        get: {
          tags: ["Notícias"],
          summary: "Status de uma notícia criada por esta chave",
          parameters: [idParam],
          responses: {
            "200": { description: "Status.", content: json(ref("ArticleStatus")) },
            "401": writeErrors["401"],
            "404": errorResponse("Não existe ou foi criada por outra chave."),
            "429": writeErrors["429"],
          },
        },
        patch: {
          tags: ["Notícias"],
          summary: "Alterar notícia criada por esta chave",
          description: 'Com o escopo publish, status "archived" tira a notícia do site.',
          parameters: [idParam, idempotencyParam],
          requestBody: { required: true, content: json(ref("ArticlePatch")) },
          responses: {
            "200": { description: "Notícia alterada.", content: json(ref("WriteResult")) },
            "404": errorResponse("Não existe ou foi criada por outra chave."),
            ...writeErrors,
          },
        },
      },
      "/api/v1/guides": {
        post: {
          tags: ["Guias"],
          summary: "Criar o guia de um jogo",
          description:
            "Escopo guides:write (publicar direto: publish). Um guia por jogo. format 1 = guia clássico; format 2 = roteiro do robô (walkthrough), que exige key em toda etapa, cobertura de todas as conquistas Steam e facts.missables igual aos itens perdíveis do tipo achievement. Com walkthrough.scope = \"psn\" (guia pela lista da PSN), walkthrough.psnList traz o total e os nomes dos troféus da PSN e cada conquista Steam fica num item ou em walkthrough.steamOnly (apiNames Steam sem roteiro), nunca fora dos dois.",
          parameters: [idempotencyParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: ref("GuidePayload"),
                examples: {
                  formato1: { summary: "Guia clássico (format 1)", value: EXAMPLE_GUIDE },
                  formato2: { summary: "Roteiro do robô (format 2)", value: EXAMPLE_GUIDE_V2 },
                },
              },
            },
          },
          responses: {
            "201": { description: "Guia criado (versão 1).", headers: writeHeaders, content: json(ref("WriteResult")) },
            ...writeErrors,
          },
        },
      },
      "/api/v1/guides/{id}": {
        get: {
          tags: ["Guias"],
          summary: "Status de um guia criado por esta chave",
          parameters: [idParam],
          responses: {
            "200": { description: "Status.", content: json(ref("GuideStatus")) },
            "401": writeErrors["401"],
            "404": errorResponse("Não existe ou foi criado por outra chave."),
            "429": writeErrors["429"],
          },
        },
        patch: {
          tags: ["Guias"],
          summary: "Atualizar guia criado por esta chave (salva uma nova versão)",
          parameters: [idParam, idempotencyParam],
          requestBody: { required: true, content: json(ref("GuidePatch")) },
          responses: {
            "200": { description: "Guia atualizado.", content: json(ref("WriteResult")) },
            "202": {
              description: "O guia já está publicado e a chave não tem publish: a atualização espera um editor e o guia no ar não muda.",
              content: json(ref("PendingResult")),
            },
            "404": errorResponse("Não existe ou foi criado por outra chave."),
            ...writeErrors,
          },
        },
      },
      "/api/v1/guide-requests/next": {
        post: {
          tags: ["Guias"],
          summary: "Pegar o próximo pedido de guia da fila",
          description:
            "Escopo guides:write. O robô de guias pega o pedido de maior prioridade e, entre eles, o mais antigo (um pedido em waiting_sources volta quando chega a hora da nova tentativa). O pedido passa a researching e nenhum outro robô o recebe. gameSlug é o jogo do /dossie?all=1.",
          responses: {
            "200": { description: "Pedido pego.", headers: writeHeaders, content: json(ref("GuideRequestClaim")) },
            "204": { description: "Nenhum pedido esperando." },
            "401": writeErrors["401"],
            "403": writeErrors["403"],
            "429": writeErrors["429"],
          },
        },
      },
      "/api/v1/guide-requests/{id}": {
        patch: {
          tags: ["Guias"],
          summary: "Relatar o andamento de um pedido de guia",
          description:
            "Escopo guides:write. waiting_sources agenda nova tentativa em 3 dias; depois de 30 dias esperando, o pedido vira failed (\"fontes insuficientes após 30 dias\"). Um pedido cancelado ou já publicado não aceita relato (422): o robô deve parar.",
          parameters: [idParam, idempotencyParam],
          requestBody: { required: true, content: json(ref("GuideRequestReport")) },
          responses: {
            "200": { description: "Relato salvo.", content: json(ref("GuideRequestState")) },
            "404": errorResponse("O pedido não existe."),
            ...writeErrors,
          },
        },
      },
      "/api/v1/media": {
        post: {
          tags: ["Guias"],
          summary: "Enviar uma imagem para um guia",
          description:
            "Escopo media:write. O corpo é o arquivo cru (PNG, JPEG ou WebP, até 8 MiB), não JSON. A imagem é decodificada, convertida para WebP com no máximo 2048 px no lado maior e sem metadados. Use a URL da resposta em image.url de um item do roteiro.",
          parameters: [idempotencyParam],
          requestBody: {
            required: true,
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
          responses: {
            "201": { description: "Imagem salva.", headers: writeHeaders, content: json(ref("MediaResult")) },
            "415": errorResponse("Content-Type não aceito, ou o arquivo não é uma imagem válida."),
            ...writeErrors,
          },
        },
      },
      "/api/v1/games": {
        get: {
          tags: ["Catálogo"],
          summary: "Procurar jogo",
          description:
            "Informe um parâmetro: q (parte do nome ou apelido), slug, steamAppId ou igdbId. A busca esconde os stubs do catálogo (jogos só com o nome) e q ordena por popularidade, do mais popular para o menos, e depois por nome.",
          parameters: ["q", "slug", "steamAppId", "igdbId"].map((name) => ({
            name,
            in: "query",
            required: false,
            schema: { type: name === "steamAppId" || name === "igdbId" ? "integer" : "string" },
          })),
          responses: {
            "200": { description: "Até 20 jogos.", content: json(ref("GameSearch")) },
            "400": writeErrors["400"],
            "401": writeErrors["401"],
            "429": writeErrors["429"],
          },
        },
      },
      "/api/v1/games/{slug}/insights": {
        get: {
          tags: ["Catálogo"],
          summary: "Dados agregados de um jogo no Tralked",
          description:
            "Qualquer chave ativa. Só agregados, sem usuários: a média de tempo de jogo só aparece com 3 ou mais jogadores que jogaram. Responde 404 para um stub do catálogo.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Dados do jogo.", content: json(ref("GameInsights")) },
            "401": writeErrors["401"],
            "404": errorResponse("Jogo não encontrado."),
            "429": writeErrors["429"],
          },
        },
      },
      "/api/v1/games/{slug}/media": {
        get: {
          tags: ["Catálogo"],
          summary: "Imagens e vídeos de um jogo",
          description:
            "Qualquer chave ativa. A mídia oficial que o catálogo guarda (IGDB, SteamGridDB, Steam), para ilustrar matérias: até 12 imagens largas https (banner, capturas de tela, artes; nunca a capa em retrato) e até 6 IDs de vídeos do YouTube. Responde 404 para um stub do catálogo.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Mídia do jogo.", content: json(ref("GameMedia")) },
            "401": writeErrors["401"],
            "404": errorResponse("Jogo não encontrado."),
            "429": writeErrors["429"],
          },
        },
      },
      "/api/v1/games/{slug}/dossie": {
        get: {
          tags: ["Catálogo"],
          summary: "Dossiê de um jogo: ficha, números do Tralked e conquistas",
          description:
            "Qualquer chave ativa. Para pautas atemporais: a ficha do jogo, agregados dos jogadores do Tralked e todas as conquistas visíveis (até 500), da mais rara para a menos. Com all=1 (escopo guides:write), também as ocultas, com hidden, namePt e descriptionPt (até 5000). Só agregados, sem usuários: a média de tempo de jogo só aparece com 3 ou mais jogadores que jogaram. Responde 404 para um stub do catálogo.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            {
              name: "all",
              in: "query",
              required: false,
              description: "1 lista todas as conquistas, ocultas incluídas. Exige guides:write.",
              schema: { type: "string", enum: ["1"] },
            },
          ],
          responses: {
            "200": { description: "Dossiê do jogo.", content: json(ref("GameDossier")) },
            "401": writeErrors["401"],
            "403": errorResponse("all=1 sem o escopo guides:write."),
            "404": errorResponse("Jogo não encontrado."),
            "429": writeErrors["429"],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: `Chave tk_live_… criada no admin. Escopos: ${API_SCOPES.join(", ")}.`,
        },
      },
      schemas: {
        ArticlePayload: component(articlePayloadSchema, TEXT_RULES),
        ArticlePatch: component(articlePatchSchema, "Qualquer subconjunto dos campos; o slug não muda."),
        GuidePayload: component(guidePayloadSchema, TEXT_RULES),
        GuidePatch: component(guidePatchSchema, "Qualquer subconjunto dos campos; cada campo enviado substitui o atual."),
        WriteResult: {
          type: "object",
          required: ["id", "status", "url"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["draft", "review", "published", "archived"] },
            url: { type: "string", format: "uri" },
            revision: { type: "integer", description: "Só guias: número da versão salva." },
          },
        },
        PendingResult: {
          type: "object",
          required: ["id", "status", "pendingId"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["pending_review"] },
            pendingId: { type: "string" },
          },
        },
        GuideRequestClaim: {
          type: "object",
          required: ["request"],
          properties: {
            request: {
              type: "object",
              required: ["id", "steamAppId", "gameSlug", "attempts"],
              properties: {
                id: { type: "string" },
                steamAppId: { type: "integer" },
                gameSlug: { type: ["string", "null"], description: "Slug do jogo para /dossie?all=1." },
                attempts: { type: "integer", description: "Conta esta tentativa." },
              },
            },
          },
        },
        GuideRequestReport: {
          type: "object",
          required: ["status"],
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["researching", "writing", "review", "waiting_sources", "failed"] },
            reason: { type: "string", maxLength: 2000 },
            report: {
              type: ["object", "array"],
              description: "O relatório do robô (fontes lidas, o que falta, cobertura, gasto), mostrado só à redação.",
            },
            guideId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
        GuideRequestState: {
          type: "object",
          required: ["id", "status", "attempts", "nextAttemptAt"],
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            attempts: { type: "integer" },
            nextAttemptAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        MediaResult: {
          type: "object",
          required: ["url", "width", "height"],
          properties: {
            url: { type: "string", format: "uri", description: "URL https da imagem WebP." },
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
        ArticleStatus: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            title: { type: "string" },
            status: { type: "string" },
            url: { type: "string" },
            reviewed: { type: "boolean" },
            publishedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        GuideStatus: {
          type: "object",
          properties: {
            id: { type: "string" },
            game: { type: "object", properties: { slug: { type: "string" }, name: { type: "string" } } },
            status: { type: "string" },
            version: { type: "string" },
            revision: { type: "integer" },
            steps: { type: "integer" },
            url: { type: "string" },
            publishedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ArticleFeed: {
          type: "object",
          properties: {
            articles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  slug: { type: "string" },
                  title: { type: "string" },
                  category: { type: "string" },
                  publishedAt: { type: "string", format: "date-time" },
                  source: { type: "string", enum: ["editorial", "bot"] },
                  games: { type: "array", items: { type: "string" }, description: "Slugs dos jogos da notícia, sem os stubs do catálogo." },
                },
              },
            },
          },
        },
        GameInsights: {
          type: "object",
          properties: {
            game: {
              type: "object",
              properties: {
                slug: { type: "string" },
                name: { type: "string" },
                releaseDate: { type: ["string", "null"], format: "date-time" },
                platforms: { type: "array", items: { type: "string" } },
                achievementCount: { type: "integer" },
                timeToBeatCompleteMin: { type: ["integer", "null"] },
              },
            },
            tralked: {
              type: "object",
              properties: {
                players: { type: "integer", description: "Usuários com o jogo na biblioteca." },
                avgPlaytimeMin: { type: ["integer", "null"], description: "Nulo com menos de 3 jogadores que jogaram." },
              },
            },
            rarest: {
              type: "array",
              description: "Até 5 conquistas visíveis com a menor raridade global, da mais rara para a menos.",
              items: {
                type: "object",
                properties: {
                  platform: { type: "string" },
                  apiName: { type: "string" },
                  name: { type: "string" },
                  globalPct: { type: "number" },
                },
              },
            },
          },
        },
        GameMedia: {
          type: "object",
          properties: {
            game: {
              type: "object",
              properties: {
                slug: { type: "string" },
                name: { type: "string" },
                developer: { type: ["string", "null"] },
                publisher: { type: ["string", "null"] },
              },
            },
            images: {
              type: "array",
              description: "Banner primeiro, depois capturas de tela e artes, na ordem do catálogo. Só https.",
              items: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  kind: { type: "string", enum: ["hero", "screenshot", "artwork"] },
                  width: { type: ["integer", "null"] },
                  height: { type: ["integer", "null"] },
                  source: { type: ["string", "null"], description: "igdb, sgdb, steam…; nulo para o banner." },
                },
              },
            },
            videos: {
              type: "array",
              description: "Vídeos do YouTube, o trailer principal primeiro.",
              items: { type: "object", properties: { youtubeId: { type: "string" } } },
            },
          },
        },
        GameDossier: {
          type: "object",
          properties: {
            game: {
              type: "object",
              properties: {
                slug: { type: "string" },
                name: { type: "string" },
                steamAppId: { type: ["integer", "null"] },
                summary: { type: ["string", "null"] },
                developer: { type: ["string", "null"] },
                publisher: { type: ["string", "null"] },
                releaseDate: { type: ["string", "null"], format: "date-time" },
                platforms: { type: "array", items: { type: "string" } },
                criticScore: { type: ["integer", "null"] },
                timeToBeatCompleteMin: { type: ["integer", "null"] },
                achievementCount: { type: "integer" },
              },
            },
            tralked: {
              type: "object",
              properties: {
                players: { type: "integer", description: "Usuários com o jogo na biblioteca." },
                avgPlaytimeMin: { type: ["integer", "null"], description: "Nulo com menos de 3 jogadores que jogaram." },
                completedPlayers: { type: "integer", description: "Usuários que zeraram o jogo." },
              },
            },
            achievements: {
              type: "array",
              description:
                "Conquistas visíveis, da menor para a maior raridade global (sem raridade no fim); até 500. Com all=1, as ocultas também (até 5000).",
              items: {
                type: "object",
                properties: {
                  platform: { type: "string" },
                  apiName: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  globalPct: { type: ["number", "null"] },
                  hidden: { type: "boolean", description: "Só com all=1." },
                  namePt: { type: ["string", "null"], description: "Só com all=1: o nome em PT-BR da Steam." },
                  descriptionPt: { type: ["string", "null"], description: "Só com all=1." },
                },
              },
            },
          },
        },
        GameSearch: {
          type: "object",
          properties: {
            games: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  slug: { type: "string" },
                  name: { type: "string" },
                  steamAppId: { type: ["integer", "null"] },
                  igdbId: { type: ["integer", "null"] },
                  aliases: { type: "array", items: { type: "string" } },
                  guide: {
                    type: ["object", "null"],
                    properties: { id: { type: "string" }, status: { type: "string" }, source: { type: ["string", "null"] } },
                  },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "issues"],
              properties: {
                code: { type: "string", enum: Object.keys(ERROR_STATUS) },
                message: { type: "string" },
                issues: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["path", "message"],
                    properties: {
                      path: { type: "string", description: "JSON Pointer do campo (ex.: /blocks/3/url)." },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
