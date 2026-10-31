# Tralked — login próprio e Steam como conexão

Data: 2026-10-31. Pedido do Lucas: "quero integração com a Steam, mas quero que o login seja feito e criado pelo Tralked", sem mandar o usuário logar na Steam. Ele pediu para seguir com o que eu achar melhor; as decisões abaixo são escolhas minhas (controller), não dele, salvo a regra acima.

## Por quê

Hoje a conta nasce do login OpenID da Steam (redireciona para steamcommunity.com). O Lucas quer que a conta seja do Tralked: a pessoa se cadastra e entra no site, e depois conecta a Steam (e PSN/Xbox/RA) como conexões que sincronizam o progresso.

## Objetivos

1. Cadastro e login no próprio site com **e-mail + senha** (`/entrar`, `/cadastrar`), sessão atual (cookie JWT `gl_session`) mantida.
2. **Steam vira conexão** em `/conta/conexoes`, verificada pelo mesmo modelo Exophase de PSN/Xbox/RA: a pessoa informa o perfil (URL, vanity ou SteamID64), recebe um código `TRK-XXXXXX` (30 min), cola no "Resumo" do perfil Steam, confirma; o Tralked lê o perfil público (`steamcommunity.com/profiles/<id>?xml=1`, campo `<summary>`) e vincula. Em dev/teste, fixtures (como as de PSN/Xbox).
3. Depois de vinculada, a Steam sincroniza como hoje (biblioteca, conquistas, XP).
4. Contas antigas (criadas pelo login Steam, sem e-mail/senha — ex.: `mrdead`, `diguzz`) não se perdem.

## Não-objetivos

- Login pela Steam (OpenID) — sai. Nenhum botão "Entrar com a Steam"; as rotas `/api/auth/steam` e `/api/auth/steam/callback` e `lib/auth/openid.ts`/`oid-state.ts` são removidas (com seus testes).
- Provedor real de e-mail: continua fora (Plano 4). Links de e-mail (redefinir senha) vão para o log do servidor, como a confirmação da newsletter já faz (`console.info`).
- Verificação obrigatória de e-mail no cadastro.

## Anti-objetivos (falha mesmo se "funcionar")

- Pedir senha ou token de **outro serviço** (Steam, PSN, Xbox, Google). A senha pedida é só a do Tralked.
- Guardar senha em texto ou com hash fraco; mensagens que revelam se um e-mail existe (login e "esqueci a senha" respondem igual).
- Perder o histórico de quem já usava o Tralked pela Steam.

## Decisões (minhas)

- **Senha**: `node:crypto` scrypt com salt aleatório por usuário (sem dependência nova), comparação em tempo constante; mínimo 8 caracteres, máximo 128. Campo novo `User.passwordHash` (nullable) e `User.email` passa a ser único quando presente (migration aditiva; conferir duplicatas antes).
- **Cadastro** (`/cadastrar`): nome de exibição, @handle (validação e reservas existentes, ex. `me`), e-mail, senha, aceite dos termos/privacidade (links). Cria a sessão e leva a `/conta/conexoes` com um convite "Conecte a sua Steam".
- **Login** (`/entrar?returnTo=`): e-mail + senha; erro genérico "E-mail ou senha incorretos"; limite de tentativas por IP e por e-mail (em memória, como o rate limit da API de robôs); `returnTo` sanitizado (`lib/auth/return-to.ts`).
- **Esqueci a senha** (`/esqueci-senha` → `/redefinir-senha?token=`): token aleatório, guardado só como hash, uso único, vale 1 h; resposta sempre igual; link no log do servidor.
- **Trocar senha / definir e-mail** em `/conta` (perfil).
- **Google**: continua como alternativa opcional em `/entrar` e `/cadastrar` (só aparece com as chaves), e como conexão em `/conta/conexoes` como já é.
- **Login de demonstração** (`/api/auth/demo`, só fora de produção): continua.
- **Cabeçalho / "Personagem"** sem sessão → `/entrar?returnTo=/jogador/me` (botão "Entrar"); `/jogador/me` sem sessão também redireciona para `/entrar`. Todos os textos "Entre com a Steam para …" viram "Entre para …" apontando para `/entrar`.
- **Conectar Steam** reaproveita o fluxo/telas de `lib/accounts/link.ts` (código, expiração, conta já vinculada a outro usuário → recusa com mensagem clara). `User.steamId` continua sendo preenchido ao vincular (o sync usa) e o `LinkedAccount` Steam verificado é criado/espelhado como hoje. Desvincular Steam segue as regras atuais (anula XP no ledger, sem apagar).
- **Contas antigas — "recuperar histórico"**: se a Steam verificada pertence a uma conta antiga **sem credenciais** (sem `passwordHash` e sem `googleSub`), o e-mail/senha da conta recém-criada passam para a conta antiga (que mantém handle, XP, conquistas, papel) e a conta nova — que ainda não tem dados — é apagada; a sessão passa para a conta antiga e a tela diz "Encontramos o seu histórico do Tralked". Se a conta antiga já tem credenciais, recusa como "Steam já vinculada a outra conta".
- **Admin sem e-mail** (ex.: `mrdead`): script `pnpm user:invite <handle> <email>` que grava o e-mail e imprime um link de "definir senha" (mesmo mecanismo do redefinir). Documentar no README.
- **Seed**: `lucas` ganha e-mail e senha de teste definidos no próprio seed (documentados no README como credenciais só de dev); os demais seeds ficam sem credenciais.

