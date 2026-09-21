// O recibo da fase mostra `files_touched` — uma lista que o AGENTE escreveu
// sobre si mesmo. Este módulo cruza essa lista com o que o git realmente viu.
//
// ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// Auditoria de uma missão real (25/08/2026): os 5 handoffs declararam 20
// arquivos e o worktree tinha TRÊS mudanças que nenhum deles citou —
// `landing/package.json` e `bun.lock` (uma dependência NOVA, `playwright`) e
// 3,8 MB de PNG em `screenshots_v2/`. O revisor final escreveu "não há mais
// nada bloqueante encontrado nesta revisão" com tudo isso ao lado.
//
// A entrega (`recordDelivery`) já usa o diff do git como fonte primária, então
// o registro durável está certo. Quem estava lendo a versão auto-declarada era
// VOCÊ, na tela.
//
// A regra: o não-declarado não é acusação de má-fé — é o que ninguém contou.
// Instalar dependência e gerar artefato costumam ser efeito colateral honesto
// de fazer o trabalho. O defeito é o silêncio, não a mudança.

import { sobAPasta } from "@/lib/frotaDir"

/** Normaliza para comparar: o handoff às vezes escreve `./x`, o git escreve `x`. */
function normaliza(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/^\/+/, "")
}

export interface CruzamentoDeArquivos {
  /** Declarado no handoff E visto pelo git. */
  confirmados: string[]
  /** Declarado e que o git NÃO viu. Some quando a fase seguinte reverteu, ou
   *  quando o agente listou um arquivo que só leu. */
  semRastro: string[]
  /** Mudou no worktree e NINGUÉM declarou. É o achado que importa. */
  naoDeclarados: string[]
}

/**
 * Cruza a lista declarada com os caminhos do diff.
 *
 * `doDiff` vazio devolve tudo em `semRastro` e nada em `naoDeclarados` — e isso
 * é deliberado: sem repo, sem diff, e "não sei" nunca pode virar acusação. Quem
 * chama precisa distinguir "o git não respondeu" de "o git disse que não mudou".
 */
export function cruzarArquivos(
  declarados: readonly string[],
  doDiff: readonly string[],
): CruzamentoDeArquivos {
  const decl = new Set(declarados.map(normaliza))
  const git = new Set(doDiff.map(normaliza))
  return {
    confirmados: [...decl].filter((p) => git.has(p)).sort(),
    semRastro: [...decl].filter((p) => !git.has(p)).sort(),
    naoDeclarados: [...git].filter((p) => !decl.has(p)).sort(),
  }
}

/** Caminhos que o app IGNORA no cruzamento: são do próprio motor, não do
 *  trabalho. O handoff da fase vive aqui dentro e apareceria como "não
 *  declarado" em toda missão — ruído que ensinaria a ignorar o aviso. */
export function ehRuidoDoMotor(p: string): boolean {
  return sobAPasta(normaliza(p))
}
