// I/O dos probes do guia de setup. Cada item é marcado por LEITURA do estado
// real (config no disco, dispositivo pareado, CLI no PATH), nunca por "o
// usuário passou por essa tela".
//
// Todo probe tem TETO de tempo: leitura travada (config gigante, HOME numa
// unidade de rede, RPC pendurado) devolve "não sei" e mantém o guia visível,
// em vez de deixar a sidebar esperando pra sempre. O número é o do Orca.

import { invoke } from "@tauri-apps/api/core"
import { hooksAgents, usageWindowAgents } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"
import { isTauri } from "@/lib/db"
import type { GuideCapabilities, ProbeMap, ProbeResult } from "./setupItems"

export const PROBE_TIMEOUT_MS = 15_000

/** Resolve com `null` quando a promessa não voltou a tempo ou falhou. O timer
 *  é limpo no caminho feliz pra não segurar o processo em teste. */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/** Quais itens esta máquina sequer oferece. Decisão por REGISTRY (capability)
 *  cruzada com o probe de instalação, nunca por nome de agent. */
export function capabilitiesOf(p: {
  detected: Record<string, AgentProbe>
  usageMeterEnabled: boolean
  companionEnabled: boolean
}): GuideCapabilities {
  if (!isTauri()) return { meter: false, hooks: false, companion: false }
  const installed = (id: string) => p.detected[id]?.installed === true
  return {
    // desligado nas Configurações = gesto do usuário, e gesto do usuário não
    // vira cobrança na sidebar.
    meter: p.usageMeterEnabled && usageWindowAgents().some((d) => installed(d.id)),
    hooks: hooksAgents().some((d) => installed(d.id)),
    companion: p.companionEnabled,
  }
}

/** Alguma CLI integrada foi ENCONTRADA na máquina? Sem nenhum snapshot de
 *  detecção a resposta honesta é "não sei" (o app nunca olhou). */
export function agentProbe(detected: Record<string, AgentProbe>): ProbeResult {
  if (Object.keys(detected).length === 0) return null
  return Object.values(detected).some((p) => p.installed)
}

async function meterProbe(
  detected: Record<string, AgentProbe>,
): Promise<ProbeResult> {
  const defs = usageWindowAgents().filter((d) => detected[d.id]?.installed)
  if (defs.length === 0) return false
  // fonte "rpc" é leitura local: não há nada a instalar, a capacidade já está
  // de pé. Só a "statusline" precisa do script no config do usuário.
  if (defs.some((d) => d.usageWindow === "rpc")) return true
  const results = await Promise.all(
    defs.map((d) =>
      withTimeout(
        invoke<{ installed: boolean }>("usage_statusline_status", {
          agent: d.id,
        }),
        PROBE_TIMEOUT_MS,
      ),
    ),
  )
  if (results.every((r) => r === null)) return null
  return results.some((r) => r?.installed === true)
}

async function hooksProbe(
  detected: Record<string, AgentProbe>,
): Promise<ProbeResult> {
  const defs = hooksAgents().filter((d) => detected[d.id]?.installed)
  if (defs.length === 0) return false
  const results = await Promise.all(
    defs.map((d) =>
      withTimeout(
        invoke<{ installed: boolean }>("hooks_status", { agent: d.id }),
        PROBE_TIMEOUT_MS,
      ),
    ),
  )
  if (results.every((r) => r === null)) return null
  return results.some((r) => r?.installed === true)
}

async function companionProbe(): Promise<ProbeResult> {
  const info = await withTimeout(
    invoke<{ devices: unknown[] }>("companion_list_devices"),
    PROBE_TIMEOUT_MS,
  )
  if (info === null) return null
  return Array.isArray(info.devices) && info.devices.length > 0
}

/** Roda os probes que ESTA máquina precisa, em paralelo. Item cuja capacidade
 *  não existe aqui nem é perguntado (ele não vai aparecer na lista). */
export async function runProbes(p: {
  caps: GuideCapabilities
  detected: Record<string, AgentProbe>
  hasProject: boolean
}): Promise<ProbeMap> {
  const out: ProbeMap = {
    agent: agentProbe(p.detected),
    project: p.hasProject,
  }
  const jobs: Promise<void>[] = []
  if (p.caps.meter)
    jobs.push(
      meterProbe(p.detected).then((r) => {
        out.meter = r
      }),
    )
  if (p.caps.hooks)
    jobs.push(
      hooksProbe(p.detected).then((r) => {
        out.hooks = r
      }),
    )
  if (p.caps.companion)
    jobs.push(
      companionProbe().then((r) => {
        out.companion = r
      }),
    )
  await Promise.all(jobs)
  return out
}
