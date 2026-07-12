# MyCockpit icon drafts

## Gerado

- `icon.svg`: fallback vetorial refinado do Reticle como icone de app macOS.
- `icon-svg-1024.png`: PNG 1024x1024 renderizado a partir do SVG.

## Ferramentas

- Tokens consultados em `app/src/index.css`:
  - dark: `#0a0b0d`, `#0c0d10`, `#16181b`
  - cream/rail: `#fbfbfa`, `#f6f6f4`
  - brass: `#a9742b`, `#e4a862`
- Marca consultada em `app/src/components/common/Wordmark.tsx`: Reticle com squircle, anel, cruz e dot central.
- SVG criado manualmente em `assets/icon-drafts/icon.svg`.
- PNG renderizado com Quick Look:

```sh
qlmanage -t -s 1024 -o assets/icon-drafts assets/icon-drafts/icon.svg
mv assets/icon-drafts/icon.svg.png assets/icon-drafts/icon-svg-1024.png
```

## GPT Image

Foi feita uma tentativa com o gerador de imagem integrado usando o brief de `gpt-image-2` para um icone squircle, reticle brass, sem texto e sem gradiente roxo. O tool retornou uma previa na conversa, mas nao disponibilizou um arquivo local em `$CODEX_HOME/generated_images` para mover para `assets/icon-drafts/icon-gptimage-1024.png`.

Tambem foi verificado o fallback por API/CLI `gpt-image-2`, mas `OPENAI_API_KEY` nao esta definido neste ambiente. Por isso, `icon-gptimage-1024.png` nao foi salvo.

## Validacao

`icon-svg-1024.png` foi validado como PNG RGBA 1024x1024:

```sh
file assets/icon-drafts/icon-svg-1024.png
sips -g pixelWidth -g pixelHeight assets/icon-drafts/icon-svg-1024.png
```

## Aplicar no Tauri

```sh
bunx tauri icon assets/icon-drafts/icon-svg-1024.png
```
