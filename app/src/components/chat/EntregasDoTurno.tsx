// Os arquivos que o turno entregou, em cartão, acima do recibo (G1). A cara é
// a mesma do arquivo solto no composer (`QuadroDeArquivo`); o que muda é o que
// o clique faz: abrir, porque a entrega é para ser vista.
//
// Tamanho e existência vêm do disco na hora de mostrar (e de novo quando a
// janela volta ao foco): arquivo apagado depois diz que sumiu, nunca abre em
// branco.

import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { FolderOpen } from "lucide-react"
import { CASCA_DO_CARTAO_DE_ARQUIVO, QuadroDeArquivo } from "@/components/common/QuadroDeArquivo"
import { abrirMencaoDeArquivo } from "@/components/common/abrirMencaoDeArquivo"
import { iniciarArrasto } from "@/components/common/CamadaDeArrasto"
import { useRaizEfetiva } from "@/components/layout/raizEfetiva"
import { controle } from "@/components/ui/controle"
import { avisar } from "@/lib/avisos"
import { nomeDoCaminho } from "@/lib/arquivoCitado"
import { isImagePath } from "@/lib/fileLink"
import { isTauri } from "@/lib/db"
import type { Entrega } from "@/lib/entregas"
import { fmtBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

interface CaminhoSolto {
  path: string
  pasta: boolean
  bytes: number
}

/** Caminho absoluto da entrega: o motor pode ter escrito relativo à raiz. Puro. */
export function caminhoAbsoluto(caminho: string, raiz: string | null): string {
  if (caminho.startsWith("/") || !raiz) return caminho
  return `${raiz.replace(/\/+$/, "")}/${caminho.replace(/^\.\//, "")}`
}

/** Relativo à raiz quando mora dentro dela; `null` fora (não arrasta como
 *  arquivo do projeto). Puro. */
export function relativoARaiz(abs: string, raiz: string | null): string | null {
  if (!raiz) return null
  const r = `${raiz.replace(/\/+$/, "")}/`
  return abs.startsWith(r) ? abs.slice(r.length) : null
}

/** "PDF · 184 KB". Puro. */
export function metaDaEntrega(caminho: string, bytes: number | null): string {
  const nome = nomeDoCaminho(caminho)
  const i = nome.lastIndexOf(".")
  const tipo = i > 0 ? nome.slice(i + 1).toUpperCase() : "ARQUIVO"
  return bytes == null ? tipo : `${tipo} · ${fmtBytes(bytes)}`
}

/** O disco, lido pelo mesmo comando do arquivo solto. `undefined` = ainda não
 *  sabe (ou fora do app); ausente do mapa depois de ler = sumiu. */
function useNoDisco(caminhos: string[]): Map<string, number> | undefined {
  const [lido, setLido] = useState<Map<string, number> | undefined>(undefined)
  const chave = caminhos.join("\n")
  useEffect(() => {
    if (!isTauri() || caminhos.length === 0) return
    let vivo = true
    const ler = () =>
      invoke<CaminhoSolto[]>("caminhos_soltos", { paths: caminhos })
        .then((achados) => {
          if (vivo) setLido(new Map(achados.filter((a) => !a.pasta).map((a) => [a.path, a.bytes])))
        })
        .catch((e) => console.error("[entregas] não consegui ler o disco", e))
    void ler()
    window.addEventListener("focus", ler)
    return () => {
      vivo = false
      window.removeEventListener("focus", ler)
    }
    // `chave` resume `caminhos`: a lista chega nova a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  return lido
}

/** Dentro da raiz, abre na aba do arquivo; imagem de fora também. Outro
 *  arquivo de fora a aba não lê (raízes permitidas, `sources.rs`) e abrir no
 *  app padrão pede permissão que o app não tem: mostra na pasta. */
function abrirEntrega(caminho: string, rel: string | null, projectPath: string | null): void {
  if (rel) {
    void abrirMencaoDeArquivo({ rel, abs: caminho, line: null }, projectPath)
  } else if (isImagePath(caminho)) {
    useApp.getState().openFileTab(caminho)
  } else {
    void revealItemInDir(caminho).catch(() => avisar.erro("Não encontrei o arquivo (ele ainda existe?)"))
  }
}

export function EntregasDoTurno({ entregas }: { entregas: Entrega[] }) {
  const raiz = useRaizEfetiva()
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path ?? null)
  const abs = useMemo(() => entregas.map((e) => caminhoAbsoluto(e.caminho, raiz)), [entregas, raiz])
  const disco = useNoDisco(abs)
  return (
    <div className="flex flex-col items-start gap-1.5" aria-label="Arquivos entregues neste turno">
      {abs.map((caminho) => {
        const sumiu = disco !== undefined && !disco.has(caminho)
        const rel = relativoARaiz(caminho, raiz)
        return (
          <span key={caminho} className="group/entrega relative inline-flex">
            <button
              type="button"
              disabled={sumiu}
              onClick={() => abrirEntrega(caminho, rel, projectPath)}
              onPointerDown={
                rel && !sumiu
                  ? (event) =>
                      iniciarArrasto(
                        event,
                        { tipo: "arquivo", id: `arquivo:${rel}`, caminho: rel, pasta: false },
                        nomeDoCaminho(caminho),
                      )
                  : undefined
              }
              className={cn(CASCA_DO_CARTAO_DE_ARQUIVO, "min-w-[220px] pr-9", sumiu && "cursor-default opacity-60 hover:bg-secondary/60")}
            >
              <QuadroDeArquivo
                caminho={caminho}
                meta={sumiu ? "não está mais no disco" : metaDaEntrega(caminho, disco?.get(caminho) ?? null)}
              />
            </button>
            {!sumiu && (
              <button
                type="button"
                title="Mostrar na pasta"
                aria-label={`Mostrar ${nomeDoCaminho(caminho)} na pasta`}
                onClick={() =>
                  void revealItemInDir(caminho).catch(() => avisar.erro("Não encontrei o arquivo (ele ainda existe?)"))
                }
                className={cn(
                  controle("chip", { quadrado: true }),
                  "absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/entrega:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100",
                )}
              >
                <FolderOpen className="size-3" />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
