// Bolinhas de progresso: uma por passo/ato VISÍVEL. Compartilhado entre o
// tour narrativo (IntroTour) e o wizard funcional (OnboardingWizard) — mesma
// receita visual, contadores INDEPENDENTES (cada um sabe seu próprio total;
// ver a nota em OnboardingGate.tsx sobre por que não são um contador só).
import { cn } from "@/lib/utils"

/** Passo condicional que sumiu não deixa bolinha morta pra trás. */
export function StepDots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 rounded-full transition-all",
            // "Onde eu estou" é largura + peso, não tinta (§2).
            i === index ? "w-4 bg-foreground" : "w-1 bg-border",
          )}
        />
      ))}
    </div>
  )
}
