// Porta de entrada do onboarding. Duas fases locais, SEM persistência
// própria: tour narrativo primeiro, wizard funcional depois. O estado é
// local de propósito — o mount inteiro já reseta sozinho toda vez que
// `onboarded` volta a false (App.tsx: `{!onboarded && <OnboardingGate />}`,
// mount/unmount limpo), então um segundo registro em disco aqui seria a
// MESMA fonte de verdade duplicada duas vezes. "Refazer onboarding"
// (Configurações ▸ Sobre) mostra o tour de novo também — não existe no
// sistema o conceito de "já viu uma vez, não repete" (persistence.ts já
// reseta pro passo 0 sempre), e o tour não inventa um.
import { useState } from "react"
import { IntroTour } from "./IntroTour"
import { OnboardingWizard } from "./OnboardingWizard"

export function OnboardingGate() {
  const [phase, setPhase] = useState<"tour" | "wizard">("tour")
  if (phase === "tour") {
    return <IntroTour onDone={() => setPhase("wizard")} />
  }
  return <OnboardingWizard />
}
