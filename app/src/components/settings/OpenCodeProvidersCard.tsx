import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardBody, CardHead, Consequencia, Selo } from "@/components/settings/parts"
import { fetchModelList, type ModelListEntry } from "@/lib/modelList"
import {
  listOpenCodeCredentials,
  loginOpenCodeApiKey,
  loginOpenCodeOAuth,
  logoutOpenCode,
  type OpenCodeCredential,
} from "@/lib/openCodeAuth"
import { useApp } from "@/store/app"

type Preset = { provider: string; kind: "api" | "oauth"; method?: string; detail: string }
const PRESETS: Preset[] = [
  { provider: "Nvidia", kind: "api", detail: "NIM, incluindo Kimi K3" },
  { provider: "OpenRouter", kind: "api", detail: "Catálogo unificado por chave" },
  {
    provider: "Google",
    kind: "oauth",
    method: "OAuth with Google (Antigravity)",
    detail: "Login no navegador, sem copiar chave",
  },
]

function modelCounts(models: ModelListEntry[]) {
  const out: Record<string, number> = {}
  for (const model of models) {
    const provider = model.id.split("/", 1)[0]
    if (provider) out[provider] = (out[provider] ?? 0) + 1
  }
  return out
}

export function OpenCodeProvidersCard({ refreshToken, onChanged }: {
  refreshToken: number
  onChanged: () => Promise<void>
}) {
  const probe = useApp((s) => s.settings.detected.opencode)
  const [credentials, setCredentials] = useState<OpenCodeCredential[]>([])
  const [models, setModels] = useState<ModelListEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [customProvider, setCustomProvider] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [working, setWorking] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!probe?.installed) return
    setLoading(true)
    try {
      const [creds, listing] = await Promise.all([
        listOpenCodeCredentials(),
        fetchModelList("opencode").catch(() => null),
      ])
      setCredentials(creds)
      if (listing) setModels(listing.models)
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Não consegui ler os provedores do OpenCode")
    } finally {
      setLoading(false)
    }
  }, [probe?.installed])

  useEffect(() => { void load() }, [load, refreshToken])
  const counts = useMemo(() => modelCounts(models), [models])
  const total = models.length

  function closeDialog(open: boolean) {
    setDialog(open)
    if (!open) {
      setPreset(null)
      setCustomProvider("")
      setApiKey("")
    }
  }

  async function connect(selected: Preset) {
    const provider = selected.provider === "Outro" ? customProvider.trim() : selected.provider
    if (!provider) return
    setWorking(provider)
    try {
      if (selected.kind === "oauth") {
        await loginOpenCodeOAuth(provider, selected.method ?? "")
      } else {
        await loginOpenCodeApiKey(provider, apiKey)
      }
      setApiKey("")
      closeDialog(false)
      await onChanged()
      await load()
      toast.success(`${provider} conectado e modelos atualizados`)
    } catch (e) {
      toast.error(typeof e === "string" ? e : `Não consegui conectar ${provider}`)
    } finally {
      setWorking(null)
    }
  }

  async function remove(provider: string) {
    setWorking(provider)
    try {
      await logoutOpenCode(provider)
      setConfirmRemove(null)
      await onChanged()
      await load()
      toast.success(`${provider} removido`)
    } catch (e) {
      toast.error(typeof e === "string" ? e : `Não consegui remover ${provider}`)
    } finally {
      setWorking(null)
    }
  }

  const selo = !probe ? <Selo>não verificado</Selo>
    : !probe.installed ? <Selo>não instalado</Selo>
      : credentials.length ? <Selo tom="ok">conectado</Selo>
        : <Selo tom="atencao">sem provedor</Selo>

  return <>
    <Card>
      <CardHead nome="OpenCode" meta={probe?.installed ? `opencode v${probe.version ?? "?"}` : undefined} selo={selo} />
      <CardBody>
        {!probe?.installed ? (
          <p className="text-[12px] leading-snug text-muted-foreground">
            Instale o OpenCode em <strong className="font-medium text-foreground">Agentes na máquina</strong>. Depois os provedores serão conectados aqui, sem terminal.
          </p>
        ) : <>
          <div className="mb-3 flex items-center gap-2 rounded-md border bg-secondary/25 px-3 py-2 text-[12px]">
            <span className="font-medium">OpenCode</span><ArrowRight className="size-3 text-muted-foreground" />
            <span>{credentials.length} provedore{credentials.length === 1 ? "r" : "s"}</span>
            <ArrowRight className="size-3 text-muted-foreground" />
            <span>{total} modelos de agente</span>
            {loading && <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />}
          </div>

          {credentials.length === 0 ? (
            <p className="text-[12px] leading-snug text-muted-foreground">
              Conecte uma conta ou chave. O app entrega o segredo ao fluxo oficial do OpenCode e nunca o grava no projeto.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {credentials.map((credential) => (
                <li key={credential.provider} className="group flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 hover:border-border hover:bg-accent/35">
                  <KeyRound className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-[13px]">{credential.provider}</span>
                  <span className="text-[11px] uppercase text-muted-foreground">{credential.authKind}</span>
                  <span className="ml-auto text-[12px] text-muted-foreground">{counts[credential.providerId] ?? 0} modelos</span>
                  {confirmRemove === credential.provider ? <>
                    <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setConfirmRemove(null)}>manter</button>
                    <button className="text-[11px] font-medium text-destructive" disabled={working !== null} onClick={() => void remove(credential.provider)}>confirmar</button>
                  </> : (
                    <button aria-label={`Remover ${credential.provider}`} title="Remover provedor" className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setConfirmRemove(credential.provider)}>
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button type="button" onClick={() => setDialog(true)} className="mt-3 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="size-3.5" /> Adicionar provedor
          </button>
          <Consequencia>
            As credenciais ficam sob responsabilidade do OpenCode. O app só lista o estado e atualiza automaticamente os modelos compatíveis com ferramentas.
          </Consequencia>
        </>}
      </CardBody>
    </Card>

    <AppDialog open={dialog} onOpenChange={closeDialog} title="Conectar provedor" description="Escolha um atalho ou informe outro provedor suportado pelo OpenCode." size="md">
      {!preset ? (
        <div className="grid gap-2">
          {PRESETS.map((item) => (
            <Button key={item.provider} type="button" variant="outline" onClick={() => setPreset(item)} className="h-auto justify-start gap-3 p-3 text-left font-normal">
              <KeyRound className="size-4 text-muted-foreground" />
              <span><span className="block text-[13px] font-medium">{item.provider}</span><span className="block text-[12px] text-muted-foreground">{item.detail}</span></span>
              <ArrowRight className="ml-auto size-4 text-muted-foreground" />
            </Button>
          ))}
          <Button type="button" variant="outline" onClick={() => setPreset({ provider: "Outro", kind: "api", detail: "" })} className="h-auto justify-start p-3 text-left text-[13px] font-normal">Outro provedor por chave de API</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {preset.provider === "Outro" && <label className="grid gap-1.5 text-[12px] font-medium">Nome do provedor<Input value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} placeholder="Nome reconhecido pelo OpenCode" autoFocus /></label>}
          {preset.kind === "api" ? <label className="grid gap-1.5 text-[12px] font-medium">Chave de API<Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Cole a chave; ela não será exibida novamente" autoComplete="off" autoFocus={preset.provider !== "Outro"} /></label> : (
            <p className="text-[12px] leading-relaxed text-muted-foreground">O navegador será aberto pelo login oficial do OpenCode. Ao concluir, volte para o app.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreset(null)} disabled={working !== null}>Voltar</Button>
            <Button onClick={() => void connect(preset)} disabled={working !== null || (preset.kind === "api" && (!apiKey.trim() || (preset.provider === "Outro" && !customProvider.trim())))}>
              {working && <Loader2 className="size-4 animate-spin" />}{preset.kind === "oauth" ? "Abrir login" : "Conectar"}
            </Button>
          </div>
        </div>
      )}
    </AppDialog>
  </>
}
