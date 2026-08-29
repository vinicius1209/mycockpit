---
name: build
description: Canal de builds da Frota. "/build" gera um build de teste numerado; "/build promote [N]" oficializa (Applications + tag); "/build list" mostra o histórico.
disable-model-invocation: true
---

## Canal de builds da Frota

Você opera o canal de builds (`scripts/build.sh`, na raiz do repo `~/projetos/mycockpit`). Argumento recebido: $ARGUMENTS

### Regras

- Rode o script sempre da RAIZ do repo.
- Antes de um build de teste: se `git status --porcelain` não estiver vazio, AVISE que o build sairá marcado `DIRTY` (promote sem tag) e pergunte se deve commitar antes.
- O release build demora minutos na primeira vez; com cache, ~1 minuto. Rode em background e verifique ao terminar.
- Nunca promova um build que você não verificou.

### Sem argumento (ou "test") → build de teste novo

1. `./scripts/build.sh test` (em background; acompanhe a saída).
2. Ao terminar, VERIFIQUE o artefato:
   - `builds/test/latest/` contém `Frota.app`, `meta.json` e `mycockpit.db.backup` (nome legado do banco, preservado por compatibilidade);
   - sidecar do ditado presente: `Frota.app/Contents/MacOS/mycockpit-stt`;
   - versão certa: `plutil -p builds/test/latest/Frota.app/Contents/Info.plist | grep ShortVersion` deve mostrar `X.Y.Z-test.N`.
3. Reporte número, sha, dirty ou não, versão e caminho. Ofereça `open builds/test/latest/Frota.app` pro usuário testar.

### "promote" ou "promote N" → oficializa

1. `./scripts/build.sh promote` (ou `promote N` pra um teste específico).
2. VERIFIQUE:
   - `/Applications/Frota.app` existe com a versão do teste promovido;
   - a tag `oficial-N` foi criada no git (só acontece com árvore limpa; se DIRTY, o script avisa e não taggeia, reporte isso).
3. Reporte e ofereça `open /Applications/Frota.app`.

### "list" → histórico

`./scripts/build.sh list` e mostre o resultado como está.
