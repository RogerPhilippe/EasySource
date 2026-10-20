[English](README.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

# EasySource

Un cliente Git visual, moderno y multiplataforma para **Windows, macOS y
Linux**.

Pestañas de repositorio, grafo de commits, staging dividido con selección de
hunks y líneas, y diálogos para todas las operaciones Git del día a día — hecho
con Electron, Node.js y HTML5/CSS/JavaScript puros, sobre la línea de comandos
de Git.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="EasySource mostrando el historial de un repositorio con ramas, un merge y una etiqueta" src="docs/screenshot-light.png">
</picture>

## Funcionalidades

- **Pestañas de repositorio:** favoritos, clonar (rama, profundidad, submódulos), agregar existente, crear nuevo
- **Cambios:** paneles staged y no staged, stage/unstage/descartar por archivo, hunk o líneas
  seleccionadas, filtros (pendientes, conflictos, sin seguimiento, modificados, ignorados), atajos (+, −, Supr)
- **Commit:** amend, sign-off, omitir hooks, push justo después del commit
- **Historial:** grafo de commits con etiquetas de ramas y tags, orden por fecha o por ascendencia,
  todas las ramas o solo la actual, ir a un commit, detalles y diff del commit
- **Búsqueda:** por mensaje de commit, autor, cambios de contenido o ruta de archivo
- **Sincronización:** fetch, pull (merge o rebase) y push con selección y seguimiento por rama,
  con una ventana de progreso en vivo
- **Ramas y tags:** crear, eliminar, renombrar, checkout (local o remota), merge, rebase,
  rebase interactivo (reordenar, squash, fixup, descartar)
- **Commits:** reset (soft, mixed, hard), revert, cherry-pick, crear parche, archivar
- **Más:** stashes, resolución de conflictos, Git flow, blame, submódulos, remotos, `.gitignore`,
  identidad por repositorio
- Tema claro/oscuro (sigue al sistema o se elige manualmente)

La interfaz está disponible en inglés, portugués de Brasil, español, chino simplificado,
japonés, alemán, francés, coreano y ruso. Sigue el idioma del sistema y se puede cambiar
en Herramientas > Opciones. Los términos de Git (commit, push, merge…) quedan en inglés.

## Descarga

Descarga la versión más reciente en la página de [Releases](https://github.com/RogerPhilippe/EasySource/releases):

| Sistema | Archivo |
|---|---|
| Windows x64 (instalador) | `EasySource-Setup-<versión>-x64.exe` |
| Windows x64 (portable) | `EasySource-<versión>-win-x64.zip` |
| macOS (Apple Silicon) | `EasySource-<versión>-mac-arm64.dmg` |
| macOS (Intel) | `EasySource-<versión>-mac-x64.dmg` |
| Linux x64 | `EasySource-<versión>-linux-x64.AppImage`, `.deb` o `.tar.gz` |

[Git](https://git-scm.com/downloads) debe estar instalado y disponible en el `PATH`.

Las builds no están firmadas, así que el sistema muestra una advertencia en la primera ejecución:

- **Windows:** en la advertencia de SmartScreen, haz clic en **Más información → Ejecutar de todas formas**.
- **macOS:** haz clic derecho en la app → **Abrir**, o ejecuta
  `xattr -dr com.apple.quarantine /Applications/EasySource.app`.
- **Linux (AppImage):** ejecuta `chmod +x EasySource-*.AppImage` antes.

## Ejecución local

Requisitos: Node.js 20+ y Git

```bash
npm install
node node_modules/electron/install.js   # solo si npm bloqueó el script de instalación de Electron
npm start                               # o: npm start -- C:\ruta\al\repo
```

## Pruebas

```bash
npm test             # capa Git y grafo de commits, contra repositorios temporales reales
npm run test:smoke   # abre la app en un repositorio de ejemplo y verifica errores
```

## Compilar la app

```bash
npm run icon         # regenera los íconos a partir de assets/icon.svg
npm run dist         # genera para el sistema actual en dist/
npm run dist:win     # o una plataforma: dist:win, dist:mac, dist:linux
```

Cada plataforma se genera en su propio sistema (los paquetes de macOS
requieren macOS). Los workflows de GitHub Actions generan las tres: `CI` en
cada push, y `Release` cuando se envía una tag `v*`, publicando los paquetes
en una release.

La app de macOS recibe una firma ad-hoc. Para distribuir sin las
advertencias de Gatekeeper o SmartScreen, firma con un Developer ID (macOS)
o un certificado de firma de código (Windows).

## Estructura del proyecto

```
src/main/        proceso principal (Node.js)
  main.js        ventana, IPC, vigilancia de archivos
  git.js         envoltorio de la línea de comandos de Git y parsers de salida
  menu.js        menú de la aplicación
  store.js       favoritos, pestañas abiertas y preferencias
src/preload.js   puente seguro entre el proceso principal y la interfaz
src/i18n.js      elección del idioma y búsqueda de traducciones
src/locales/     traducciones de la interfaz (un JSON por idioma; el inglés es el origen)
src/renderer/    interfaz (HTML5, CSS, JavaScript)
  js/repo.js     pestaña de repositorio: barras laterales de acciones, barra lateral y vistas
  js/status.js   cambios y commit
  js/history.js  historial, búsqueda y detalles del commit
  js/actions.js  diálogos de las operaciones Git
assets/          ícono de la app (fuente SVG, PNG, ICO)
.github/         workflows de CI y release (Windows, macOS, Linux)
```

## Stack

Electron · Node.js · Git CLI · HTML5 · CSS · JavaScript — sin dependencias en tiempo de ejecución.

## Licencia

EasySource se distribuye bajo una **licencia dual**:

- [AGPLv3](LICENSE) — gratuita para cualquier uso, incluido el comercial,
  siempre que quien reciba el software (o use una versión modificada a
  través de la red) también reciba el código fuente completo bajo la misma
  licencia.
- [Licencia comercial](COMMERCIAL-LICENSE.es.md) — una salvaguarda, no un
  producto: solo es necesaria para usar EasySource de forma cerrada o
  propietaria, y se otorga a criterio exclusivo del mantenedor.

### Qué puedes hacer

| Uso | ¿Permitido? |
|---|---|
| Usar EasySource personalmente o en el trabajo, incluso en empresas | Sí, gratis |
| Estudiar, modificar y generar tu propia versión | Sí, gratis |
| Redistribuir o vender copias, originales o modificadas, junto con el código fuente completo bajo la AGPLv3 | Sí, gratis (AGPLv3) |
| Ofrecer una versión modificada como servicio de red | Sí, si el código modificado se publica bajo la AGPLv3 |
| Vender o distribuir como código cerrado, o incorporarlo en software propietario | Solo con una licencia comercial del mantenedor |

Esta tabla es un resumen por conveniencia; prevalece el texto de la [LICENSE](LICENSE).

### Software de terceros

Los paquetes incluyen Electron, Chromium y Node.js bajo sus propias licencias
(MIT, BSD-3-Clause y otras), distribuidas junto con la app como
`LICENSE.electron.txt` y `LICENSES.chromium.html`. EasySource no tiene otras
dependencias en tiempo de ejecución; las herramientas de build como
electron-builder no se incluyen en la app.

Las contribuciones están sujetas a los términos de [CONTRIBUTING.es.md](CONTRIBUTING.es.md).
Para reportar un problema de seguridad, consulta [SECURITY.md](SECURITY.md#español).

Copyright © 2026 Roger Philippe Pereira
