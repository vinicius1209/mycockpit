// O seletor de tamanho na barra do navegador (ADR-285): cinco aparelhos, o
// personalizado e girar. A troca é emulação de verdade no Chromium (viewport,
// escala, toque, user agent), feita pelo Rust; aqui só o pedido e o que ele
// confirmou.

import { useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, Laptop, Monitor, RotateCcwSquare, Smartphone, Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  PERSONALIZADO,
  PRESETS,
  doPreset,
  ehPadrao,
  ladoValido,
  medidas,
  nomeDoTamanho,
  type PresetDeTamanho,
  type TamanhoDaPagina,
} from "@/lib/tamanhoDaPagina"
import { cn } from "@/lib/utils"
import type { TamanhoNaTela } from "./useTamanhoDaPagina"

const ICONE: Record<PresetDeTamanho["tipo"], typeof Laptop> = {
  celular: Smartphone,
  tablet: Tablet,
  notebook: Laptop,
  desktop: Monitor,
}

function iconeDo(t: TamanhoDaPagina) {
  const p = PRESETS.find((x) => x.id === t.preset)
  return p ? ICONE[p.tipo] : Monitor
}

/** O menu do Radix busca por letra; nos campos, a tecla é do campo. */
const soDoCampo = (e: KeyboardEvent) => e.stopPropagation()

export function SeletorDeTamanho({ t }: { t: TamanhoNaTela }) {
  const { tamanho, trocando, trocar } = t
  const Icone = iconeDo(tamanho)
  const { largura, altura } = medidas(tamanho)
  const [larguraTexto, setLarguraTexto] = useState(String(largura))
  const [alturaTexto, setAlturaTexto] = useState(String(altura))
  const [comoCelular, setComoCelular] = useState(tamanho.celular)
  const lPers = ladoValido(larguraTexto)
  const aPers = ladoValido(alturaTexto)

  return (
    <>
      <DropdownMenu
        onOpenChange={(aberto) => {
          if (!aberto) return
          setLarguraTexto(String(largura))
          setAlturaTexto(String(altura))
          setComoCelular(tamanho.celular)
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={trocando}
            title={`Tamanho da página: ${nomeDoTamanho(tamanho)}, ${largura}×${altura}`}
            className={cn(
              controle("compacto"),
              "shrink-0 text-muted-foreground hover:bg-sel-hover hover:text-foreground data-[state=open]:bg-sel",
              !ehPadrao(tamanho) && "text-foreground",
            )}
          >
            <Icone className="size-3.5 shrink-0" />
            <span className="hidden @min-[720px]/navegador:inline">{nomeDoTamanho(tamanho)}</span>
            <span className="hidden font-mono text-[11px] text-faint @min-[720px]/navegador:inline">
              {largura}×{altura}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 border-border/40">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Tamanho da página</DropdownMenuLabel>
          {PRESETS.map((p) => {
            const I = ICONE[p.tipo]
            return (
              <DropdownMenuItem key={p.id} onSelect={() => trocar(doPreset(p.id, tamanho.girado))} className="text-[12px]">
                <Check className={cn(p.id === tamanho.preset ? "opacity-100" : "opacity-0")} />
                <I />
                {p.rotulo}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {p.largura}×{p.altura}
                </span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator className="bg-border/40" />
          <DropdownMenuCheckboxItem
            checked={tamanho.girado}
            onCheckedChange={(girado) => trocar({ ...tamanho, girado })}
            className="text-[12px]"
          >
            Girar
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator className="bg-border/40" />
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Personalizado</DropdownMenuLabel>
          <div className="flex items-center gap-1.5 px-2 pb-1.5 font-mono text-[12px] text-muted-foreground">
            <Input
              value={larguraTexto}
              onChange={(e) => setLarguraTexto(e.target.value)}
              onKeyDown={soDoCampo}
              inputMode="numeric"
              aria-label="Largura em pixels"
              aria-invalid={lPers == null}
              className="h-7 w-20 font-mono text-[12px]"
            />
            ×
            <Input
              value={alturaTexto}
              onChange={(e) => setAlturaTexto(e.target.value)}
              onKeyDown={soDoCampo}
              inputMode="numeric"
              aria-label="Altura em pixels"
              aria-invalid={aPers == null}
              className="h-7 w-20 font-mono text-[12px]"
            />
          </div>
          <label className="flex items-center gap-2 px-2 pb-1.5 text-[12px]">
            <Switch checked={comoCelular} onCheckedChange={setComoCelular} aria-label="Como celular" />
            Como celular: toque e identificação
          </label>
          <div className="px-2 pb-1.5">
            <Button
              type="button"
              size="compacto"
              variant="outline"
              className="w-full"
              disabled={lPers == null || aPers == null}
              title={lPers == null || aPers == null ? "Cada lado vai de 200 a 3840 pixels" : undefined}
              onClick={() => {
                if (lPers == null || aPers == null) return
                trocar({ preset: PERSONALIZADO, largura: lPers, altura: aPers, celular: comoCelular, girado: false })
              }}
            >
              Usar {lPers ?? "?"}×{aPers ?? "?"}
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {!ehPadrao(tamanho) && (
        <Button
          type="button"
          size="icone-compacto"
          variant="ghost"
          disabled={trocando}
          aria-pressed={tamanho.girado}
          aria-label="Girar a página"
          title="Girar a página"
          onClick={() => trocar({ ...tamanho, girado: !tamanho.girado })}
        >
          <RotateCcwSquare />
        </Button>
      )}
    </>
  )
}
