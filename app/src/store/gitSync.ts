// Os gestos de rede da aba Alterações por pasta: o que está rodando e a faixa
// do último erro. Mora fora do componente porque um push leva segundos e a aba
// pode desmontar no meio; ao voltar, o botão ainda gira e o erro ainda está lá.

import { create } from "zustand"
import { avisar } from "@/lib/avisos"
import {
  buscar,
  comoErroDeGit,
  enviar,
  trazer,
  type ErroDeGit,
  type GestoDeRede,
} from "@/lib/gitSync"
import { avisarGravacao, haTurnoNaPasta } from "@/lib/sinaisDoDisco"

export interface FaixaDoGit {
  erro: ErroDeGit
  /** O gesto que falhou, para repetir depois da saída que a faixa oferece. */
  gesto: GestoDeRede
}

interface GitSyncState {
  emCurso: Record<string, GestoDeRede | undefined>
  faixa: Record<string, FaixaDoGit | undefined>
  /** Roda o gesto. `rebase`: trazer reaplicando os seus commits por cima, o
   *  gesto explícito que a faixa de divergência oferece. */
  executar: (cwd: string, gesto: GestoDeRede, o?: { rebase?: boolean }) => Promise<boolean>
  fecharFaixa: (cwd: string) => void
}

const traz = (g: GestoDeRede) => g === "trazer" || g === "trazer-e-enviar"

const FEITO: Record<GestoDeRede, string | null> = {
  enviar: "Commits enviados",
  publicar: "Branch publicada",
  trazer: "Commits trazidos",
  "trazer-e-enviar": "Commits trazidos e enviados",
  buscar: null,
}

export const useGitSync = create<GitSyncState>((set, get) => ({
  emCurso: {},
  faixa: {},

  async executar(cwd, gesto, o = {}) {
    if (get().emCurso[cwd]) return false
    if (traz(gesto) && haTurnoNaPasta(cwd)) {
      avisar.erro("Há um turno rodando nesta pasta.", {
        detalhe: "Trazer commits mudaria os arquivos debaixo do agente. Espere o turno terminar.",
      })
      return false
    }
    set((s) => ({ emCurso: { ...s.emCurso, [cwd]: gesto }, faixa: { ...s.faixa, [cwd]: undefined } }))
    try {
      if (gesto === "buscar") await buscar(cwd)
      if (traz(gesto)) await trazer(cwd, o.rebase === true)
      if (gesto === "enviar" || gesto === "trazer-e-enviar") await enviar(cwd, false)
      if (gesto === "publicar") await enviar(cwd, true)
      const feito = FEITO[gesto]
      if (feito) avisar.feito(feito)
      return true
    } catch (e) {
      const erro = comoErroDeGit(e)
      // Conflito não vira faixa: a aba entra no modo conflito pelo estado do
      // repositório, que é quem sabe os arquivos.
      if (erro.tipo !== "conflito") set((s) => ({ faixa: { ...s.faixa, [cwd]: { erro, gesto } } }))
      return false
    } finally {
      set((s) => ({ emCurso: { ...s.emCurso, [cwd]: undefined } }))
      avisarGravacao(cwd)
    }
  },

  fecharFaixa(cwd) {
    set((s) => ({ faixa: { ...s.faixa, [cwd]: undefined } }))
  },
}))
