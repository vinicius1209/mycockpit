// Carrega a config do projeto ativo de `.frota/config.toml` — a FONTE DE
// VERDADE do projeto — e sincroniza o cache de permissão que o `run_claude` lê
// antes de spawnar.
//
// Extraído do App.tsx (build 202) porque a catraca de tamanho disparou e a
// regra da casa é dividir o arquivo, nunca subir o teto nem editar a baseline.
// O bloco é uma unidade fechada de verdade: uma pergunta ("o que este projeto
// declara?"), um efeito, uma dependência.
//
// Precedência preservada, e ela importa: o `config.toml` VENCE o que o SQLite
// tinha em cache. O arquivo é versionado no git e editável à mão; o cache é
// derivado. Quando divergem, quem manda é o disco — e o cache é corrigido no
// mesmo passo (`setProjectPermission` + `updateProjectPermission`), senão o
// próximo spawn leria a permissão velha.

import { useEffect } from "react"
import { isTauri, updateProjectPermission } from "@/lib/db"
import { readProjectConfig } from "@/lib/configDoProjeto"
import { useApp } from "@/store/app"
import type { ProjectConfig } from "@/store/app"
import type { PermissionMode } from "@/lib/types"

export function useProjectConfig(activeProjectId: string | null) {
  useEffect(() => {
    if (!activeProjectId || !isTauri()) return
    const proj = useApp.getState().projects.find((p) => p.id === activeProjectId)
    if (!proj) return
    void readProjectConfig(proj.path)
      .then((raw) => {
        const resolved: ProjectConfig = {
          exists: raw.exists,
          pasta: raw.pasta,
          permission:
            (raw.permission as PermissionMode) ??
            proj.permissionMode ??
            "padrao",
          helper:
            raw.helper === "off"
              ? null
              : (raw.helper ?? useApp.getState().settings.helperModel),
          mode: raw.mode ?? "linear",
          extraDirs: raw.extra_dirs ?? [],
        }
        useApp.getState().setProjectConfig(proj.id, resolved)
        if (raw.exists && resolved.permission !== proj.permissionMode) {
          useApp.getState().setProjectPermission(proj.id, resolved.permission)
          void updateProjectPermission(proj.id, resolved.permission)
        }
      })
      // Sem config legível o app SEGUE com o padrão do projeto — ler config é
      // conveniência, não autoridade. O warn fica porque silêncio aqui esconde
      // TOML quebrado (ADR-017: nada de catch mudo).
      .catch((e) => console.warn("[mycockpit] falha ao ler config.toml:", e))
  }, [activeProjectId])
}
