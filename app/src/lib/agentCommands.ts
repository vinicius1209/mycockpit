// Espelho TS da capability `command_inventory` do registry Rust
// (app/src-tauri/src/adapters.rs, ADR-189): por qual canal cada motor publica
// o próprio inventário de comandos e skills. O Rust usa isso para compor o
// "/"; aqui serve para o popover dizer DE ONDE veio o que ele mostra, sem
// comparar nome de motor em componente. Teste-gêmeo: agents.commands.test.ts.

export type CommandInventoryChannel = "run-init" | "side-query" | "none"

const CHANNEL_BY_AGENT: Readonly<Record<string, CommandInventoryChannel>> = {
  // claude 2.1.270: o `system/init` de todo run traz slash_commands/skills/plugins.
  "claude-code": "run-init",
  // codex 0.154.0: `skills/list` no app-server, sem turno de modelo.
  codex: "side-query",
  // agy 1.2.2: o `init` só traz cwd, permission_mode e tools.
  agy: "none",
  opencode: "none",
}

/** Motor desconhecido não ganha canal presumido. */
export function commandInventoryChannel(agent: string): CommandInventoryChannel {
  return CHANNEL_BY_AGENT[agent] ?? "none"
}

function horario(at: number, now: number): string {
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const hoje = new Date(now)
  const mesmoDia =
    d.getFullYear() === hoje.getFullYear() &&
    d.getMonth() === hoje.getMonth() &&
    d.getDate() === hoje.getDate()
  if (mesmoDia) return `às ${hm}`
  const dm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
  return `em ${dm} às ${hm}`
}

/** Rodapé do popover: de onde veio o inventário. Sem travessão (regra da casa). */
export function inventoryFootnote(input: {
  agentLabel: string
  channel: CommandInventoryChannel
  origin: "motor" | "disco"
  observedAt: number | null
  now: number
}): string {
  const { agentLabel, channel, origin, observedAt, now } = input
  if (channel === "none") {
    return `O ${agentLabel} não publica inventário de comandos. Aparecem os da Frota e do projeto.`
  }
  if (origin === "motor" && observedAt != null) {
    return channel === "run-init"
      ? `Inventário anunciado pelo ${agentLabel} no último turno deste projeto, ${horario(observedAt, now)}.`
      : `Skills consultadas ao ${agentLabel} ${horario(observedAt, now)}.`
  }
  return channel === "run-init"
    ? `Lido das pastas. O ${agentLabel} anuncia o inventário completo no primeiro turno deste projeto.`
    : `Lido das pastas. O ${agentLabel} não respondeu à consulta de skills.`
}
