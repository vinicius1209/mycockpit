# Empacotamento instalável — DMG (macOS) e AppImage/deb (Linux)

Como transformar o MyCockpit em artefatos instaláveis. Complementa — e não
substitui — o canal de builds local (`/build`, `scripts/build.sh`), que continua
gerando só o `.app` de teste/oficial na máquina do dev.

**Resumo dos formatos por plataforma** (Linux **não** usa DMG — DMG é um formato
exclusivo do macOS; no Linux os instaláveis são AppImage e `.deb`):

| Plataforma | Alvos | Artefato |
|---|---|---|
| macOS | `app`, `dmg` | `MyCockpit.app` + `MyCockpit_X.Y.Z_aarch64.dmg` |
| Linux | `appimage`, `deb` | `my-cockpit_X.Y.Z_amd64.AppImage` + `.deb` |

O `bundle.targets` do `app/src-tauri/tauri.conf.json` lista os quatro alvos de
uma vez (`["app", "dmg", "appimage", "deb"]`): o bundler do Tauri **ignora os
alvos que não valem pra plataforma corrente**, então o mesmo config serve pro
mac e pro runner Linux. (Antes era `"all"`, que no Linux também tentaria `rpm`;
se um dia precisar de rpm: `bun tauri build --bundles rpm`.)

## 1. DMG local (macOS)

```bash
cd app
bun run tauri build        # roda beforeBuildCommand (bun run build) + cargo release + bundling
```

Artefatos:

- `app/src-tauri/target/release/bundle/macos/MyCockpit.app`
- `app/src-tauri/target/release/bundle/dmg/MyCockpit_0.1.0_aarch64.dmg`

O DMG abre com a janela padrão (app à esquerda, atalho `/Applications` à
direita — posições explicitadas em `bundle.macOS.dmg` no tauri.conf.json).
Não há imagem de fundo configurada porque não existe asset pra isso no repo;
se um dia houver, é só apontar `bundle.macOS.dmg.background` pro arquivo.

**Não conflita com a skill `/build`**: `scripts/build.sh` chama
`bun tauri build --bundles app`, e a flag `--bundles` sobrepõe o
`bundle.targets` do config — os builds de teste continuam gerando só o `.app`
(rápido, sem o passo de DMG). `bun run tauri dev` também não muda: dev não
faz bundling.

O sidecar de ditado (`bin/mycockpit-stt-aarch64-apple-darwin`) é compilado pelo
`build.rs` via `swiftc` e entra no bundle via `bundle.externalBin` — sai dentro
do `.app` em `Contents/MacOS/mycockpit-stt` (o mesmo caminho que a skill
`/build` verifica).

## 2. Assinatura e notarização (macOS)

Sem isso o DMG funciona na sua máquina, mas **baixado da internet** o Gatekeeper
bloqueia (ver "Sem assinatura" abaixo).

### O que precisa

1. **Apple Developer Program** (US$ 99/ano) e um certificado
   **Developer ID Application** instalado no keychain (ou exportado como `.p12`
   pra CI).
