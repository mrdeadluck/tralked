import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EXAMPLE_ARTICLE, EXAMPLE_GUIDE } from "@/lib/api/examples";
import { ERROR_STATUS, type ApiErrorCode } from "@/lib/api/errors";
import { RATE_LIMIT } from "@/lib/api/rate-limit";
import { CopyButton } from "./CopyButton";

export const metadata: Metadata = {
  title: "API para robôs | Tralked",
  description:
    "Como robôs criam notícias e guias no Tralked: chaves, escopos, endpoints, payloads completos, erros, idempotência e limites.",
};

const SECTIONS = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "autenticacao", label: "Autenticação e escopos" },
  { id: "endpoints", label: "Endpoints" },
  { id: "noticias", label: "Criar uma notícia" },
  { id: "blocos", label: "Blocos de conteúdo" },
  { id: "guias", label: "Criar um guia" },
  { id: "jogos", label: "Encontrar o jogo" },
  { id: "erros", label: "Respostas e erros" },
  { id: "idempotencia", label: "Idempotência" },
  { id: "limites", label: "Limites" },
  { id: "esquemas", label: "Esquemas para validar" },
] as const;

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const CURL_ARTICLE = `curl -X POST "$TRALKED_URL/api/v1/articles" \\
  -H "Authorization: Bearer $TRALKED_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data @noticia.json`;

const CURL_GUIDE = `curl -X POST "$TRALKED_URL/api/v1/guides" \\
  -H "Authorization: Bearer $TRALKED_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data @guia.json`;

const CURL_PATCH = `curl -X PATCH "$TRALKED_URL/api/v1/guides/ID_DO_GUIA" \\
  -H "Authorization: Bearer $TRALKED_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data '{"version": "v1.1", "warnings": ["Aviso revisado."]}'`;

const CURL_STATUS = `curl "$TRALKED_URL/api/v1/articles/ID_DA_NOTICIA" \\
  -H "Authorization: Bearer $TRALKED_KEY"`;

const CURL_GAMES = `curl "$TRALKED_URL/api/v1/games?q=hades" \\
  -H "Authorization: Bearer $TRALKED_KEY"`;

const CREATED = pretty({
  id: "cmh1x9q0k0001qz8f3v2b7d4e",
  status: "review",
  url: "https://seu-dominio/noticias/hades-recebe-atualizacao-com-novo-modo-de-desafio",
});

const GAMES_ANSWER = pretty({
  games: [
    {
      id: "cmh0a1b2c0003qz8f9k1m2n3o",
      slug: "hades",
      name: "Hades",
      steamAppId: 1145360,
      igdbId: null,
      aliases: [],
      guide: null,
    },
  ],
});

const ERROR_EXAMPLE = pretty({
  error: {
    code: "validation_failed",
    message: "O corpo tem campos inválidos; veja issues.",
    issues: [
      { path: "/blocks/3/url", message: "A imagem precisa de uma URL https://" },
      { path: "/blocks/0/text", message: "HTML não é permitido; use texto puro" },
      { path: "/games/0", message: 'Jogo não encontrado (slug "hadez"). Procure o jogo em GET /api/v1/games?q=…' },
      { path: "/html", message: "Campo desconhecido" },
    ],
  },
});

const ERROR_MEANING: Record<ApiErrorCode, string> = {
  bad_request: "Parâmetro de busca inválido em GET /api/v1/games.",
  invalid_json: "O corpo não é JSON.",
  idempotency_key_required: "Falta o cabeçalho Idempotency-Key em POST ou PATCH.",
  unauthorized: "Chave ausente, inválida ou revogada.",
  forbidden: "A chave não tem o escopo do endpoint, ou pediu status published sem o escopo publish.",
  not_found: "O id não existe ou o conteúdo foi criado por outra chave.",
  slug_conflict: "Já existe uma notícia com esse slug (enviado ou gerado do título).",
  guide_exists: "O jogo já tem guia. A mensagem traz o id; se o guia for desta chave, use PATCH.",
  published_locked: "A redação já publicou o conteúdo; só uma chave com publish pode alterá-lo.",
  idempotency_conflict: "O Idempotency-Key já foi usado com outro corpo ou em outro endpoint.",
  payload_too_large: "O corpo passa de 1 MiB.",
  validation_failed: "Campos inválidos. Cada item de issues aponta o campo por JSON Pointer.",
  rate_limited: `Mais de ${RATE_LIMIT} requisições no minuto. Espere os segundos de Retry-After.`,
};

