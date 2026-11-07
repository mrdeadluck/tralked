import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/community/PageHead";
import { ContactEmail } from "@/components/legal/ContactEmail";
import { LegalSection, LegalUpdated } from "@/components/legal/LegalSection";
import { LEGAL_UPDATED_AT } from "@/lib/legal/contact";

export const metadata: Metadata = {
  title: "Termos de uso | Tralked",
  description: "Regras de uso do Tralked: conta, conteúdo publicado pela comunidade, direitos autorais e denúncias.",
  alternates: { canonical: "/termos" },
};

export default function TermosPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-10">
      <div className="flex flex-col gap-3">
        <PageHead
          title="Termos de uso"
          lede="As regras para usar o Tralked e publicar na comunidade. Ao criar uma conta ou publicar algo, você concorda com elas."
        />
        <LegalUpdated date={LEGAL_UPDATED_AT} />
      </div>

      <LegalSection id="servico" title="O serviço">
        <p>
          O Tralked reúne notícias de games, guias de conquistas, fórum, galeria e uma ficha de personagem
          calculada a partir das suas conquistas. O site é gratuito e pode mudar, ganhar ou perder
          funções com o tempo.
        </p>
        <p>
          Steam, PlayStation, Xbox, RetroAchievements e os jogos citados são marcas dos seus donos. O Tralked
          não é afiliado a nenhum deles.
        </p>
      </LegalSection>

      <LegalSection id="conta" title="Sua conta">
        <ul>
          <li>Você entra com o e-mail e a senha da sua conta do Tralked (ou com o Google, se o conectar), guarda a senha com você e é responsável pelo que for feito com a sua conta.</li>
          <li>Só conecte contas de jogo que são suas. Vincular a conta de outra pessoa é proibido.</li>
          <li>Conquistas obtidas com trapaça podem ser anuladas, e o XP correspondente sai da ficha.</li>
          <li>
            Você pode excluir a conta quando quiser em <Link href="/conta">Conta</Link>. Veja o que acontece
            com os seus dados na <Link href="/privacidade">política de privacidade</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="conteudo" title="Conteúdo da comunidade">
        <p>
          Comentários, tópicos, respostas, dicas, votos e fotos são de quem os publica. Ao publicar, você
          continua dono do que criou e dá ao Tralked uma licença gratuita e não exclusiva para exibir esse
          conteúdo no site enquanto ele estiver publicado.
        </p>
        <ul>
          <li>Publique só o que você criou ou tem direito de compartilhar, como capturas de tela dos seus jogos.</li>
          <li>Nada de ofensas, assédio, discurso de ódio, spam, golpes, dados pessoais de terceiros ou conteúdo ilegal.</li>
          <li>Spoilers vão marcados. Links devem ajudar a conversa, não vender algo.</li>
          <li>
            A moderação pode esconder ou remover conteúdo que quebre estas regras.
          </li>
          <li>Ações repetidas em excesso (spam de comentários, curtidas ou envios) não rendem XP.</li>
        </ul>
      </LegalSection>

      <LegalSection id="robos" title="Conteúdo de robôs">
        <p>
          Algumas notícias e guias são escritos por robôs pela{" "}
          <Link href="/desenvolvedores">API para desenvolvedores</Link>. As notícias de robôs aparecem
          assinadas como &ldquo;Equipe Tralked&rdquo; e nunca recebem o selo &ldquo;Autoria humana&rdquo;, que
          só as matérias escritas por pessoas da redação levam. A redação decide quais
          robôs podem publicar direto; o que os demais enviam espera a revisão da redação.
        </p>
      </LegalSection>

      <LegalSection id="direitos-autorais" title="Direitos autorais e denúncias">
        <p>
          Se algum conteúdo do Tralked viola os seus direitos autorais ou é ilegal, use o botão Denunciar
          que acompanha comentários, tópicos e fotos, ou escreva para <ContactEmail subject="Direitos autorais" />.
        </p>
        <p>
          No e-mail, informe o link do conteúdo, a obra protegida, por que você é o titular (ou age em nome
          dele) e um contato para resposta. Conteúdo que viole direitos é removido assim que a denúncia é
          confirmada.
        </p>
      </LegalSection>

      <LegalSection id="garantias" title="Limites">
        <p>
          Os dados de jogos, conquistas e raridade vêm das plataformas e de bases públicas e podem atrasar ou
          conter erros. Guias e dicas são orientações da comunidade, sem garantia de resultado.
        </p>
      </LegalSection>

      <LegalSection id="contato" title="Contato">
        <p>
          Dúvidas sobre estes termos: <ContactEmail subject="Termos de uso" />. Componentes de terceiros e
          as respectivas licenças estão em <Link href="/licencas">Licenças</Link>.
        </p>
      </LegalSection>
    </div>
  );
}
