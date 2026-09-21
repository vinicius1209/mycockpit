// A CHAVE do estado persistido do app no `localStorage`.
//
// Mudou de `mc.app` para `frota.app` (ADR-222), e aqui há dado do usuário em
// disco: tema, preferências e o que mais o `partialize` de `store/app.ts`
// guarda. Trocar a chave sem migrar não perde o dado, mas faz o app "esquecer"
// as preferências, o que para quem usa é a mesma coisa.
//
// **A migração roda no import, de propósito.** O `persist` do zustand hidrata
// quando `store/app.ts` é criado, e criação de store acontece na avaliação do
// módulo, antes do corpo de quem importa. Se a cópia esperasse o `main.tsx`
// rodar, o store já teria hidratado vazio. Como `store/app.ts` importa ESTE
// módulo, ele avalia antes: é a única ordem que funciona.

/** A chave de hoje. */
export const CHAVE_APP = "frota.app"

/** A chave legada, migrada uma vez e depois lida só como reserva. */
export const CHAVE_APP_LEGADA = "mc.app"

/**
 * Copia o estado da chave legada para a nova, uma vez, se a nova não existe.
 *
 * Copia e NÃO move: a chave antiga fica onde está. Se algo der errado no
 * primeiro boot depois do rename, voltar para a versão anterior do app ainda
 * encontra as preferências no lugar de sempre.
 */
export function migrarChaveDoApp(store: Pick<Storage, "getItem" | "setItem">): void {
  try {
    if (store.getItem(CHAVE_APP) != null) return
    const legado = store.getItem(CHAVE_APP_LEGADA)
    if (legado == null) return
    store.setItem(CHAVE_APP, legado)
  } catch {
    // `localStorage` indisponível (SSR de teste, modo privado) não é erro aqui:
    // sem storage não há o que migrar, e o app nasce com o default.
  }
}

/**
 * O estado persistido cru, já com a migração aplicada. Usado pelos três entries
 * ANTES do React, para o tema não piscar no boot.
 */
export function lerEstadoPersistido(): unknown {
  try {
    migrarChaveDoApp(localStorage)
    return JSON.parse(
      localStorage.getItem(CHAVE_APP) ?? localStorage.getItem(CHAVE_APP_LEGADA) ?? "null",
    )
  } catch {
    return null
  }
}

if (typeof localStorage !== "undefined") migrarChaveDoApp(localStorage)
