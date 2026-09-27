// A aba Alterações relê o `git status` sozinha quando algo que ela mostra pode
// ter mudado (pedido de 23/09/2026: "parece congelada, só atualiza quando eu
// clico no refresh").
//
// Antes ela só relia ao montar e depois das ações feitas DENTRO dela. Nada
// avisava que o agente tinha editado um arquivo, que um turno tinha acabado ou
// que você tinha feito commit pelo terminal.
//
// Sem releitura por tempo de propósito: cada leitura roda ~6 comandos git
// (`status -uall`, dois `diff --numstat`, `rev-list`…), e repetir isso a cada
// poucos segundos pesa em repositório grande. Os sinais são os que o app já
// tem:
//  - turno de QUALQUER conversa desta pasta terminando (a de fundo também);
//  - ação que muda arquivo terminando no meio do turno (a mesma classificação
//    do fio, `presentTool(...).category === "change"`; nenhum nome de motor);
//  - a janela voltando ao foco (commit, branch ou edição feitos fora);
//  - um arquivo salvo pelo editor da Frota (`avisarGravacao`).
// Amortecido: uma rajada de edições vira UMA leitura.

import { useEffect, useRef } from "react"
import { assinarMudancasNaPasta } from "@/lib/sinaisDoDisco"

// A assinatura e os sinais moram em `lib/sinaisDoDisco.ts` desde que o editor
// de arquivos passou a usá-los; o reexport mantém quem importa daqui.
export { assinaturaDasMudancas } from "@/lib/sinaisDoDisco"

export function useAlteracoesVivas(cwd: string, reler: () => void): void {
  const relerRef = useRef(reler)
  relerRef.current = reler

  useEffect(() => assinarMudancasNaPasta(cwd, () => relerRef.current()), [cwd])
}
