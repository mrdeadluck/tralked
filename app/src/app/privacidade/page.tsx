import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/community/PageHead";
import { CookiePreferences } from "@/components/layout/CookieConsent";
import { ContactEmail } from "@/components/legal/ContactEmail";
import { LegalSection, LegalUpdated } from "@/components/legal/LegalSection";
import { LEGAL_UPDATED_AT } from "@/lib/legal/contact";
import { NOTIFICATION_RETENTION_DAYS } from "@/lib/notifications/retention";

export const metadata: Metadata = {
  title: "Privacidade | Tralked",
  description: "Quais dados o Tralked guarda, por quanto tempo, quais cookies usa e como exportar ou excluir os seus dados.",
};

const COOKIES = [
  { name: "gl_session", kind: "Necessário", what: "Mantém você conectado (assinado, não guarda dados pessoais).", lasts: "30 dias" },
  { name: "gl_google_oauth", kind: "Necessário", what: "Protege o login com o Google contra falsificação.", lasts: "10 minutos" },
  { name: "tk_consent", kind: "Necessário", what: "Lembra a sua escolha sobre cookies opcionais.", lasts: "1 ano" },
];

export default function PrivacidadePage() {
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-10">
      <div className="flex flex-col gap-3">
        <PageHead
          title="Privacidade"
          lede="O que o Tralked guarda sobre você, para quê, por quanto tempo e como você controla tudo isso, nos termos da LGPD (Lei 13.709/2018)."
        />
        <LegalUpdated date={LEGAL_UPDATED_AT} />
      </div>

      <LegalSection id="resumo" title="Em resumo">
        <ul>
          <li>O Tralked nunca pede a senha das suas contas de jogo e não vende dados de ninguém.</li>
          <li>Guardamos o necessário para montar o seu personagem: conquistas, jogos e o que você publica.</li>
          <li>
            Você baixa uma cópia de tudo ou exclui a conta a qualquer momento em{" "}
            <Link href="/conta">Conta</Link>.
          </li>
          <li>Só usamos cookies necessários, a não ser que você aceite os opcionais.</li>
        </ul>
      </LegalSection>

      <LegalSection id="contas" title="Conta e login">
        <p>Guardamos o mínimo para identificar a conta:</p>
        <ul>
          <li>
            <strong>E-mail e senha:</strong> o e-mail com que você entra e a senha só em forma de hash
            (scrypt, com sal próprio): nem a equipe consegue ler a sua senha. Links de &quot;esqueci a
            senha&quot; valem 1 hora e também são guardados só em hash.
          </li>
          <li>
            <strong>Steam:</strong> o SteamID64, o nome e o avatar do perfil e se ele é público. Basta
            informar o perfil; só para reivindicar uma conta que já está em outro perfil você prova que ela
            é sua colando um código no Resumo. A Steam nunca nos envia a sua senha.
          </li>
          <li>
            <strong>Google:</strong> o identificador da conta, o nome, a foto e o e-mail (quando verificado
            pelo Google). Usamos o Google só para o login.
          </li>
          <li>
            <strong>Perfil no Tralked:</strong> o seu @, a bio que você escrever e a escolha de deixar o
            personagem público ou privado.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="conquistas" title="Jogos e conquistas">
        <p>
          Para calcular XP, nível, habilidades, atributos, missões e sequências, lemos das plataformas
          conectadas (Steam, PlayStation, Xbox e RetroAchievements) os jogos, o tempo de jogo e as conquistas
          desbloqueadas, com a data de cada uma. Esses dados já são públicos no perfil de cada plataforma;
          contas privadas não são lidas.
        </p>
        <p>
          Para conectar PlayStation, Xbox ou RetroAchievements, basta informar o seu perfil público (para
          reivindicar uma conta que já está em outro perfil, você cola um código temporário nele).
          Guardamos o identificador público da conta e o nome nela, nunca senha ou token de acesso seu.
        </p>
      </LegalSection>

      <LegalSection id="conteudo" title="O que você publica">
        <p>
          Comentários, tópicos e respostas do fórum, fotos da galeria, dicas e votos nos guias, curtidas e
          denúncias ficam ligados à sua conta. O que é público aparece com o seu @. Denúncias só são vistas
          pela moderação.
        </p>
      </LegalSection>

      <LegalSection id="notificacoes" title="Notificações">
        <p>
          Avisos como respostas, curtidas e subidas de nível ficam guardados por{" "}
          <strong>{NOTIFICATION_RETENTION_DAYS} dias</strong> e depois são apagados automaticamente, porque
          o texto deles pode citar outras pessoas.
        </p>
      </LegalSection>

      <LegalSection id="newsletter" title="Newsletter">
        <p>
          Se você se inscrever, guardamos o e-mail e a data em que você confirmou a inscrição pelo link que
          enviamos. Sem a confirmação, nada é enviado.
        </p>
      </LegalSection>

      <LegalSection id="sessoes" title="Sessões e segurança">
        <p>
          A sessão é um cookie assinado que dura 30 dias ou até você sair. Para evitar spam, contamos
          quantos comentários, posts e fotos cada conta envia por dia. Os robôs da API deixam um histórico
          do que enviaram.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies">
        <p>
          Hoje o Tralked usa <strong>só cookies necessários</strong>. Cookies opcionais, como medição de
          audiência e publicidade, só serão usados se você aceitar. A sua preferência de som fica guardada
          no próprio navegador (armazenamento local) e não sai dele.
        </p>
        {/* Scrolls sideways on narrow screens; focusable so the keyboard can scroll it too. */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabela de cookies">
          <table className="w-full min-w-[520px] border-collapse text-left text-[14.5px]">
            <caption className="sr-only">Cookies usados pelo Tralked</caption>
            <thead>
              <tr className="border-b border-line-2 font-mono text-xs tracking-[0.08em] text-dim uppercase">
                <th scope="col" className="py-2 pr-4 font-medium">Cookie</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tipo</th>
                <th scope="col" className="py-2 pr-4 font-medium">Para quê</th>
                <th scope="col" className="py-2 font-medium">Duração</th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((cookie) => (
                <tr key={cookie.name} className="border-b border-divider align-top">
                  <th scope="row" className="py-2.5 pr-4 font-mono text-[13px] font-medium text-text">
                    {cookie.name}
                  </th>
                  <td className="py-2.5 pr-4">{cookie.kind}</td>
                  <td className="py-2.5 pr-4">{cookie.what}</td>
                  <td className="py-2.5 whitespace-nowrap">{cookie.lasts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CookiePreferences />
      </LegalSection>

      <LegalSection id="compartilhamento" title="Com quem compartilhamos">
        <p>
          Não vendemos nem alugamos dados. Eles ficam nos serviços de hospedagem, banco de dados e
          armazenamento de fotos que operam o Tralked, que só os processam para manter o site no ar. Para
          ler conquistas, o Tralked consulta as plataformas de jogo com o identificador público da sua
          conta.
        </p>
      </LegalSection>

      <LegalSection id="direitos" title="Seus direitos">
        <ul>
          <li>
            <strong>Acesso e portabilidade:</strong> baixe tudo em JSON em <Link href="/conta">Conta</Link>.
          </li>
          <li>
            <strong>Correção:</strong> edite a bio e a visibilidade do personagem em{" "}
            <Link href="/conta">Conta</Link>; nome e avatar vêm da plataforma.
          </li>
          <li>
            <strong>Exclusão:</strong> exclua a conta em <Link href="/conta">Conta</Link>. Perfil, contas
            conectadas, biblioteca, conquistas, histórico de XP, curtidas, notificações e a inscrição na
            newsletter com o e-mail da conta são apagados. O que você publicou (comentários, tópicos, fotos,
            dicas) continua no site como de autor anônimo, sem nenhum vínculo com você.
          </li>
          <li>
            <strong>Desconectar:</strong> desvincule PlayStation, Xbox ou RetroAchievements em{" "}
            <Link href="/conta/conexoes">Conexões</Link>.
          </li>
        </ul>
        <p>
          Dúvidas ou pedidos sobre seus dados: <ContactEmail subject="Privacidade" />.
        </p>
      </LegalSection>
    </div>
  );
}