const SCOPES: { scope: string; allows: string }[] = [
  { scope: "articles:write", allows: "Criar notícias, alterar as próprias e consultar o status delas." },
  { scope: "guides:write", allows: "Criar o guia de um jogo, atualizar os próprios e consultar o status." },
  { scope: "publish", allows: "Publicar direto, sem passar pela fila de revisão, e alterar o que já está publicado." },
  { scope: "media:write", allows: "Reservado para envio de imagens; nenhum endpoint usa ainda." },
];

const ENDPOINTS: { method: string; path: string; scope: string; does: string }[] = [
  { method: "POST", path: "/api/v1/articles", scope: "articles:write", does: "Cria uma notícia. Responde 201." },
  { method: "GET", path: "/api/v1/articles/{id}", scope: "articles:write", does: "Status de uma notícia desta chave." },
  { method: "PATCH", path: "/api/v1/articles/{id}", scope: "articles:write", does: "Altera campos de uma notícia desta chave." },
  { method: "POST", path: "/api/v1/guides", scope: "guides:write", does: "Cria o guia de um jogo (um por jogo). Responde 201." },
  { method: "GET", path: "/api/v1/guides/{id}", scope: "guides:write", does: "Status e versão de um guia desta chave." },
  { method: "PATCH", path: "/api/v1/guides/{id}", scope: "guides:write", does: "Atualiza um guia desta chave e salva uma nova versão." },
  { method: "GET", path: "/api/v1/games", scope: "qualquer chave", does: "Procura jogos por nome, slug, steamAppId ou igdbId." },
  { method: "GET", path: "/api/v1/openapi.json", scope: "pública", does: "Descrição OpenAPI 3.1 de toda a API." },
  { method: "GET", path: "/api/v1/schemas/article.json", scope: "pública", does: "JSON Schema do corpo de uma notícia." },
  { method: "GET", path: "/api/v1/schemas/guide.json", scope: "pública", does: "JSON Schema do corpo de um guia." },
];

const BLOCKS: { type: string; fields: string; rules: string }[] = [
  { type: "heading", fields: "level (2 ou 3), text", rules: "Texto puro, até 200 caracteres." },
  { type: "paragraph", fields: "text", rules: "Marcação inline, até 5000 caracteres." },
  { type: "list", fields: "ordered, items[]", rules: "1 a 100 itens com marcação inline." },
  { type: "quote", fields: "text, author?", rules: "Citação com marcação inline; autor em texto puro." },
  { type: "image", fields: "url, alt, credit", rules: "Só https://. Texto alternativo e crédito obrigatórios." },
  { type: "video", fields: "youtubeId", rules: "Os 11 caracteres do ID do YouTube, não a URL." },
  { type: "callout", fields: "tone, text", rules: "tone: info, aviso ou spoiler (spoiler aparece fechado)." },
  { type: "table", fields: "header[], rows[][]", rules: "Até 8 colunas; toda linha com o número de colunas do cabeçalho." },
  { type: "achievement", fields: "apiName, platform?", rules: "Cartão da conquista com raridade e XP. platform: steam (padrão), psn, xbox, retro." },
  { type: "divider", fields: "", rules: "Separador horizontal." },
];

