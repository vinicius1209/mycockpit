// O botão de sincronia do cabeçalho da aba Alterações: só ícone e contagem
// (↑3, ↓2, ↓2 ↑3, a nuvem de publicar), com o nome do gesto no tooltip e no
// aria-label (docs/explorador-de-arquivos-prd.md, BD1). Ao lado, o menu com os
// gestos um a um e a idade da última busca.

import { ArrowDown, ArrowUp, ChevronDown, CloudCheck, CloudDownload, CloudUpload, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GitStatus } from "@/lib/git"
import { gestoDoBotao, gestoEmCurso, idadeDaBusca, type EstadoDoRepo } from "@/lib/gitSync"
import { useGitSync } from "@/store/gitSync"

export function BotaoDeSincronia({
  cwd,
  status,
  estado,
  now,
}: {
  cwd: string
  status: GitStatus
  estado: EstadoDoRepo | null
  now: number
}) {
  const emCurso = useGitSync((s) => s.emCurso[cwd])
  const executar = useGitSync((s) => s.executar)
  if (!estado) return null
  const botao = gestoDoBotao({ ...status, temRemoto: estado.temRemoto })
  if (!botao) return null
  const { ahead, behind } = status
  const idade = idadeDaBusca(estado.ultimaBusca, now)
  const gesto = botao.gesto ?? "buscar"
  const rotulo = emCurso
    ? gestoEmCurso(emCurso, ahead, behind)
    : botao.gesto
      ? botao.rotulo
      : `${botao.rotulo}. Buscar do remoto`
  const dica = emCurso || botao.gesto === "publicar" ? rotulo : `${rotulo} (última busca ${idade})`

  return (
    <span className="flex items-stretch">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="chip"
            aria-label={rotulo}
            disabled={!!emCurso}
            onClick={() => void executar(cwd, gesto)}
            className="rounded-r-none font-mono tabular-nums disabled:opacity-100"
          >
            {emCurso ? (
              <Loader2 className="animate-spin" />
            ) : botao.gesto === "publicar" ? (
              <CloudUpload />
            ) : botao.gesto === null ? (
              <CloudCheck />
            ) : null}
            {!emCurso && behind > 0 && status.upstream && (
              <span className="flex items-center">
                <ArrowDown className="size-3" />
                {behind}
              </span>
            )}
            {ahead > 0 && status.upstream && (
              <span className="flex items-center">
                {!emCurso && <ArrowUp className="size-3" />}
                {ahead}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {dica}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icone-chip"
            disabled={!!emCurso}
            aria-label="Mais gestos de sincronia"
            className="rounded-l-none border-l-0"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {status.upstream ? (
            <>
              <DropdownMenuItem disabled={ahead === 0 || behind > 0} onSelect={() => void executar(cwd, "enviar")}>
                <ArrowUp />
                {ahead > 0 ? `Enviar ${ahead} commit${ahead === 1 ? "" : "s"}` : "Enviar"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={behind === 0} onSelect={() => void executar(cwd, "trazer")}>
                <ArrowDown />
                Trazer (só avança)
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => void executar(cwd, "publicar")}>
              <CloudUpload />
              Publicar branch
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void executar(cwd, "buscar")}>
            <CloudDownload />
            Buscar do remoto
            <DropdownMenuShortcut>{idade}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
