// Segredos do projeto (ADR-288): nome e valor, o valor direto no Keychain. A
// tela nunca recebe o valor de volta: depois de salvo, só o nome e quando foi
// usado. O projeto é o do seletor único do rail (ADR-268).

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BlockTitle, Card, Note, Row, SectionHeader } from "@/components/settings/parts"
import { EscopoDoProjeto, useProjetoDasConfiguracoes } from "@/components/settings/projetoDasConfiguracoes"
import { sectionDef } from "@/components/settings/sections"
import { avisar } from "@/lib/avisos"
import { fmtAgo } from "@/lib/format"
import { apagarSegredo, nomeDeSegredo, salvarSegredo, segredosDoProjeto, type Segredo } from "@/lib/segredos"

export function SegredosDoProjeto() {
  const { project } = useProjetoDasConfiguracoes()
  const path = project?.path ?? null
  const [lista, setLista] = useState<Segredo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [nome, setNome] = useState("")
  const [valor, setValor] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [aberto, setAberto] = useState(false)

  const carregar = useCallback(() => {
    if (!path) return setLista([])
    segredosDoProjeto(path).then(
      (l) => {
        setLista(l)
        setErro(null)
      },
      (e: unknown) => setErro(String(e)),
    )
  }, [path])
  useEffect(carregar, [carregar])

  const problemaDoNome = nome ? nomeDeSegredo(nome) : null
  const salvar = () => {
    if (!path || problemaDoNome || !nome || !valor) return
    setSalvando(true)
    salvarSegredo(path, nome, valor)
      .then((l) => {
        setLista(l)
        setNome("")
        setValor("")
        setAberto(false)
        avisar.feito(`${nome} guardado no Keychain`)
      })
      .catch((e: unknown) => avisar.erro(String(e)))
      .finally(() => setSalvando(false))
  }

  return (
    <div>
      <SectionHeader
        title={sectionDef("secrets").title}
        description={sectionDef("secrets").question}
        escopo={project ? <EscopoDoProjeto nome={project.name} /> : null}
      />
      {!project ? (
        <Note>Abra um projeto para guardar os segredos dele.</Note>
      ) : (
        <>
          <BlockTitle hint="O valor fica no Keychain e entra no turno como variável de ambiente, em todos os motores. O agente vê só o nome; se o valor aparecer numa saída, a Frota mascara.">
            Guardados
          </BlockTitle>
          {erro && <p className="mb-2 text-[12px] text-st-error">{erro}</p>}
          <ul className="flex flex-col gap-1.5">
            {lista.map((s) => (
              <Row
                key={s.nome}
                glifo={<KeyRound className="size-3.5 text-muted-foreground" />}
                titulo={<span className="font-mono text-[12px]">{s.nome}</span>}
                dica={s.usadoEm ? `usado ${fmtAgo(s.usadoEm)}` : "ainda não usado"}
                direita={
                  <Button
                    type="button"
                    size="icone-compacto"
                    variant="ghost"
                    aria-label={`Apagar ${s.nome}`}
                    title={`Apagar ${s.nome} do Keychain`}
                    onClick={() => {
                      apagarSegredo(project.path, s.nome).then(setLista, (e: unknown) => avisar.erro(String(e)))
                    }}
                  >
                    <Trash2 />
                  </Button>
                }
              />
            ))}
          </ul>
          {lista.length === 0 && !aberto && <Note>Nenhum segredo guardado neste projeto.</Note>}
          {aberto ? (
            <Card className="mt-2">
            <form
              className="flex flex-col gap-2 p-3"
              onSubmit={(e) => {
                e.preventDefault()
                salvar()
              }}
            >
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                  placeholder="STRIPE_SECRET_KEY"
                  aria-label="Nome da variável"
                  aria-invalid={!!problemaDoNome}
                  className="h-8 w-56 font-mono text-[12px]"
                />
                <Input
                  type="password"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="valor"
                  aria-label="Valor"
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 font-mono text-[12px]"
                />
              </div>
              {problemaDoNome && <p className="text-[12px] text-muted-foreground">{problemaDoNome}</p>}
              <p className="text-[12px] text-muted-foreground">
                Depois de salvo o valor não volta a aparecer. Para trocar, salve de novo com o mesmo nome.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" size="compacto" variant="ghost" onClick={() => setAberto(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="compacto" disabled={salvando || !nome || !valor || !!problemaDoNome}>
                  Salvar no Keychain
                </Button>
              </div>
            </form>
            </Card>
          ) : (
            <Button type="button" size="compacto" variant="outline" className="mt-2" onClick={() => setAberto(true)}>
              <Plus />
              Adicionar segredo
            </Button>
          )}
        </>
      )}
    </div>
  )
}
