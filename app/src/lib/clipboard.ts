import { toast } from "sonner"

/** Copia texto pra área de transferência + toast "copiado". Reusado por
 *  blocos de código, tabelas e blockquotes no render do chat. Silencioso se
 *  não houver texto; erra com toast discreto se o clipboard falhar. */
export async function copyText(
  text: string,
  label = "Copiado",
): Promise<boolean> {
  const s = text.trim()
  if (!s) return false
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
    return true
  } catch {
    toast.error("Não consegui copiar")
    return false
  }
}
