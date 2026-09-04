import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type {
  ConversationMapPin,
  ConversationMapPinsV1,
  SemanticConversationMapV1,
} from "@/lib/conversationMap"

function pin(text: string, at: number): ConversationMapPin {
  return { id: crypto.randomUUID(), text: text.trim(), pinnedAt: at }
}

function FieldToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  )
}

export function ConversationMapEditorDialog({
  open,
  pins,
  semantic,
  onClose,
  onSave,
}: {
  open: boolean
  pins: ConversationMapPinsV1
  semantic: SemanticConversationMapV1 | null
  onClose: () => void
  onSave: (pins: ConversationMapPinsV1) => Promise<"saved" | "conflict">
}) {
  const [focusPinned, setFocusPinned] = useState(false)
  const [goalPinned, setGoalPinned] = useState(false)
  const [focus, setFocus] = useState("")
  const [goal, setGoal] = useState("")
  const [constraints, setConstraints] = useState("")
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    const opening = !wasOpen.current
    wasOpen.current = true
    setFocusPinned(!!pins.currentFocus)
    setGoalPinned(!!pins.explicitGoal)
    setFocus(pins.currentFocus?.text ?? semantic?.currentFocus?.text ?? "")
    setGoal(pins.explicitGoal?.text ?? semantic?.explicitGoal?.text ?? "")
    setConstraints(pins.constraints.map((item) => item.text).join("\n"))
    if (opening) setConflict(false)
  }, [open, pins, semantic])

  async function save() {
    const now = Date.now()
    const constraintPins = constraints
      .split("\n")
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((text) => pin(text, now))
    const next: ConversationMapPinsV1 = {
      schemaVersion: 1,
      revision: pins.revision + 1,
      ...(focusPinned && focus.trim() ? { currentFocus: pin(focus, now) } : {}),
      ...(goalPinned && goal.trim() ? { explicitGoal: pin(goal, now) } : {}),
      constraints: constraintPins,
    }
    setSaving(true)
    const result = await onSave(next)
    setSaving(false)
    if (result === "saved") onClose()
    else setConflict(true)
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-[14px]">Ajustar leitura</DialogTitle>
          <DialogDescription className="text-[12px]">
            O que você fixar vence a leitura automática e não altera o fio.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-2">
            <FieldToggle
              label="Fixar rumo atual"
              checked={focusPinned}
              onCheckedChange={setFocusPinned}
            />
            <Input
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              disabled={!focusPinned}
              maxLength={180}
              aria-label="Rumo atual fixado"
              placeholder="Onde esta conversa está agora"
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldToggle
              label="Fixar objetivo declarado"
              checked={goalPinned}
              onCheckedChange={setGoalPinned}
            />
            <Input
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              disabled={!goalPinned}
              maxLength={180}
              aria-label="Objetivo declarado fixado"
              placeholder="Somente se você declarou um objetivo"
            />
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] text-muted-foreground">
              Restrições fixadas, uma por linha
            </span>
            <Textarea
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              rows={4}
              className="resize-none text-[13px]"
              placeholder="Ex.: não alterar a API pública"
            />
          </label>
          {conflict && (
            <p role="alert" className="text-[12px] text-st-warning">
              A leitura mudou em outra janela. Os valores mais recentes foram carregados; revise antes de salvar.
            </p>
          )}
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="ghost" size="padrao" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" size="padrao" disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando…" : "Salvar ajustes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