const h2 = "scroll-mt-[220px] nav:scroll-mt-28 text-[26px] leading-[1.1] font-extrabold font-stretch-[110%] tracking-[-0.02em]";
const h3 = "mt-4 text-xl leading-[1.15] font-bold";
const prose = "text-[17px] leading-[1.7] text-text-2";
const inlineCode = "rounded-[3px] bg-surface px-1.5 py-0.5 font-mono text-[0.86em] text-text";

function C({ children }: { children: ReactNode }) {
  return <code className={inlineCode}>{children}</code>;
}

function Code({ code, label, tall = false }: { code: string; label: string; tall?: boolean }) {
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-[4px] border border-line bg-bg-deep">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line px-4 py-2">
        <span className="text-[13px] text-muted">{label}</span>
        <CopyButton text={code} label={label} />
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={label}
        className={`overflow-auto px-4 py-3.5 font-mono text-[13px] leading-[1.6] text-text-2 selection:bg-acc selection:text-bg ${tall ? "max-h-[520px]" : ""}`}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function Table({ head, rows, label }: { head: string[]; rows: ReactNode[][]; label: string }) {
  return (
    <div role="region" aria-label={`Tabela: ${label}`} tabIndex={0} className="overflow-x-auto rounded-[4px] border border-line">
      <table className="w-full border-collapse text-left text-[15px]">
        <thead className="bg-surface">
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-line-2 px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-text-3 uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-divider align-top last:border-b-0">
              {row.map((cell, c) => (
                <td key={c} className="px-4 py-2.5 text-text-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }: { id: (typeof SECTIONS)[number]["id"]; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <h2 id={id} className={h2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesenvolvedoresPage() {
  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-10 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
      <nav aria-label="Nesta página" className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 font-mono text-[11px] tracking-[0.1em] text-dim uppercase">Nesta página</p>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1.5 p-0 text-[14.5px] sm:grid-cols-3 lg:grid-cols-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-text-3 hover:text-acc">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="flex min-w-0 max-w-[760px] flex-col gap-14">
        <header className="flex flex-col gap-4">
          <h1 className="text-[clamp(30px,4vw,48px)] leading-[1.02] font-black font-stretch-[112%] tracking-[-0.035em]">
            API para robôs
          </h1>
          <p className="text-lg text-text-3">
            Robôs criam notícias e guias de conquistas no Tralked por HTTP, em JSON. O conteúdo é escrito em
            blocos, sem HTML, e passa pela redação antes de ir ao ar, a não ser que a chave possa publicar.
          </p>
        </header>

        <Section id="visao-geral" title="Visão geral">
          <ul className={`list-disc pl-6 ${prose} [&>li+li]:mt-1.5`}>
            <li>
              Endereço base: o domínio do Tralked. Nos exemplos ele está em <C>$TRALKED_URL</C> e a chave em{" "}
              <C>$TRALKED_KEY</C>.
            </li>
            <li>
              Corpo e respostas em JSON (UTF-8). Envie <C>Content-Type: application/json</C>.
            </li>
            <li>
              Toda escrita (POST e PATCH) leva um <C>Idempotency-Key</C> novo, por exemplo um UUID.
            </li>
            <li>
              Sem o escopo <C>publish</C>, notícias e guias entram com status <C>review</C> e aparecem na fila de
              revisão do admin. Um editor publica.
            </li>
            <li>
              Notícias de robô são assinadas como <C>Robô &lt;nome da chave&gt;</C>, nunca recebem o selo
              &ldquo;Autoria humana&rdquo; e, depois que um editor aprova, mostram &ldquo;Gerado por robô · revisado
              pela redação&rdquo;.
            </li>
          </ul>
        </Section>

        <Section id="autenticacao" title="Autenticação e escopos">
          <p className={prose}>
            Um administrador cria a chave no admin e escolhe os escopos. A chave tem a forma{" "}
            <C>tk_live_</C> seguido de 43 caracteres e aparece uma única vez: o Tralked guarda só o hash SHA-256.
            Guarde-a num cofre de segredos e mande em todas as requisições:
          </p>
          <Code label="Cabeçalho de autenticação" code={"Authorization: Bearer tk_live_…"} />
          <p className={prose}>
            Uma chave revogada no admin para de funcionar na hora e passa a receber <C>401</C>. Cada chave só vê e
            altera o que ela mesma criou.
          </p>
          <Table
            label="Escopos"
            head={["Escopo", "Permite"]}
            rows={SCOPES.map((s) => [<C key={s.scope}>{s.scope}</C>, s.allows])}
          />
        </Section>

        <Section id="endpoints" title="Endpoints">
          <Table
            label="Endpoints"
            head={["Método", "Caminho", "Escopo", "Faz"]}
            rows={ENDPOINTS.map((e) => [
              <span key="m" className="font-mono text-[13px] font-bold text-text">
                {e.method}
              </span>,
              <C key="p">{e.path}</C>,
              <span key="s" className="whitespace-nowrap">
                {e.scope}
              </span>,
              e.does,
            ])}
          />
        </Section>

        <Section id="noticias" title="Criar uma notícia">
          <p className={prose}>
            Campos obrigatórios: <C>title</C>, <C>category</C> (<C>GAMES</C>, <C>GUIAS</C> ou <C>COMUNIDADE</C>) e{" "}
            <C>blocks</C> com ao menos um bloco. Os opcionais são <C>subtitle</C>, <C>excerpt</C> (resumo dos
            cartões), <C>slug</C> (gerado do título se faltar), <C>platforms</C> (<C>PC</C>, <C>PLAYSTATION</C>,{" "}
            <C>XBOX</C>, <C>NINTENDO</C>), <C>games</C>, <C>imageLabel</C> e <C>status</C>.
          </p>
          <p className={prose}>
            Cada jogo em <C>games</C> é indicado por exatamente um entre <C>slug</C>, <C>steamAppId</C> e{" "}
            <C>igdbId</C>, e precisa existir no catálogo. <C>status</C> aceita <C>review</C> ou <C>published</C>;
            sem ele, a notícia vai para revisão, ou é publicada direto se a chave tiver <C>publish</C>.
          </p>
          <p className={prose}>Este exemplo usa todos os tipos de bloco:</p>
          <Code label="noticia.json" code={pretty(EXAMPLE_ARTICLE)} tall />
          <Code label="Enviar a notícia" code={CURL_ARTICLE} />
          <p className={prose}>
            Resposta <C>201</C>. A URL só abre no site depois da publicação:
          </p>
          <Code label="Resposta 201" code={CREATED} />
          <h3 className={h3}>Acompanhar e corrigir</h3>
          <p className={prose}>
            <C>GET /api/v1/articles/&#123;id&#125;</C> devolve <C>status</C>, <C>reviewed</C> (aprovada por um
            editor) e as datas. <C>PATCH</C> no mesmo caminho troca só os campos enviados; <C>blocks</C> e{" "}
            <C>games</C> são substituídos inteiros e o <C>slug</C> não muda. Depois que a redação publica, só uma
            chave com <C>publish</C> pode alterar a notícia (senão, <C>409 published_locked</C>).
          </p>
          <Code label="Consultar o status" code={CURL_STATUS} />
        </Section>

        <Section id="blocos" title="Blocos de conteúdo">
          <p className={prose}>
            Notícias e guias usam o mesmo formato: uma lista de blocos, renderizada pelo site com a identidade do
            Tralked. Campos desconhecidos são recusados. Nenhum texto aceita HTML nem URLs <C>javascript:</C>,{" "}
            <C>data:</C> ou <C>vbscript:</C>.
          </p>
          <p className={prose}>
            Parágrafos, itens de lista, citações, avisos e células de tabela aceitam marcação inline restrita:{" "}
            <C>**negrito**</C>, <C>*itálico*</C> e <C>[texto](https://…)</C>, com link http ou https. Títulos,
            legendas e créditos são texto puro. Quebras de linha <C>\r\n</C> e <C>\r</C> são convertidas em{" "}
            <C>\n</C> antes da validação; outros caracteres de controle, exceto tabulação, são recusados.
          </p>
          <Table
            label="Tipos de bloco"
            head={["type", "Campos", "Regras"]}
            rows={BLOCKS.map((b) => [<C key={b.type}>{b.type}</C>, b.fields || "nenhum", b.rules])}
          />
        </Section>

        <Section id="guias" title="Criar um guia">
          <p className={prose}>
            Cada jogo tem um guia. O corpo traz o jogo (<C>game</C>), a ficha (<C>facts</C>: dificuldade de 1 a 10,
            horas, número de jogadas, conquistas perdíveis e online), <C>overview</C> e <C>warnings</C> em texto
            puro, uma introdução opcional em blocos (<C>body</C>), as etapas (<C>steps</C>), as notas por conquista
            (<C>achievementNotes</C>), os coletáveis e as fontes.
          </p>
          <p className={prose}>
            Em <C>steps[].achievements</C> vão os apiNames Steam liberados na etapa. Cada nota indica a conquista
            por <C>apiName</C> e <C>platform</C> (padrão <C>steam</C>), com categoria <C>historia</C>,{" "}
            <C>chefes</C>, <C>coletaveis</C>, <C>desafio</C> ou <C>dlc</C>. Toda conquista citada precisa existir
            no jogo; senão a resposta é <C>422</C> com o caminho exato.
          </p>
          <Code label="guia.json" code={pretty(EXAMPLE_GUIDE)} tall />
          <Code label="Enviar o guia" code={CURL_GUIDE} />
          <p className={prose}>
            Resposta <C>201</C> com <C>id</C>, <C>status</C>, <C>url</C> e <C>revision: 1</C>. Se o jogo já tiver
            guia, a resposta é <C>409 guide_exists</C> com o id dele.
          </p>
          <h3 className={h3}>Atualizar</h3>
          <p className={prose}>
            <C>PATCH /api/v1/guides/&#123;id&#125;</C> aceita qualquer campo do guia menos <C>game</C>. Cada campo
            enviado substitui o atual por inteiro. Toda criação e toda atualização salvam uma versão completa do
            guia, que a redação pode comparar e restaurar; a resposta traz o número em <C>revision</C>.
          </p>
          <p className={prose}>
            Etapas e progresso dos leitores: dê a cada etapa uma <C>key</C> estável (letras minúsculas, números e
            hífens, como <C>chefe-final</C>), em todas ou em nenhuma. Com <C>key</C>, as etapas são casadas pela{" "}
            <C>key</C>: dá para reordenar, incluir e remover etapas, e a marca de cada leitor continua na etapa
            certa; uma etapa removida perde só as marcas dela. Um guia cujas etapas ainda não têm <C>key</C> as
            adota por posição no primeiro envio com o mesmo número de etapas. Sem <C>key</C>, as etapas são casadas
            por posição, e só quando o número de etapas não muda; se mudar, a resposta é <C>422</C> em{" "}
            <C>/steps</C>.
          </p>
          <Code label="Atualizar o guia" code={CURL_PATCH} />
        </Section>

        <Section id="jogos" title="Encontrar o jogo">
          <p className={prose}>
            Antes de escrever, confirme que o jogo existe no catálogo. Informe um parâmetro: <C>q</C> (parte do
            nome ou um apelido), <C>slug</C>, <C>steamAppId</C> ou <C>igdbId</C>. A resposta traz até 20 jogos e o
            guia de cada um, se houver.
          </p>
          <Code label="Procurar um jogo" code={CURL_GAMES} />
          <Code label="Resposta 200" code={GAMES_ANSWER} />
        </Section>

        <Section id="erros" title="Respostas e erros">
          <p className={prose}>
            Sucesso: <C>201</C> ao criar e <C>200</C> ao alterar ou consultar. Todo erro tem o mesmo formato. Em{" "}
            <C>issues</C>, <C>path</C> é um JSON Pointer para o campo do corpo (<C>&quot;&quot;</C> é o corpo
            inteiro); em <C>GET /api/v1/games</C> ele aponta o parâmetro, como <C>?steamAppId</C>.
          </p>
          <Code label="Resposta 422" code={ERROR_EXAMPLE} />
          <Table
            label="Códigos de erro"
            head={["HTTP", "code", "Quando"]}
            rows={(Object.keys(ERROR_STATUS) as ApiErrorCode[]).map((code) => [
              <span key="s" className="font-mono text-[13px] tabular-nums">
                {ERROR_STATUS[code]}
              </span>,
              <C key="c">{code}</C>,
              ERROR_MEANING[code],
            ])}
          />
        </Section>

        <Section id="idempotencia" title="Idempotência">
          <p className={prose}>
            Gere um <C>Idempotency-Key</C> por conteúdo (1 a 255 caracteres ASCII visíveis) e reutilize-o só
            para repetir o mesmo envio, por exemplo depois de um timeout.
          </p>
          <ul className={`list-disc pl-6 ${prose} [&>li+li]:mt-1.5`}>
            <li>
              Mesma chave e mesmo corpo: a API devolve a resposta original, com o cabeçalho{" "}
              <C>Idempotent-Replayed: true</C>, e não cria nada de novo. A ordem dos campos no JSON não importa.
            </li>
            <li>
              Mesma chave com outro corpo ou em outro endpoint: <C>409 idempotency_conflict</C>.
            </li>
            <li>
              Uma requisição recusada (<C>403</C>, <C>409</C> ou <C>422</C>) não gasta a chave: corrija o corpo e
              reenvie com a mesma chave.
            </li>
            <li>Cada chave de API tem seus próprios Idempotency-Keys.</li>
          </ul>
        </Section>

        <Section id="limites" title="Limites">
          <ul className={`list-disc pl-6 ${prose} [&>li+li]:mt-1.5`}>
            <li>
              {RATE_LIMIT} requisições por minuto por chave. Toda resposta autenticada traz{" "}
              <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> e <C>X-RateLimit-Reset</C> (segundos até a
              janela zerar). Acima do limite: <C>429</C> com <C>Retry-After</C>.
            </li>
            <li>Corpo de até 1 MiB, com no máximo 64 níveis de listas e objetos aninhados.</li>
            <li>Até 300 blocos por notícia, 60 etapas por guia e 10 jogos por notícia.</li>
            <li>Imagens só por URL https, com texto alternativo e crédito. Não há envio de arquivos.</li>
          </ul>
        </Section>

        <Section id="esquemas" title="Esquemas para validar">
          <p className={prose}>
            Valide o payload antes de enviar com os JSON Schemas (draft 2020-12), gerados das mesmas regras que a
            API usa. As regras de texto (sem HTML, links só http/https) não cabem em JSON Schema e só a API as
            confere.
          </p>
          <ul className={`list-disc pl-6 ${prose} [&>li+li]:mt-1.5`}>
            <li>
              <a href="/api/v1/schemas/article.json" className="text-acc underline underline-offset-[3px]">
                /api/v1/schemas/article.json
              </a>
            </li>
            <li>
              <a href="/api/v1/schemas/guide.json" className="text-acc underline underline-offset-[3px]">
                /api/v1/schemas/guide.json
              </a>
            </li>
            <li>
              <a href="/api/v1/openapi.json" className="text-acc underline underline-offset-[3px]">
                /api/v1/openapi.json
              </a>{" "}
              (OpenAPI 3.1, para gerar clientes)
            </li>
          </ul>
        </Section>
      </article>
    </div>
  );
}
