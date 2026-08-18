import { FormEvent, ReactNode, useMemo, useState } from "react"
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
} from "motion/react"
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Command,
  FileCode2,
  GitBranch,
  HardDrive,
  Inbox,
  Menu,
  MessageSquareText,
  Radio,
  Route,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react"

type FadeProps = {
  children: ReactNode
  className?: string
  delay?: number
}

type ScreenshotKey = "workspace" | "retrospectiva"
type SpecialistId = "aline" | "nina" | "caio"

const profiles = ["Solo builder", "Founder técnico", "Time de produto", "Agência / consultoria"]

const features = [
  {
    icon: Route,
    eyebrow: "Continuidade",
    title: "O contexto pertence ao projeto.",
    body: "Troque de agente no meio do caminho. Decisões, histórico e instruções continuam no mesmo fio — sem reconstruir o briefing.",
    accent: "cyan",
  },
  {
    icon: Radio,
    eyebrow: "Controle",
    title: "Autonomia sem perder o rádio.",
    body: "Planos vivos, perguntas e incidentes aparecem no momento certo. Você intervém quando há uma decisão, não para vigiar cada comando.",
    accent: "amber",
  },
  {
    icon: CircleDollarSign,
    eyebrow: "Retrospectiva",
    title: "Custo medido por entrega.",
    body: "Veja onde o orçamento queimou, compare agentes e conecte o gasto ao que realmente chegou ao fim — não só a tokens e turnos.",
    accent: "coral",
  },
]

const specialists: Array<{
  id: SpecialistId
  initials: string
  name: string
  role: string
  accent: "cyan" | "amber" | "coral"
  question: string
  verdict: string
  checks: string[]
}> = [
  {
    id: "aline",
    initials: "AS",
    name: "Aline",
    role: "Segurança",
    accent: "coral",
    question: "revise os riscos do checkout antes da entrega",
    verdict: "Eu bloquearia a entrega até o retorno do pagamento validar assinatura, idempotência e origem do evento.",
    checks: ["Webhook autenticado", "Idempotência ausente", "Rollback documentado"],
  },
  {
    id: "nina",
    initials: "NP",
    name: "Nina",
    role: "Produto",
    accent: "amber",
    question: "avalie se o checkout está claro para uma primeira compra",
    verdict: "A estrutura está correta, mas o resumo precisa antecipar prazo e política de cancelamento antes do botão final.",
    checks: ["Promessa visível", "Objeção de prazo", "Próxima ação clara"],
  },
  {
    id: "caio",
    initials: "CQ",
    name: "Caio",
    role: "Qualidade",
    accent: "cyan",
    question: "monte a régua mínima de aceite para esta mudança",
    verdict: "Cubra retomada após falha, duplo clique no pagamento e abandono com carrinho preservado.",
    checks: ["Caminho feliz", "Falha recuperável", "Estado preservado"],
  },
]

const modes = [
  {
    code: "LINEAR",
    title: "Um fio, o agente certo em cada etapa.",
    body: "Converse, revise e reveze entre provedores sem abrir mão da memória do trabalho.",
    detail: "Revezamento transacional",
  },
  {
    code: "FUSION",
    title: "Coloque abordagens em disputa.",
    body: "Dois ou mais agentes resolvem o mesmo problema; um juiz compara as saídas e promove a melhor.",
    detail: "Disputa com julgamento",
  },
  {
    code: "SDD",
    title: "Da intenção à entrega verificada.",
    body: "PRD, especificação, implementação e gates caminham em uma missão com começo, critérios e fim.",
    detail: "Pipeline spec-driven",
  },
]

function HorizonMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`horizon-mark${compact ? " horizon-mark--compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 44 44" role="img">
        <circle cx="22" cy="22" r="20" />
        <path d="M6.5 24.5 18 22l4 1 4-1 11.5 2.5" />
        <path d="M22 16v10" />
        <path d="M13 29h18" />
      </svg>
    </span>
  )
}

function Fade({ children, className = "", delay = 0 }: FadeProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function FlightRecorder() {
  return (
    <motion.div
      className="recorder"
      initial={{ opacity: 0, scale: 0.97, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="recorder__topbar">
        <div>
          <span className="live-dot" />
          <span>MISSÃO EM CURSO</span>
        </div>
        <span>ATLAS-COMMERCE · DEMO</span>
      </div>

      <div className="mission-live__head">
        <div>
          <span>Entrega</span>
          <strong>Blindar a retomada do checkout</strong>
        </div>
        <span className="mission-live__agent"><i />Codex executando</span>
      </div>

      <div className="mission-live">
        <section className="live-plan" aria-label="Plano vivo da missão demonstrativa">
          <div className="live-plan__top"><span>PLANO VIVO</span><b>2 / 4</b></div>
          <div className="live-plan__item is-done">
            <span><Check /></span><div><b>Mapear falhas de retomada</b><small>6 cenários encontrados</small></div>
          </div>
          <div className="live-plan__item is-active">
            <span><Radio /></span><div><b>Implementar idempotência</b><small>editando a recuperação do pagamento</small></div>
          </div>
          <motion.div
            className="live-plan__progress"
            initial={{ scaleX: 0.12 }}
            animate={{ scaleX: 0.68 }}
            transition={{ duration: 2.4, delay: 0.6, ease: "easeInOut" }}
          />
          <div className="live-plan__item">
            <span>03</span><div><b>Cobrir regressões</b><small>aguardando implementação</small></div>
          </div>
          <div className="live-plan__item">
            <span>04</span><div><b>Revisão de segurança</b><small>@aline após os testes</small></div>
          </div>
        </section>

        <section className="live-activity" aria-label="Atividade atual da missão demonstrativa">
          <div className="live-activity__top"><span>AGORA</span><time>10:24:18</time></div>
          <div className="activity-card activity-card--file">
            <FileCode2 />
            <div><small>ARQUIVO ALTERADO</small><b>src/checkout/recovery.ts</b></div>
            <span>+38 −12</span>
          </div>
          <div className="code-slice" aria-hidden="true">
            <span><i>+</i> const attempt = await claimPayment(id)</span>
            <span><i>+</i> if (attempt.replayed) return attempt.result</span>
            <span><i> </i> return resumeCheckout(attempt)</span>
          </div>
          <div className="activity-card activity-card--process">
            <Terminal />
            <div><small>PROCESSO</small><b>bun test checkout</b></div>
            <span className="activity-ok">12 passaram</span>
          </div>
        </section>
      </div>

      <div className="mission-live__foot">
        <span><ShieldCheck />Liberação controlada</span>
        <span>FRT–0217 · DADOS FICTÍCIOS</span>
      </div>
    </motion.div>
  )
}

function DemoProductScreen({ active }: { active: ScreenshotKey }) {
  const projects = ["atlas-commerce", "lumen-mobile", "northstar-docs"]

  return (
    <div className="demo-product" aria-label="Demonstração da Frota com dados fictícios">
      <aside className="demo-sidebar">
        <div className="demo-sidebar__brand"><HorizonMark compact /><b>Frota</b></div>
        <span>GERAL</span>
        <p><Clock3 /> Agendado</p>
        <p><Route /> Planos de voo</p>
        <span>PROJETOS</span>
        {projects.map((project, index) => (
          <p className={index === 0 ? "is-active" : ""} key={project}>
            <span className="demo-folder" /> {project}
          </p>
        ))}
        <div className="demo-sidebar__user"><i>MV</i><span>Marina Vale<small>DEMO LOCAL</small></span></div>
      </aside>

      <div className="demo-cockpit">
        <div className="demo-cockpit__topbar">
          <div className="demo-mode"><span>Painel</span><b>{active === "workspace" ? "Trabalho" : "Retrospectiva"}</b><span>Features</span></div>
          <span className="demo-status"><i /> Codex · 68%</span>
        </div>

        {active === "workspace" ? (
          <div className="demo-workspace">
            <div className="demo-greeting">
              <HorizonMark />
              <h4>Boa tarde, Marina.</h4>
              <p>Descreva uma tarefa para seu time de agentes.</p>
            </div>
            <div className="demo-composer">
              <div className="demo-composer__meta">
                <span>EXECUÇÃO</span><b>Liberação controlada</b><span>Codex</span><span>Sol · xhigh</span>
              </div>
              <p>Revise o fluxo de checkout da Atlas e implemente os estados vazios aprovados no briefing.</p>
              <div><span>/ comandos</span><button type="button" aria-label="Enviar demonstração"><ArrowRight /></button></div>
            </div>
            <span className="demo-disclosure"><ShieldCheck /> AMBIENTE DEMONSTRATIVO · DADOS FICTÍCIOS</span>
          </div>
        ) : (
          <div className="demo-retro">
            <div className="demo-retro__head">
              <span>RETROSPECTIVA · 30 DIAS</span>
              <h4>US$ 486,72</h4>
              <p>18 conversas · 7 entregas registradas · 3 projetos</p>
            </div>
            <div className="demo-retro__metrics">
              <div><b>US$ 16,22</b><span>por dia</span></div>
              <div><b>US$ 69,53</b><span>por entrega registrada</span></div>
              <div><b>7</b><span>entregas verificadas</span></div>
            </div>
            <div className="demo-heatmap">
              {Array.from({ length: 108 }, (_, index) => (
                <i
                  className={index % 29 === 0 ? "is-hot" : index % 11 === 0 || index % 17 === 0 ? "is-warm" : index % 4 === 0 ? "is-on" : ""}
                  key={index}
                />
              ))}
            </div>
            <div className="demo-agents">
              <span><i className="provider-dot provider-dot--codex" />Codex <b>US$ 308,40</b></span>
              <span><i className="provider-dot provider-dot--claude" />Claude Code <b>US$ 178,32</b></span>
            </div>
            <span className="demo-disclosure"><ShieldCheck /> AMBIENTE DEMONSTRATIVO · DADOS FICTÍCIOS</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ProductStage() {
  const [active, setActive] = useState<ScreenshotKey>("workspace")
  const activeCopy = useMemo(
    () =>
      active === "workspace"
        ? {
            index: "VISÃO 01",
            title: "O trabalho acontece em um só lugar.",
            body: "Projeto, agente, permissão, modelo, arquivos e instruções permanecem juntos enquanto você trabalha.",
          }
        : {
            index: "VISÃO 02",
            title: "O custo vira instrumento de decisão.",
            body: "Leia gasto por hora, agente e entrega para entender onde o orçamento produziu resultado — e onde não produziu.",
          },
    [active],
  )

  return (
    <section className="product-section" id="produto">
      <div className="section-shell">
        <Fade className="product-heading">
          <span className="section-kicker section-kicker--dark">A cabine</span>
          <h2>Você não precisa de mais uma janela.<br />Precisa enxergar o trabalho inteiro.</h2>
        </Fade>

        <div className="product-stage">
          <Fade className="product-stage__controls">
            <div className="view-switch" role="tablist" aria-label="Telas da Frota">
              <button
                type="button"
                role="tab"
                aria-selected={active === "workspace"}
                onClick={() => setActive("workspace")}
              >
                Trabalho
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={active === "retrospectiva"}
                onClick={() => setActive("retrospectiva")}
              >
                Retrospectiva
              </button>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                className="view-copy"
                key={active}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.28 }}
              >
                <span>{activeCopy.index}</span>
                <h3>{activeCopy.title}</h3>
                <p>{activeCopy.body}</p>
              </motion.div>
            </AnimatePresence>
            <div className="product-points" aria-label="Características da tela">
              <span><Check size={14} />Interface local</span>
              <span><Check size={14} />Permissão explícita</span>
              <span><Check size={14} />Telemetria real</span>
            </div>
          </Fade>

          <Fade className="product-window" delay={0.1}>
            <div className="product-window__bar">
              <div className="traffic-lights" aria-hidden="true"><i /><i /><i /></div>
              <span>Frota / {active === "workspace" ? "trabalho" : "painel"}</span>
              <div className="secure-local"><HardDrive size={13} /> local</div>
            </div>
            <div className="product-window__screen">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  className="product-window__demo"
                  initial={{ opacity: 0, scale: 1.015 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <DemoProductScreen active={active} />
                </motion.div>
              </AnimatePresence>
            </div>
          </Fade>
        </div>
      </div>
    </section>
  )
}

function SpecialistsSection() {
  const [activeId, setActiveId] = useState<SpecialistId>("aline")
  const [brought, setBrought] = useState(false)
  const active = specialists.find((specialist) => specialist.id === activeId) ?? specialists[0]

  return (
    <section className="specialists-section" id="especialistas">
      <div className="section-shell">
        <Fade className="specialists-heading">
          <span className="section-kicker">Especialistas</span>
          <h2>Não chame apenas um modelo.<br />Chame quem sabe o que procurar.</h2>
          <p>
            Monte uma tripulação com briefing, rubrica e ferramentas próprias. Consulte um especialista no meio da conversa sem entregar o volante a ele.
          </p>
        </Fade>

        <div className="specialists-layout">
          <Fade className="crew-manifest">
            <div className="crew-manifest__top">
              <span>TRIPULAÇÃO / ATLAS</span>
              <span>{specialists.length} ESPECIALISTAS</span>
            </div>
            <div className="crew-list" role="tablist" aria-label="Especialistas da demonstração">
              {specialists.map((specialist) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={specialist.id === activeId}
                  className={`crew-member crew-member--${specialist.accent}`}
                  key={specialist.id}
                  onClick={() => {
                    setActiveId(specialist.id)
                    setBrought(false)
                  }}
                >
                  <span className="crew-avatar">{specialist.initials}</span>
                  <span><b>{specialist.name}</b><small>{specialist.role}</small></span>
                  <em>@{specialist.id}</em>
                </button>
              ))}
            </div>
            <div className="crew-manifest__facts">
              <span><ShieldCheck />Parecer só leitura</span>
              <span><ClipboardCheck />Rubrica versionada</span>
              <span><Users />Escopo por projeto ou global</span>
            </div>
          </Fade>

          <Fade className="advisor-demo" delay={0.1}>
            <div className="advisor-demo__bar">
              <span><i /><i /><i /></span>
              <b>Frota / atlas-commerce</b>
              <em>DEMO · DADOS FICTÍCIOS</em>
            </div>
            <div className="advisor-demo__thread">
              <div className="thread-brief">
                <span>ENTREGA EM REVISÃO</span>
                <b>Publicar o novo checkout</b>
                <small>Executor: Codex · 6 arquivos alterados</small>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  className="advisor-turn"
                  key={active.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="advisor-question">
                    <span>@{active.id}</span> {active.question}
                  </div>
                  <div className={`advisor-answer advisor-answer--${active.accent}`}>
                    <div className="advisor-answer__identity">
                      <span className="crew-avatar">{active.initials}</span>
                      <div><b>{active.name}</b><small>{active.role} · parecer</small></div>
                      <em>SÓ LEITURA</em>
                    </div>
                    <p>{active.verdict}</p>
                    <ul>
                      {active.checks.map((check, index) => (
                        <motion.li
                          key={check}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.12 + index * 0.07 }}
                        >
                          <Check />{check}
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="advisor-demo__action">
              <span><MessageSquareText />{brought ? "Parecer anexado ao próximo turno" : "O parecer não altera o código"}</span>
              <button type="button" onClick={() => setBrought(true)} disabled={brought}>
                {brought ? <><Check />Parecer anexado</> : <>Trazer para o executor <ArrowRight /></>}
              </button>
            </div>
          </Fade>
        </div>
      </div>
    </section>
  )
}

function BetaForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("")
  const [profile, setProfile] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle")
  const [message, setMessage] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) return

    setStatus("sending")
    setMessage("")
    const payload = { email: email.trim(), profile: profile || null, source: "frota-landing" }
    const endpoint = import.meta.env.VITE_BETA_ENDPOINT as string | undefined

    try {
      if (endpoint) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      } else {
        localStorage.setItem("frota-beta-interest", JSON.stringify({ ...payload, createdAt: Date.now() }))
      }
      setStatus("success")
      setMessage("Você está na lista. Avisaremos quando sua cabine estiver pronta.")
    } catch {
      setStatus("error")
      setMessage("Não foi possível registrar agora. Tente novamente em alguns instantes.")
    }
  }

  if (status === "success") {
    return (
      <motion.div
        className={`form-success${compact ? " form-success--compact" : ""}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
      >
        <span><Check size={18} strokeWidth={3} /></span>
        <p>{message}</p>
      </motion.div>
    )
  }

  return (
    <form className={`beta-form${compact ? " beta-form--compact" : ""}`} onSubmit={submit}>
      <label>
        <span className="sr-only">Seu melhor e-mail</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="seu melhor e-mail"
          autoComplete="email"
          required
        />
      </label>
      {!compact && (
        <label>
          <span className="sr-only">Seu perfil</span>
          <select name="profile" value={profile} onChange={(event) => setProfile(event.target.value)}>
            <option value="">como você constrói? (opcional)</option>
            {profiles.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      )}
      <button type="submit" disabled={status === "sending"}>
        <span>{status === "sending" ? "Registrando…" : "Entrar para a beta"}</span>
        <ArrowRight size={17} />
      </button>
      {message && <p className="form-error" role="alert">{message}</p>}
    </form>
  )
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { scrollY } = useScroll()

  useMotionValueEvent(scrollY, "change", (latest) => setScrolled(latest > 24))

  return (
    <header className={`site-header${scrolled ? " site-header--scrolled" : ""}`}>
      <a className="brand" href="#top" aria-label="Frota, voltar ao início">
        <HorizonMark compact />
        <span>Frota</span>
      </a>
      <nav className="desktop-nav" aria-label="Navegação principal">
        <a href="#produto">Produto</a>
        <a href="#como-funciona">Como funciona</a>
        <a href="#especialistas">Especialistas</a>
        <a href="#modos">Modos</a>
      </nav>
      <a className="header-cta" href="#beta">Lista beta <ArrowRight size={15} /></a>
      <button
        className="menu-button"
        type="button"
        aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X /> : <Menu />}
      </button>
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            className="mobile-nav"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <a onClick={() => setMenuOpen(false)} href="#produto">Produto</a>
            <a onClick={() => setMenuOpen(false)} href="#como-funciona">Como funciona</a>
            <a onClick={() => setMenuOpen(false)} href="#especialistas">Especialistas</a>
            <a onClick={() => setMenuOpen(false)} href="#modos">Modos</a>
            <a onClick={() => setMenuOpen(false)} href="#beta">Entrar para a beta</a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}