2. **Assinar**: o Tauri assina sozinho quando encontra a variável de ambiente:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Fulano de Tal (TEAMID1234)"
   bun run tauri build
   ```

   O Tauri assina o binário principal **e os `externalBin`** (o sidecar de
   ditado incluso) com hardened runtime. Alternativa por config:
   `bundle.macOS.signingIdentity` — preferimos a env var pra não amarrar o
   config a um certificado pessoal.

3. **Notarizar** (obrigatório pro Gatekeeper aceitar de primeira): com as
   variáveis abaixo presentes, o Tauri roda o `notarytool` automaticamente
   após o build:

   ```bash
   # opção A: Apple ID + app-specific password
   export APPLE_ID="viniciusadrianomachado@gmail.com"
   export APPLE_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="TEAMID1234"
   # opção B: chave de API do App Store Connect
   export APPLE_API_KEY="..." APPLE_API_ISSUER="..." APPLE_API_KEY_PATH="AuthKey_XXX.p8"
   ```

### Sem assinatura (estado atual)

O bundle sai com assinatura ad-hoc. Localmente abre normal; baixado
(DMG/zip com quarantine flag), o macOS mostra *"MyCockpit está danificado e não
pode ser aberto"*. Instrução pro usuário que confia no build:

```bash
xattr -cr /Applications/MyCockpit.app
```

(remove os atributos de quarantine; depois abre normalmente). Documentar isso
na página de download enquanto não houver Developer ID.

Atenção extra do nosso caso: o ditado precisa de microfone/fala (TCC). O
Info.plist embutido no sidecar (`stt/Info.plist` via `-sectcreate`) continua
valendo no bundle; com assinatura+notarização os prompts de permissão ficam
mais confiáveis pro usuário final.

## 3. Linux — AppImage e deb

DMG não existe no Linux. Os alvos são `appimage` (portável, roda em qualquer
distro) e `deb` (Debian/Ubuntu). Build precisa rodar **num host Linux** (runner
de CI ou VM) — Tauri não cross-compila bundles de outra plataforma.

### Dependências do host (Ubuntu 22.04/24.04)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential curl wget file \
  libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

(`libwebkit2gtk-4.1` é a dependência de runtime que o `.deb` declara
automaticamente; o AppImage embute o resto, mas depende da webkitgtk 4.1 do
sistema nas distros-alvo.)

### A ressalva do sidecar de ditado (feature macOS-only)

O `build.rs` **só compila o sidecar no macOS** (`if !cfg!(target_os = "macos") { return; }`)
— no Linux não existe `swiftc` nem o framework de fala da Apple. Consequências:

1. **Bundle**: `bundle.externalBin: ["bin/mycockpit-stt"]` faz o bundler exigir
   `app/src-tauri/bin/mycockpit-stt-x86_64-unknown-linux-gnu`. Como o arquivo
   não existe no Linux, `bun tauri build` **falha** lá. Solução recomendada
   (sem tocar no config compartilhado): remover o externalBin só naquele build,
   via merge de config na linha de comando:

   ```bash
   bun tauri build --bundles appimage,deb --config '{"bundle":{"externalBin":[]}}'
   ```

   (o `--config` faz JSON merge e arrays são substituídos — o bundle Linux sai
   sem sidecar). Alternativa: criar um stub executável vazio nesse caminho
   antes do build, mas aí o pacote carrega um binário morto — preferir o
   `--config`.

2. **Runtime**: o código já lida bem com a ausência. Os comandos `stt_*` são
   registrados em todas as plataformas, mas `sidecar_path()`
   (`app/src-tauri/src/stt.rs`) retorna erro amigável
   (*"sidecar de ditado não encontrado"*) quando o binário não está lá — o app
   abre e funciona; só o botão de microfone falha ao ser clicado.
   **Melhoria futura** (fora do escopo deste doc): esconder o `MicButton` no
   front quando `platform() !== "macos"` (via `@tauri-apps/api/core` ou um
   comando que exponha `cfg!(target_os)`).

Artefatos do build Linux:

- `app/src-tauri/target/release/bundle/appimage/my-cockpit_0.1.0_amd64.AppImage`
- `app/src-tauri/target/release/bundle/deb/my-cockpit_0.1.0_amd64.deb`

(nomes derivados do productName em kebab-case; conferir no primeiro build real.)

## 4. Proposta: workflow de release no GitHub Actions

**Proposta — o arquivo ainda NÃO existe** (criar como
`.github/workflows/release.yml` quando formos ativar). Fluxo: push de tag
`v*` → build mac (dmg) + linux (appimage/deb) → GitHub Release em rascunho.
Convive com o `ci.yml` atual (que segue rodando check/lint/test em push/PR) e
com o canal `/build` local (tags `oficial-N` NÃO disparam release — só `v*`).

```yaml
# .github/workflows/release.yml (PROPOSTA)
name: release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  macos:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: app/src-tauri }
      - run: bun install --frozen-lockfile
        working-directory: app
      # swiftc já existe no runner macOS: o build.rs compila o sidecar sozinho.
      - name: build dmg
        working-directory: app
        run: bun tauri build --bundles app,dmg
        # Quando houver Developer ID, descomentar (secrets no repo):
        # env:
        #   APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
        #   APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
        #   APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        #   APPLE_ID: ${{ secrets.APPLE_ID }}
        #   APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
        #   APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: dmg
          path: app/src-tauri/target/release/bundle/dmg/*.dmg

  linux:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: app/src-tauri }
      - name: deps de sistema (webkitgtk 4.1 etc.)
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential \
            curl wget file libxdo-dev libssl-dev \
            libayatana-appindicator3-dev librsvg2-dev
      - run: bun install --frozen-lockfile
        working-directory: app
      - name: build appimage + deb (sem o sidecar de ditado, macOS-only)
        working-directory: app
        run: |
          bun tauri build --bundles appimage,deb \
            --config '{"bundle":{"externalBin":[]}}'
      - uses: actions/upload-artifact@v4
        with:
          name: linux
          path: |
            app/src-tauri/target/release/bundle/appimage/*.AppImage
            app/src-tauri/target/release/bundle/deb/*.deb

  release:
    needs: [macos, linux]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - uses: softprops/action-gh-release@v2
        with:
          draft: true          # revisar antes de publicar
          files: artifacts/**/*
```

Notas da proposta:

- **Versão**: alinhar a tag com o `version` do tauri.conf.json antes de taggear
  (hoje `0.1.0`). Um passo de verificação `tag == config.version` é um bom
  guard-rail futuro.
- Alternativa pronta: [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action)
  faz build+release numa action só (e gera `latest.json` pro updater), mas o
  YAML explícito acima deixa o passo do sidecar Linux visível e controlado.

## 5. Passo futuro: updater do Tauri

Fora do escopo agora; o caminho quando chegar a hora:

1. Plugin `tauri-plugin-updater` (Cargo + `bun add @tauri-apps/plugin-updater`)
   e permissões dele em `capabilities/default.json`.
2. `bundle.createUpdaterArtifacts: true` no tauri.conf.json — gera os pacotes
   `.tar.gz`/`.sig` pro updater junto do build.
3. Par de chaves minisign (`bun tauri signer generate`); a privada vira secret
   de CI (`TAURI_SIGNING_PRIVATE_KEY`), a pública entra em
   `plugins.updater.pubkey` no config.
4. Endpoint de manifest (`latest.json`) servido pelo GitHub Releases — o
   `tauri-action` gera esse manifest automaticamente, ponto a favor de migrar
   pra ele nessa fase.
5. Updater exige builds **assinados** no macOS na prática — depende do item 2
   (Developer ID) estar resolvido.
