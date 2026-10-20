[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

# EasySource

Um cliente Git visual, moderno e multiplataforma para **Windows, macOS e
Linux**.

Abas de repositório, grafo de commits, staging dividido com seleção de hunks e
linhas, e diálogos para todas as operações Git do dia a dia — feito com
Electron, Node.js e HTML5/CSS/JavaScript puros, sobre a linha de comando do Git.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="EasySource mostrando o histórico de um repositório com branches, um merge e uma tag" src="docs/screenshot-light.png">
</picture>

## Recursos

- **Abas de repositório:** favoritos, clonar (branch, profundidade, submódulos), adicionar existente, criar novo
- **Alterações:** painéis staged e não staged, stage/unstage/descarte por arquivo, hunk ou linhas
  selecionadas, filtros (pendentes, conflitos, não rastreados, modificados, ignorados), atalhos (+, −, Del)
- **Commit:** amend, sign-off, ignorar hooks, push logo após o commit
- **Histórico:** grafo de commits com rótulos de branches e tags, ordem por data ou ancestralidade,
  todas as branches ou só a atual, ir para commit, detalhes e diff do commit
- **Busca:** por mensagem de commit, autor, alterações de conteúdo ou caminho de arquivo
- **Sincronização:** fetch, pull (merge ou rebase) e push com seleção e rastreamento por branch,
  com janela de progresso ao vivo
- **Branches e tags:** criar, excluir, renomear, checkout (local ou remoto), merge, rebase,
  rebase interativo (reordenar, squash, fixup, descartar)
- **Commits:** reset (soft, mixed, hard), revert, cherry-pick, criar patch, arquivar
- **Mais:** stashes, resolução de conflitos, Git flow, blame, submódulos, remotos, `.gitignore`,
  identidade por repositório
- Tema claro/escuro (segue o sistema ou escolhido manualmente)

A interface está disponível em inglês, português do Brasil, espanhol, chinês simplificado,
japonês, alemão, francês, coreano e russo. Ela segue o idioma do sistema e pode ser
trocada em Ferramentas > Opções. Os termos do Git (commit, push, merge…) ficam em inglês.

## Download

Baixe a versão mais recente na página de [Releases](https://github.com/RogerPhilippe/EasySource/releases):

| Sistema | Arquivo |
|---|---|
| Windows x64 (instalador) | `EasySource-Setup-<versão>-x64.exe` |
| Windows x64 (portátil) | `EasySource-<versão>-win-x64.zip` |
| macOS (Apple Silicon) | `EasySource-<versão>-mac-arm64.dmg` |
| macOS (Intel) | `EasySource-<versão>-mac-x64.dmg` |
| Linux x64 | `EasySource-<versão>-linux-x64.AppImage`, `.deb` ou `.tar.gz` |

O [Git](https://git-scm.com/downloads) precisa estar instalado e disponível no `PATH`.

As builds não são assinadas, então o sistema mostra um aviso na primeira execução:

- **Windows:** no aviso do SmartScreen, clique em **Mais informações → Executar assim mesmo**.
- **macOS:** clique com o botão direito no app → **Abrir**, ou rode
  `xattr -dr com.apple.quarantine /Applications/EasySource.app`.
- **Linux (AppImage):** rode `chmod +x EasySource-*.AppImage` antes.

## Executando localmente

Requisitos: Node.js 20+ e Git

```bash
npm install
node node_modules/electron/install.js   # só se o npm bloquear o script de instalação do Electron
npm start                               # ou: npm start -- C:\caminho\do\repo
```

## Testes

```bash
npm test             # camada Git e grafo de commits, contra repositórios temporários reais
npm run test:smoke   # abre o app num repositório de exemplo e verifica erros
```

## Gerando o app

```bash
npm run icon         # regenera os ícones a partir de assets/icon.svg
npm run dist         # gera para o sistema atual em dist/
npm run dist:win     # ou uma plataforma: dist:win, dist:mac, dist:linux
```

Cada plataforma é gerada no próprio sistema (os pacotes de macOS exigem
macOS). Os workflows do GitHub Actions geram as três: `CI` a cada push, e
`Release` quando uma tag `v*` é enviada, publicando os pacotes numa release.

O app de macOS recebe assinatura ad-hoc. Para distribuir sem os avisos do
Gatekeeper ou do SmartScreen, assine com um Developer ID (macOS) ou um
certificado de assinatura de código (Windows).

## Estrutura do projeto

```
src/main/        processo principal (Node.js)
  main.js        janela, IPC, monitoramento de arquivos
  git.js         wrapper da linha de comando do Git e parsers de saída
  menu.js        menu da aplicação
  store.js       favoritos, abas abertas e preferências
src/preload.js   ponte segura entre o processo principal e a interface
src/i18n.js      escolha do idioma e busca das traduções
src/locales/     traduções da interface (um JSON por idioma; o inglês é a origem)
src/renderer/    interface (HTML5, CSS, JavaScript)
  js/repo.js     aba de repositório: barras laterais de ações, barra lateral e views
  js/status.js   alterações e commit
  js/history.js  histórico, busca e detalhes do commit
  js/actions.js  diálogos das operações Git
assets/          ícone do app (fonte SVG, PNG, ICO)
.github/         workflows de CI e release (Windows, macOS, Linux)
```

## Stack

Electron · Node.js · Git CLI · HTML5 · CSS · JavaScript — sem dependências em tempo de execução.

## Licença

O EasySource é distribuído sob **licença dupla**:

- [AGPLv3](LICENSE) — gratuita para qualquer uso, inclusive comercial, desde
  que quem receber o software (ou usar uma versão modificada pela rede)
  também receba o código-fonte completo sob a mesma licença.
- [Licença comercial](COMMERCIAL-LICENSE.pt-BR.md) — uma salvaguarda, não um
  produto: só é necessária para usar o EasySource de forma fechada ou
  proprietária, e é concedida a critério exclusivo do mantenedor.

### O que você pode fazer

| Uso | Permitido? |
|---|---|
| Usar o EasySource pessoalmente ou no trabalho, inclusive em empresas | Sim, gratuito |
| Estudar, modificar e gerar sua própria versão | Sim, gratuito |
| Redistribuir ou vender cópias, originais ou modificadas, junto com o código-fonte completo sob a AGPLv3 | Sim, gratuito (AGPLv3) |
| Oferecer uma versão modificada como serviço de rede | Sim, se o código modificado for publicado sob a AGPLv3 |
| Vender ou distribuir como código fechado, ou incorporar em software proprietário | Somente com licença comercial do mantenedor |

Esta tabela é um resumo para conveniência; prevalece o texto da [LICENSE](LICENSE).

### Software de terceiros

Os pacotes incluem Electron, Chromium e Node.js sob suas próprias licenças
(MIT, BSD-3-Clause e outras), distribuídas junto com o app como
`LICENSE.electron.txt` e `LICENSES.chromium.html`. O EasySource não tem
outras dependências em tempo de execução; ferramentas de build como o
electron-builder não são incluídas no app.

Contribuições estão sujeitas aos termos do [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).
Para reportar um problema de segurança, veja o [SECURITY.md](SECURITY.md#português-br).

Copyright © 2026 Roger Philippe Pereira
