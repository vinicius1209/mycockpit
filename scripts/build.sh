#!/usr/bin/env bash
# Canal de builds da Frota: testes numerados até você aprovar → promote
# vira o oficial (em /Applications + builds/official + tag no git).
#
#   ./scripts/build.sh            build de TESTE (nº sequencial + sha)
#   ./scripts/build.sh promote    promove o último teste a OFICIAL
#   ./scripts/build.sh promote 12 promove o teste nº 12
#   ./scripts/build.sh dmg        empacota o OFICIAL num DMG pessoal arrastável
#   ./scripts/build.sh list       histórico
set -euo pipefail
cd "$(dirname "$0")/.."

APP_DIR="app"
BUILDS="builds"
APPDATA="$HOME/Library/Application Support/dev.vinicius.mycockpit"
BASE_VERSION=$(python3 -c "import json;print(json.load(open('$APP_DIR/src-tauri/tauri.conf.json'))['version'])")

next_num() {
  local last
  last=$(ls "$BUILDS/test" 2>/dev/null | grep -E '^[0-9]{3}-' | sort | tail -1 | cut -d- -f1 || true)
  printf "%03d" $((10#${last:-0} + 1))
}

meta_of() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['num'], d['sha'], d['version'])" "$1"; }

case "${1:-test}" in
  test)
    NUM=$(next_num)
    SHA=$(git rev-parse --short HEAD)
    DIRTY=""
    [[ -n "$(git status --porcelain)" ]] && DIRTY="-dirty"
    VERSION="$BASE_VERSION-test.$((10#$NUM))"
    OUT="$BUILDS/test/$NUM-$SHA$DIRTY"
    echo "→ build de teste #$((10#$NUM)) · $SHA$DIRTY · versão $VERSION"
    echo "  (release build: a primeira vez leva alguns minutos)"

    # seguro: os builds compartilham o SQLite real → snapshot antes do teste.
    mkdir -p "$OUT"
    if [[ -f "$APPDATA/mycockpit.db" ]]; then
      cp "$APPDATA/mycockpit.db" "$OUT/mycockpit.db.backup"
      echo "  backup do banco → $OUT/mycockpit.db.backup"
    fi

    # Carimbo do build no binário (ADR-264): a faixa do app diz qual Frota é,
    # de qual commit e quando foi feito (`versao.rs`, `option_env!`).
    export FROTA_BUILD_NUM=$((10#$NUM)) FROTA_BUILD_SHA="$SHA" FROTA_BUILD_DATE="$(date +%Y-%m-%dT%H:%M:%S)"
    export FROTA_BUILD_DIRTY=$([[ -n "$DIRTY" ]] && echo 1 || echo 0)
    (cd "$APP_DIR" && bun tauri build --bundles app --config "{\"version\": \"$VERSION\"}")

    BUNDLE="$APP_DIR/src-tauri/target/release/bundle/macos/Frota.app"
    # O linker assina apenas o Mach-O. Sem selar o bundle, `codesign --verify`
    # acusa recursos ausentes mesmo com o app local abrindo.
    #
    # Identidade ESTÁVEL, não ad hoc (ADR-201). Com `--sign -` o requisito
    # designado do app é o próprio cdhash, que muda a cada build: o Keychain
    # tratava cada build como um app estranho e pedia a senha do usuário para
    # ler o token OAuth dos MCPs (a ACL do item chegou a 9 cdhashes). Com um
    # certificado de code signing (auto-assinado serve; Developer ID quando
    # houver) o requisito vira `identifier + certificate root`, igual em todos
    # os builds. Sem identidade disponível cai no ad hoc e AVISA.
    SIGN_IDENTITY="${FROTA_SIGN_IDENTITY:-Frota Dev Signing}"
    if security find-identity -v -p codesigning 2>/dev/null | grep -q "\"$SIGN_IDENTITY\""; then
      codesign --force --deep --sign "$SIGN_IDENTITY" "$BUNDLE"
      echo "  assinatura: $SIGN_IDENTITY (requisito estável entre builds)"
    else
      codesign --force --deep --sign - "$BUNDLE"
      echo "  aviso: identidade '$SIGN_IDENTITY' não encontrada; assinatura ad hoc."
      echo "         O Keychain vai pedir senha a cada build novo. Veja docs/decisions.md, ADR-201."
    fi
    codesign --verify --deep --strict "$BUNDLE"

    cp -R "$BUNDLE" "$OUT/"
    cat > "$OUT/meta.json" <<EOF
{"num": $((10#$NUM)), "sha": "$SHA", "dirty": $([[ -n "$DIRTY" ]] && echo true || echo false), "version": "$VERSION", "date": "$(date +%Y-%m-%dT%H:%M:%S)"}
EOF
    ln -sfn "$NUM-$SHA$DIRTY" "$BUILDS/test/latest"

    # Auto-limpeza: mantém só os KEEP builds mais recentes (cada .app é ~20MB).
    # Portável (BSD/macOS): sort -r = mais novo primeiro; tail -n +N pega do N-ésimo
    # em diante (os que passam do KEEP). NNN prefixado garante ordem monotônica.
    KEEP="${MC_KEEP_BUILDS:-3}"
    N=0
    while IFS= read -r d; do
      [[ -n "$d" ]] && rm -rf "$d" && N=$((N+1))
    done < <(find "$BUILDS/test" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' | sort -r | tail -n +$((KEEP+1)))
    [[ "$N" -gt 0 ]] && echo "  (auto-limpeza: $N build(s) antigo(s) apagado(s); mantidos os $KEEP mais recentes)"

    echo ""
    echo "✓ teste #$((10#$NUM)) pronto: $OUT/Frota.app"
    echo "  testar:   open '$OUT/Frota.app'"
    echo "  aprovar:  ./scripts/build.sh promote"
    ;;

  promote)
    PICK="${2:-latest}"
    if [[ "$PICK" == "latest" ]]; then
      SRC="$BUILDS/test/$(readlink "$BUILDS/test/latest")"
    else
      SRC=$(ls -d "$BUILDS/test/$(printf "%03d" "$PICK")"-* 2>/dev/null | head -1 || true)
    fi
    [[ -n "${SRC:-}" && -d "$SRC" ]] || { echo "build de teste não encontrado: $PICK"; exit 1; }
    read -r NUM SHA VERSION < <(meta_of "$SRC/meta.json")

    echo "→ promovendo o teste #$NUM ($SHA · $VERSION) a OFICIAL"
    mkdir -p "$BUILDS/official"
    rm -rf "$BUILDS/official/Frota.app" "$BUILDS/official/MyCockpit.app"
    cp -R "$SRC/Frota.app" "$BUILDS/official/"
    cp "$SRC/meta.json" "$BUILDS/official/meta.json"

    # instala em /Applications (fecha o app se estiver aberto; o nome legado
    # MyCockpit sai de cena — rename pra Frota)
    osascript -e 'quit app "Frota"' 2>/dev/null || true
    osascript -e 'quit app "MyCockpit"' 2>/dev/null || true
    sleep 1
    rm -rf "/Applications/Frota.app" "/Applications/MyCockpit.app"
    cp -R "$SRC/Frota.app" /Applications/

    # tag no git (só se o build veio de árvore limpa; dirty não é rastreável)
    if python3 -c "import json,sys;sys.exit(0 if not json.load(open('$SRC/meta.json'))['dirty'] else 1)"; then
      git tag -f "oficial-$NUM" "$SHA"
      echo "  tag: oficial-$NUM → $SHA"
    else
      echo "  aviso: build veio de árvore DIRTY, sem tag no git"
    fi
    echo ""
    echo "✓ OFICIAL: build #$NUM em /Applications/Frota.app"
    ;;

  dmg)
    SRC="$BUILDS/official"
    META="$SRC/meta.json"
    BUNDLE="$SRC/Frota.app"
    [[ -f "$META" && -d "$BUNDLE" ]] || {
      echo "build oficial não encontrado; promova um teste antes de empacotar"
      exit 1
    }
    read -r NUM SHA VERSION < <(meta_of "$META")
    if python3 -c "import json,sys;sys.exit(0 if not json.load(open(sys.argv[1]))['dirty'] else 1)" "$META"; then
      :
    else
      echo "build oficial #$NUM veio de árvore DIRTY; DMG recusado"
      exit 1
    fi
    git cat-file -e "${SHA}^{commit}" 2>/dev/null || {
      echo "commit $SHA do build oficial não existe neste checkout"
      exit 1
    }
    TAG_SHA=$(git rev-parse --short "oficial-$NUM^{commit}" 2>/dev/null || true)
    [[ "$TAG_SHA" == "$SHA" ]] || {
      echo "tag oficial-$NUM não aponta para $SHA; DMG recusado"
      exit 1
    }
    codesign --verify --deep --strict "$BUNDLE"

    PLIST_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
      "$BUNDLE/Contents/Info.plist")
    [[ "$PLIST_VERSION" == "$VERSION" ]] || {
      echo "versão do bundle ($PLIST_VERSION) difere do meta.json ($VERSION)"
      exit 1
    }
    ARCHS=$(lipo -archs "$BUNDLE/Contents/MacOS/app")
    ARCH_LABEL=${ARCHS// /-}
    OUT="$SRC/Frota-$VERSION-$ARCH_LABEL.dmg"
    DMG_TMP_BASE="${TMPDIR:-/tmp}"
    STAGE=$(mktemp -d "$DMG_TMP_BASE/frota-dmg.XXXXXX")
    cleanup_dmg_stage() {
      if [[ -n "${STAGE:-}" && "$STAGE" == "$DMG_TMP_BASE"/frota-dmg.* && -d "$STAGE" ]]; then
        rm -rf -- "$STAGE"
      fi
    }
    trap cleanup_dmg_stage EXIT

    ditto "$BUNDLE" "$STAGE/Frota.app"
    ln -s /Applications "$STAGE/Aplicativos"
    printf '%s\n' \
      'Frota, instalação pessoal no macOS' \
      '' \
      '1. Arraste Frota.app para Aplicativos.' \
      '2. Tente abrir o Frota.' \
      '3. Se o macOS bloquear, abra Ajustes do Sistema, Privacidade e Segurança e escolha Abrir Mesmo Assim.' \
      '4. Se essa opção não aparecer, use no Terminal:' \
      '' \
      '   xattr -dr com.apple.quarantine /Applications/Frota.app' \
      '' \
      'Este pacote tem assinatura ad hoc e deve ser usado apenas em Macs do proprietário.' \
      > "$STAGE/LEIA-ME.txt"

    rm -f "$OUT"
    hdiutil create -quiet -volname "Frota" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
    hdiutil verify "$OUT" >/dev/null
    DMG_SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')

    echo ""
    echo "✓ DMG pessoal #$NUM pronto: $OUT"
    echo "  arquitetura: $ARCHS"
    echo "  SHA-256: $DMG_SHA"
    echo "  instalação: abrir o DMG e arrastar Frota.app para Aplicativos"
    echo "  primeiro uso: o Gatekeeper exige uma autorização manual"
    ;;

  list)
    echo "== testes =="
    if ls "$BUILDS"/test/*/meta.json >/dev/null 2>&1; then
      for m in "$BUILDS"/test/*/meta.json; do
        [[ "$m" == */latest/* ]] && continue # symlink pro último, não duplica
        python3 -c "import json;d=json.load(open('$m'));print(f\"  #{d['num']:>3}  {d['sha']}{'  DIRTY' if d['dirty'] else ''}  {d['version']}  {d['date'][:16]}\")"
      done
    else
      echo "  (nenhum)"
    fi
    echo "== oficial =="
    if [[ -f "$BUILDS/official/meta.json" ]]; then
      python3 -c "import json;d=json.load(open('$BUILDS/official/meta.json'));print(f\"  #{d['num']}  {d['sha']}  {d['version']}  {d['date'][:16]}\")"
    else
      echo "  (nenhum ainda)"
    fi
    ;;

  *)
    echo "uso: ./scripts/build.sh [test|promote [N]|dmg|list]"
    exit 1
    ;;
esac
