// Imagem na aba Alterações. Patches colhidos do git de verdade em 16/09/2026:
// os quadros novos do estudo do Maestri, o ícone modificado em c43f92b e uma
// imagem apagada num repositório de teste.
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ patch: "" }))

vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd !== "git_diff") throw new Error(`invoke não mapeado: ${cmd}`)
    return { isRepo: true, branch: "main", patch: h.patch }
  }),
}))

import { loadGitDiff } from "@/lib/git"
import { galeriaDoDiff, imagemDoDiffVisivel } from "@/lib/diffImagem"

const QUADRO_NOVO = `diff --git a/docs/assets/maestri-chat/video-frame-22.jpg b/docs/assets/maestri-chat/video-frame-22.jpg
new file mode 100644
index 0000000..262cb7e
Binary files /dev/null and b/docs/assets/maestri-chat/video-frame-22.jpg differ
`
const VIDEO_NOVO = `diff --git a/docs/assets/maestri-chat/video-maestri-chat.mp4 b/docs/assets/maestri-chat/video-maestri-chat.mp4
new file mode 100644
index 0000000..b5178e4
Binary files /dev/null and b/docs/assets/maestri-chat/video-maestri-chat.mp4 differ
`
const ICONE_MODIFICADO = `diff --git a/app/src-tauri/icons/128x128.png b/app/src-tauri/icons/128x128.png
index c0c5c86..8d8ebbb 100644
Binary files a/app/src-tauri/icons/128x128.png and b/app/src-tauri/icons/128x128.png differ
`
const IMAGEM_APAGADA = `diff --git a/a.png b/a.png
deleted file mode 100644
index 3608e27..0000000
Binary files a/a.png and /dev/null differ
`
const MARKDOWN_NOVO = `diff --git a/docs/bastidores-plan.md b/docs/bastidores-plan.md
new file mode 100644
index 0000000..69d6bf6
--- /dev/null
+++ b/docs/bastidores-plan.md
@@ -0,0 +1,1 @@
+# Bastidores
`

const RAIZ = "/Users/viniciusmachado/projetos/mycockpit"

async function arquivos(...patches: string[]) {
  h.patch = patches.join("")
  return (await loadGitDiff(RAIZ)).files
}

beforeEach(() => {
  h.patch = ""
})

describe("imagemDoDiffVisivel", () => {
  it("imagem nova e imagem modificada têm o que mostrar do disco", async () => {
    const [novo, modificado] = await arquivos(QUADRO_NOVO, ICONE_MODIFICADO)
    expect(novo.status).toBe("added")
    expect(modificado.status).toBe("modified")
    expect(imagemDoDiffVisivel(novo)).toBe(true)
    expect(imagemDoDiffVisivel(modificado)).toBe(true)
  })

  it("imagem apagada não existe mais no disco, então segue sem prévia", async () => {
    const [apagada] = await arquivos(IMAGEM_APAGADA)
    expect(apagada.binary).toBe(true)
    expect(imagemDoDiffVisivel(apagada)).toBe(false)
  })

  it("binário que o visualizador não abre (vídeo) não promete prévia", async () => {
    const [video] = await arquivos(VIDEO_NOVO)
    expect(video.binary).toBe(true)
    expect(imagemDoDiffVisivel(video)).toBe(false)
  })

  it("arquivo de texto continua com o diff de linhas", async () => {
    const [md] = await arquivos(MARKDOWN_NOVO)
    expect(imagemDoDiffVisivel(md)).toBe(false)
  })
})

describe("galeriaDoDiff", () => {
  it("junta só as imagens visíveis, na ordem da lista, lidas pela raiz do diff", async () => {
    const files = await arquivos(
      QUADRO_NOVO,
      VIDEO_NOVO,
      MARKDOWN_NOVO,
      IMAGEM_APAGADA,
      ICONE_MODIFICADO,
    )
    expect(galeriaDoDiff(files, RAIZ)).toEqual([
      {
        path: "docs/assets/maestri-chat/video-frame-22.jpg",
        name: "video-frame-22.jpg",
        source: "arquivo",
        root: RAIZ,
      },
      {
        path: "app/src-tauri/icons/128x128.png",
        name: "128x128.png",
        source: "arquivo",
        root: RAIZ,
      },
    ])
  })
})