## Restrições

- Regras globais em `.superpowers/sdd/2026-10-31-tralked-plano-2/global-constraints.md` (pt-BR na UI, tokens visuais, zod em Server Actions, acessibilidade/axe, 404 reais, testes com banco próprio, nunca usar `gamelog`/`gamelog_dev`).
- Atualizar a regra "Nunca pedir senha ou token de sessão ao usuário" para "Nunca pedir senha ou token de **outros serviços**" (README e constraints).
- Telas novas seguem o visual atual (ver `/conta`, `AccountLogin.tsx`); formulários acessíveis (labels, erros ligados aos campos, foco no primeiro erro).

## Fica com quem implementar

Layout exato das telas, mensagens finas, estrutura de arquivos, forma do rate limit, testes (unidade + db + e2e dos fluxos: cadastro, login, erro de senha, esqueci/redefinir, conectar Steam com código válido/ausente/expirado/já usado, recuperar histórico de conta antiga, anônimo em `/jogador/me`).

## Adendo (2026-10-31, tarde) — conexões "igual Exophase"

Pedido do Lucas: não gostou do código no perfil; quer o modelo do Exophase (print do formulário "Service details": um campo por serviço, "Save changes", lembrete de privacidade, "manual profile scan"). Decisões (controller), aprovadas pelo Lucas ao mandar o print em resposta à proposta:

- **Formulário "Serviços"** em `/conta/conexoes`: uma linha por plataforma suportada — Steam (aceita link do perfil, nome da URL personalizada ou SteamID64), PSN (ID online), Xbox (gamertag), RetroAchievements (usuário). Um botão "Salvar alterações" aplica todos os campos alterados de uma vez, com resultado por campo. Abaixo: "Confira as suas configurações de privacidade se nenhum jogo aparecer" (link para uma seção de ajuda em pt-BR explicando como deixar cada perfil público) e "Precisa sincronizar agora? Sincronizar" (respeitando o limite de sincronização existente).
- **Conectar na hora, sem código**: ao salvar, o Tralked confirma que o perfil existe e é público (Steam: perfil e detalhes de jogos públicos; PSN/Xbox/RA: perfil encontrado), grava a conexão como **não verificada** e dispara a sincronização. Contas não verificadas sincronizam e pagam XP normalmente; o perfil e a tela de conexões mostram "não verificada" na conexão.
- **Esvaziar um campo** = desconectar, com confirmação explícita antes ("o XP vindo dessa conta é anulado") — mesma regra de desvínculo atual (anula no ledger, não apaga).
- **Unicidade**: uma conta de plataforma (plataforma + id externo) só pode estar em um perfil do Tralked. Se já estiver em outro: recusa com "Essa conta já está conectada a outro perfil" e o botão "É sua? Reivindicar".
- **Reivindicar** (único lugar onde há prova de posse): reaproveita o fluxo de código no perfil que já existe (código `TRK-…`, 30 min). Provado: a conexão passa para quem reivindicou (como **verificada**), o XP que ela tinha gerado no perfil anterior é anulado pelo caminho de desvínculo e o perfil anterior recebe uma notificação. A recuperação de histórico de conta antiga sem credenciais (regra já existente) só acontece por esse caminho — nunca só digitando o ID.
- **Produção sem credencial da plataforma**: PSN (`PSN_NPSSO`), Xbox (`XBOX_OPENXBL_KEY`) e RetroAchievements (`RA_USERNAME`/`RA_API_KEY`) ausentes em `NODE_ENV=production` → a linha aparece como "Em breve" (campo desabilitado) e os clientes **nunca** caem nas fixtures. Fixtures só fora de produção (ou com o modo de teste explícito). Steam continua funcionando sem chave (páginas públicas).
- Plataformas do print que o Tralked não lê (GOG, EA, Google Play, Ubisoft, Stadia, Epic, Nintendo, Apple) ficam fora.
