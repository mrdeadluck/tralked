import { z } from "zod";
import { guidePatchSchema, guidePayloadSchema } from "@/lib/content/guide-schema";
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
  "Textos não aceitam HTML nem URLs javascript:/data:. Parágrafos, listas, citações, avisos e células de tabela aceitam só **negrito**, *itálico* e [links](https://…).";

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
  "413": errorResponse("Corpo maior que 1 MiB."),
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
          description: "Escopo guides:write (publicar direto: publish). Um guia por jogo.",
          parameters: [idempotencyParam],
          requestBody: { required: true, content: json(ref("GuidePayload")) },
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
            "404": errorResponse("Não existe ou foi criado por outra chave."),
            ...writeErrors,
          },
        },
      },
      "/api/v1/games": {
        get: {
          tags: ["Catálogo"],
          summary: "Procurar jogo",
          description: "Informe um parâmetro: q (parte do nome ou apelido), slug, steamAppId ou igdbId.",
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
            "Qualquer chave ativa. Só agregados, sem usuários: a média de tempo de jogo só aparece com 3 ou mais jogadores que jogaram.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Dados do jogo.", content: json(ref("GameInsights")) },
            "401": writeErrors["401"],
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
                  games: { type: "array", items: { type: "string" }, description: "Slugs dos jogos da notícia." },
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
