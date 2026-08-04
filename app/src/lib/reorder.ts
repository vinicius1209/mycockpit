// S1.2 (docs/sidebar-plan.md) — reordenação manual de projetos e conversas.
// Helpers PUROS: as stores aplicam o resultado e persistem a ordem (sort_order)
// via db.ts; o drag & drop e o context menu ("Mover para cima/baixo") só
// traduzem gesto → chamada. Ordem é do usuário — sem modos automáticos.

/** Move o item `dragId` para a posição do item `overId` (drop SOBRE ele),
 *  deslocando os demais. Devolve um array NOVO; se algum id não existe ou são
 *  o mesmo item, devolve a MESMA referência (no-op sem re-render). */
export function reorderByIds<T extends { id: string }>(
  list: T[],
  dragId: string,
  overId: string,
): T[] {
  if (dragId === overId) return list
  const from = list.findIndex((it) => it.id === dragId)
  const to = list.findIndex((it) => it.id === overId)
  if (from < 0 || to < 0) return list
  const next = [...list]
  const [dragged] = next.splice(from, 1)
  next.splice(to, 0, dragged)
  return next
}

/** Move o item `id` uma posição para cima (-1) ou para baixo (+1) — o caminho
 *  do teclado/context menu. Nas bordas (primeiro pra cima, último pra baixo) é
 *  no-op e devolve a MESMA referência. */
export function moveByDelta<T extends { id: string }>(
  list: T[],
  id: string,
  delta: -1 | 1,
): T[] {
  const from = list.findIndex((it) => it.id === id)
  if (from < 0) return list
  const to = from + delta
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
