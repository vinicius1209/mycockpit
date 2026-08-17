import { updateProjectPermission } from "@/lib/db"
import { writeMycockpitConfig } from "@/lib/mycockpit"
import { useApp, type ProjectConfig } from "@/store/app"
import type { PermissionMode, Project } from "@/lib/types"

/** Rótulo curto de cada modo (o segmented da linha de execução usa estes). */
export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  leitura: "Só lê",
  padrao: "Pede",
  liberado: "Liberado",
}

/** A PRECEDÊNCIA, escrita UMA vez: o `.mycockpit/config.toml` (aqui já em
 *  memória) vence o cache do SQLite, e sem os dois o modo é "padrao" — nunca
 *  fail-open pra "liberado".
 *
 *  Por que uma função em vez de um seletor compartilhado: as três superfícies
 *  que leem o modo assinam fatias DIFERENTES do store (o segmented do composer
 *  assina pelo projeto ATIVO, o clima ambiente pelo projeto da CONVERSA ativa, e
 *  o despacho lê `getState()` no instante do envio). O seletor não dá pra
 *  compartilhar; a REGRA dá — e é ela que não pode divergir, porque o Rust
 *  resolve o spawn pelo arquivo, não pelo cache. */
export function resolvePermission(
  cfgPermission: PermissionMode | undefined,
  cached: PermissionMode | undefined | null,
): PermissionMode {
  return cfgPermission ?? cached ?? "padrao"
}

/** Modo EFETIVO do projeto: o config em memória (.mycockpit) vence o cache do
 *  SQLite; sem os dois, "padrao". Mesma precedência que o ContextPanel já usava
 *  — extraída pra não divergir agora que dois lugares leem. */
export function effectivePermission(project: Project | null): PermissionMode {
  if (!project) return "padrao"
  return resolvePermission(
    useApp.getState().mycockpit[project.id]?.permission,
    project.permissionMode,
  )
}

/** Troca a permissão do PROJETO nas TRÊS camadas que têm de concordar:
 *  1. store em memória — é de lá que o envio lê `project.permissionMode`;
 *  2. SQLite — cache entre boots;
 *  3. `.mycockpit/config.toml` — a VERDADE, o Rust resolve no spawn.
 *
 *  Fonte única: o painel de contexto e a linha de execução do composer chamam
 *  aqui. Antes o trio vivia inline no ContextPanel; com dois chamadores, uma
 *  cópia que esquecesse o config.toml deixaria a UI mentindo sobre o que o
 *  próximo turno vai fazer.
 *
 *  Fire-and-forget nos writes (o store já refletiu): falha de disco não pode
 *  travar a UI, e o config.toml é reconciliado no boot (App.tsx). */
export function setProjectPermissionEverywhere(
  project: Project,
  mode: PermissionMode,
): void {
  const app = useApp.getState()
  app.setProjectPermission(project.id, mode)
  void updateProjectPermission(project.id, mode)

  // Spread do config EXISTENTE (não campo-a-campo com `??`): `helper: null`
  // significa "sugestões desligadas" e um `?? "haiku"` religaria em silêncio
  // cada vez que você trocasse a permissão. Defaults só quando não há config.
  const cur = app.mycockpit[project.id]
  const next: ProjectConfig = cur
    ? { ...cur, exists: true, permission: mode }
    : {
        exists: true,
        permission: mode,
        helper: "haiku",
        mode: "linear",
        extraDirs: [],
      }
  app.setMycockpit(project.id, next)
  void writeMycockpitConfig(project.path, { permission: mode })
}