function App() {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.001 })

  return (
    <div id="top">
      <motion.div className="scroll-progress" style={{ scaleX: progress }} />
      <Header />

      <main>
        <section className="hero section-shell">
          <div className="hero__grid">
            <div className="hero__copy">
              <motion.div
                className="hero__eyebrow"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.08 }}
              >
                <span className="live-dot live-dot--amber" />
                Convocação para a beta privada
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="hero__line hero__line--primary">Troque o agente.</span>
                <span className="hero__line hero__line--secondary">Não recomece o trabalho.</span>
              </motion.h1>
              <motion.p
                className="hero__lead"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.22 }}
              >
                Frota mantém contexto, decisões, custos e entregas no mesmo fio — enquanto você alterna entre os agentes que já usa.
              </motion.p>
              <motion.div
                className="hero__form"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.3 }}
              >
                <BetaForm compact />
                <span className="form-note"><ShieldCheck size={14} /> macOS · local-first · sem cartão</span>
              </motion.div>
            </div>
            <FlightRecorder />
          </div>

          <motion.div
            className="hero__footer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.75 }}
          >
            <div className="agent-line">
              <span>TRABALHA COM</span>
              <b><i className="provider-dot provider-dot--codex" />Codex</b>
              <b><i className="provider-dot provider-dot--claude" />Claude Code</b>
              <b><i className="provider-dot provider-dot--agy" />Antigravity</b>
            </div>
            <a href="#produto">Conhecer a cabine <ArrowDown size={16} /></a>
          </motion.div>
        </section>

        <ProductStage />

        <section className="thesis-section section-shell" id="como-funciona">
          <Fade className="thesis-heading">
            <span className="section-kicker">A mudança de eixo</span>
            <h2>O seu time não é o modelo.<br />É o sistema ao redor dele.</h2>
          </Fade>
          <Fade className="thesis-contrast" delay={0.1}>
            <div className="contrast-column contrast-column--before">
              <span>SEM COCKPIT</span>
              <p>Conversas isoladas</p>
              <p>Contexto reescrito</p>
              <p>Custos sem resultado</p>
              <p>Progresso invisível</p>
            </div>
            <div className="contrast-route" aria-hidden="true">
              <span>de prompts</span>
              <div><ChevronRight /><ChevronRight /><ChevronRight /></div>
              <span>para missões</span>
            </div>
            <div className="contrast-column contrast-column--after">
              <span>COM FROTA</span>
              <p>Um fio por projeto <Check /></p>
              <p>Handoffs com memória <Check /></p>
              <p>Custo por entrega <Check /></p>
              <p>Decisões no radar <Check /></p>
            </div>
          </Fade>
        </section>

        <section className="features-section section-shell" aria-label="Pilares da Frota">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <Fade className={`feature-card feature-card--${feature.accent}`} delay={index * 0.08} key={feature.title}>
                <div className="feature-card__head">
                  <span><Icon size={19} /></span>
                  <small>{feature.eyebrow}</small>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <div className="feature-card__meter" aria-hidden="true"><i /><i /><i /><i /><i /></div>
              </Fade>
            )
          })}
        </section>

        <section className="handoff-section">
          <div className="section-shell handoff-layout">
            <Fade className="handoff-copy">
              <span className="section-kicker section-kicker--dark">Revezamento</span>
              <h2>Quando um agente sai,<br />o fio não arrebenta.</h2>
              <p>
                A Frota prepara o contexto, abre a sessão de destino e só conclui a troca quando o próximo agente está pronto. O trabalho não fica no limbo entre provedores.
              </p>
              <ul>
                <li><Check />Histórico e decisões seguem juntos</li>
                <li><Check />A origem permanece até o destino assumir</li>
                <li><Check />Você vê quem está com o manche</li>
              </ul>
            </Fade>
            <Fade className="handoff-instrument" delay={0.12}>
              <div className="instrument-top">
                <span>HANDOFF / SEQUÊNCIA SEGURA</span>
                <span>AUTO</span>
              </div>
              <div className="instrument-sequence">
                <div className="sequence-item sequence-item--done">
                  <small>ORIGEM</small>
                  <strong>Codex</strong>
                  <span><Check size={13} /> contexto preparado</span>
                </div>
                <div className="sequence-track">
                  <i /><i /><i />
                  <span>protocolo Frota</span>
                </div>
                <div className="sequence-item sequence-item--active">
                  <small>DESTINO</small>
                  <strong>Claude Code</strong>
                  <span><Radio size={13} /> sessão assumida</span>
                </div>
              </div>
              <div className="instrument-log">
                <div><time>10:06:12</time><span>contexto materializado</span><b>OK</b></div>
                <div><time>10:06:14</time><span>sessão de destino aberta</span><b>OK</b></div>
                <div><time>10:06:17</time><span>continuidade confirmada</span><b>OK</b></div>
              </div>
            </Fade>
          </div>
        </section>

        <SpecialistsSection />

        <section className="modes-section section-shell" id="modos">
          <Fade className="modes-heading">
            <span className="section-kicker">Três formas de voar</span>
            <h2>O processo muda.<br />A cabine continua a mesma.</h2>
            <p>Escolha o modo pelo tipo de risco e pela clareza do problema — não pelo provedor da vez.</p>
          </Fade>
          <div className="mode-list">
            {modes.map((mode, index) => (
              <Fade className="mode-card" delay={index * 0.06} key={mode.code}>
                <div className="mode-card__number">0{index + 1}</div>
                <div className="mode-card__copy">
                  <span>{mode.code}</span>
                  <h3>{mode.title}</h3>
                  <p>{mode.body}</p>
                </div>
                <div className="mode-card__detail"><GitBranch size={16} />{mode.detail}</div>
              </Fade>
            ))}
          </div>
        </section>

        <section className="local-section section-shell">
          <Fade className="local-card">
            <div className="local-card__copy">
              <span className="section-kicker section-kicker--dark">Local-first por definição</span>
              <h2>Seu código não precisa<br />mudar de endereço.</h2>
              <p>A Frota roda na sua máquina, usa as CLIs e assinaturas que você já paga e mantém o contexto operacional perto do projeto.</p>
              <div className="local-badges">
                <span><HardDrive />Dados locais</span>
                <span><Command />Suas CLIs</span>
                <span><ShieldCheck />Sem chave nova</span>
              </div>
            </div>
            <div className="local-card__terminal" aria-label="Exemplo de configuração local">
              <div><i /><i /><i /><span>Frota — local</span></div>
              <pre><code><span>$</span> which codex claude agy<br />/opt/homebrew/bin/codex<br />/opt/homebrew/bin/claude<br />/usr/local/bin/agy<br /><br /><em>✓ 3 agentes disponíveis</em><br /><em>✓ contexto do projeto carregado</em><br /><em>✓ nenhuma chave nova na Frota</em></code></pre>
            </div>
          </Fade>
        </section>

        <section className="beta-section" id="beta">
          <div className="beta-grid" aria-hidden="true" />
          <div className="section-shell beta-layout">
            <Fade className="beta-copy">
              <span className="section-kicker section-kicker--dark">Primeira chamada</span>
              <h2>Ajude a construir<br />a cabine certa.</h2>
              <p>Estamos formando um grupo pequeno de builders para testar a Frota em projetos reais e influenciar o que entra primeiro.</p>
              <div className="beta-meta">
                <span><Clock3 />Acesso em ondas</span>
                <span><Inbox />Canal direto de feedback</span>
              </div>
            </Fade>
            <Fade className="beta-panel" delay={0.1}>
              <div className="beta-panel__top">
                <span>LISTA BETA / 2026</span>
                <span>MACOS</span>
              </div>
              <h3>Reserve seu lugar.</h3>
              <p>Sem spam. Só entraremos em contato sobre o acesso e as rodadas de teste.</p>
              <BetaForm />
              <small>Ao entrar, você concorda em receber comunicações sobre a beta da Frota.</small>
            </Fade>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="section-shell footer-inner">
          <a className="brand brand--footer" href="#top"><span>Frota</span></a>
          <p>O trabalho continua, mesmo quando o agente muda.</p>
          <span>Feito no Brasil · 2026</span>
        </div>
      </footer>
    </div>
  )
}

export default App
