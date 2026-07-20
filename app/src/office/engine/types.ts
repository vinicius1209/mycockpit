/** Contrato central do Agent Office (ver docs/agent-office.md).
 *
 *  Camadas e dependências (regra dura):
 *    engine/  — TS puro, zero imports de Pixi/React/app. 100% testável.
 *    scene/   — Pixi; importa engine/.
 *    bridge/  — único lugar que importa stores/lib do app; importa engine/types.
 *    ui/      — React overlay; importa bridge/ + scene/.
 *
 *  Coordenadas: "mundo" em unidades de TILE (float, contínuo); "tela" em px.
 *  Projeção diamond 2:1: sx = (wx - wy) * TILE_W/2 ; sy = (wx + wy) * TILE_H/2.
 */

export const TILE_W = 64
export const TILE_H = 32

/** Sim em passo fixo (Fix Your Timestep). Render pode interpolar NPCs/câmera;
 *  o BOSS renderiza sem interpolação (snap — latência mínima de input). */
export const SIM_HZ = 60
export const SIM_DT = 1 / SIM_HZ
/** Clamp do acumulador (anti espiral da morte ao voltar de oclusão). */
export const MAX_FRAME_MS = 250

/** Velocidade do boss em tiles/s (espaço de MUNDO; |v| igual nas 8 direções). */
export const BOSS_SPEED = 4
/** Meia-largura da AABB dos pés, em tiles. */
export const BODY_HALF = 0.28
/** Histerese de proximidade da mesa (distância contínua dos pés ao tile INTERACT). */
export const REACH_ENTER = 1.0
export const REACH_EXIT = 1.5

export type Vec2 = { x: number; y: number }

// ---------------------------------------------------------------------------
// Grid / planta
// ---------------------------------------------------------------------------

/** Bitflags por tile na grid global (Uint8Array, idx = y * w + x). */
export const T_WALK = 1
export const T_DOOR = 2
export const T_INTERACT = 4

/** Ids de agent = ids do registry do app (lib/agents.ts). */
export type OfficeAgentId = "claude-code" | "codex" | "agy"
export const OFFICE_AGENTS: OfficeAgentId[] = ["claude-code", "codex", "agy"]

export type DeskPlacement = {
  /** `${projectId}::${agent}` */
  id: string
  projectId: string
  agent: OfficeAgentId
  /** Tile de origem da mesa (canto), em tiles inteiros. */
  tile: Vec2
  /** Tile caminhável onde o boss interage (na frente da mesa). */
  interactTile: Vec2
  /** Espelhar sprite horizontalmente. */
  flip: boolean
  /** Nome de exibição do agent no cartão da mesa (bridge/layout preenche via
   *  deskDisplayName do bridge/hooks; ausente ⇒ a cena cai no id). */
  agentName?: string
}

/** Item de decoração procedural (bridge/layout preenche). `tile` = canto NW,
 *  em tiles inteiros. Itens de CHÃO bloqueiam o footprint na grid (o layout já
 *  aplica); tapete e decoração de parede são só visuais. Footprints >1×1 e o
 *  critério bloqueia/não-bloqueia: ver DECOR_FOOTPRINTS/isBlockingDecor em
 *  bridge/layout.ts. */
export type RoomDecorItem = {
  kind: string
  tile: Vec2
  flip?: boolean
  /** Deslocamento VISUAL em tiles a partir do centro do footprint (encaixes
   *  finos de conjuntos — cadeira enfiada sob o tampo, mesinha centrada no
   *  sofá). Só desenho; a grid bloqueia pelos tiles inteiros. */
  offset?: Vec2
}

export type RoomPlacement = {
  projectId: string
  /** 0 = fileira acima do corredor, 1 = abaixo. */
  row: 0 | 1
  /** Canto do interior da sala (tiles inteiros). */
  origin: Vec2
  w: number
  h: number
  /** Tiles de porta (na borda com o corredor). */
  doorTiles: Vec2[]
  desks: DeskPlacement[]
  /** Decoração procedural determinística (ausente só em plantas de teste
   *  montadas à mão — buildFloorPlan SEMPRE preenche). */
  decor?: RoomDecorItem[]
}

/** Ponto de interação SEM mesa/agent (O-2): a proximidade do boss usa o MESMO
 *  pipeline das mesas (updateProximity → near-desk → menu-balão), mas o id não
 *  é `${projectId}::${agent}` — a ui reconhece o id e troca o menu/dock.
 *  Decisão de contrato: lista própria em vez de pseudo-desk em rooms[].desks —
 *  um DeskPlacement fake exigiria guardas em derive/cena/ensureDeskConversation
 *  (todos iteram desks assumindo projeto+agent reais); aqui o diff fica contido
 *  em updateProximity + nos pontos da ui que já tratam ids de mesa. */
export type OfficeInteractable = {
  /** Id fora do espaço de mesas (ex.: MISSION_TABLE_ID). */
  id: string
  /** Tile-âncora pro balão (centro visual do móvel). */
  tile: Vec2
  /** Tile caminhável onde o boss interage. */
  interactTile: Vec2
}

/** Mesa de reunião da sala comum — lança missões reais (O-2, §8). */
export const MISSION_TABLE_ID = "commons::mission"

/** Sala comum no fim do corredor (sem projeto): mesa de reunião, lounge com
 *  sofá, cozinha. Tiles de móveis bloqueados na grid; resto caminhável. */
export type CommonRoomPlacement = {
  id: "commons"
  /** Canto do interior (tiles inteiros). */
  origin: Vec2
  w: number
  h: number
  /** Tiles de porta (na parede com o corredor). */
  doorTiles: Vec2[]
  decor: RoomDecorItem[]
}

/** Saída de bridge/layout.ts — geometria pura, derivada da lista de projetos. */
export type FloorPlan = {
  /** Dimensões da grid global em tiles. */
  w: number
  h: number
  /** Flags por tile (T_WALK | T_DOOR | T_INTERACT). */
  grid: Uint8Array
  rooms: RoomPlacement[]
  /** Spawn do boss (corredor), em coords contínuas. */
  spawn: Vec2
  /** Sala comum no fim do corredor (ausente na planta vazia/teste). */
  commonRoom?: CommonRoomPlacement
  /** Pontos de interação sem mesa (mesa de reunião). Entram na proximidade. */
  interactables?: OfficeInteractable[]
  /** Decoração do corredor (bebedouro, plantas, quadro de avisos). Itens de
   *  chão só nas fileiras encostadas nas paredes — o meio fica livre. */
  corridorDecor?: RoomDecorItem[]
}

// ---------------------------------------------------------------------------
// Snapshot de atividade (bridge/derive.ts → cena/HUD). Transições DISCRETAS —
// nunca por frame.
// ---------------------------------------------------------------------------

export type DeskVisualState =
  | "off" //        CLI não detectado — mesa apagada
  | "idle" //       disponível (café/idle variado)
  | "thinking" //   turno rodando, sem output recente (balões de pensamento)
  | "typing" //     turno rodando com text_delta/tool recente (braços digitando)
  | "hand" //       precisa do humano: gate de missão ou approval mapeada

export type DeskSnapshot = {
  id: string // `${projectId}::${agent}`
  projectId: string
  agent: OfficeAgentId
  state: DeskVisualState
  /** Rótulo curto pt-BR no label da mesa ("Pensando", "Executando", "Disponível"…). */
  label: string
  /** Linha de detalhe opcional (ex.: tool corrente, persona da fase de missão). */
  detail?: string
  /** Conversa associada à mesa, quando conhecida (turno/missão em voo). */
  convId?: string
  /** Motivo da mão levantada, quando state === "hand". */
  hand?: "gate" | "approval"
}

export type RoomAggregate = "hand" | "running" | "idle"

/** Agregado da sala a partir das mesas (fonte única — luz da porta e badge do
 *  HUD): hand > running (typing/thinking) > idle. */
export function roomAggregate(
  desks: readonly Pick<DeskSnapshot, "state">[],
): RoomAggregate {
  if (desks.some((d) => d.state === "hand")) return "hand"
  if (desks.some((d) => d.state === "typing" || d.state === "thinking")) {
    return "running"
  }
  return "idle"
}

export type RoomSnapshot = {
  projectId: string
  name: string
  /** Cor do projeto (token/hex) para placa e porta, se houver. */
  color?: string
  /** Agregado para luz da porta + badge do HUD. */
  agg: RoomAggregate
  /** Custo acumulado do projeto (ledger + missões em voo). */
  costUsd: number
  desks: DeskSnapshot[]
}

export type OfficeSnapshot = {
  rooms: RoomSnapshot[]
  /** Balões efêmeros de entrega: convId → resumo curto (limpo pelo consumidor). */
  deliveries: { deskId: string; text: string; at: number }[]
}

// ---------------------------------------------------------------------------
// Estado do mundo (mutável, vive FORA do React; dono: engine/sim.ts)
// ---------------------------------------------------------------------------

export type BossState = {
  pos: Vec2
  /** Posição do tick anterior (interpolação de NPCs usa o próprio; boss usa snap). */
  prev: Vec2
  vel: Vec2
  /** 1 = olhando "direita" da tela, -1 = esquerda (flip do sprite). */
  facing: 1 | -1
  moving: boolean
  /** Caminho restante do click-to-move (waypoints em coords contínuas), ou null. */
  path: Vec2[] | null
  /** Mesa que deve auto-abrir o dock quando o caminho terminar (clique na mesa). */
  pendingDeskId: string | null
}

export type CameraMode = "follow" | "inspect"

export type CameraState = {
  mode: CameraMode
  /** Centro da câmera em coords de MUNDO (contínuas). */
  pos: Vec2
  prev: Vec2
  zoom: number
  /** Alvo do modo inspect (ex.: centro de uma sala). */
  inspectTarget: Vec2 | null
  /** Deslocamento de framing em px de tela (ex.: dock aberto). */
  screenOffset: Vec2
  /** Relógio da sim (s) até quando o alvo do follow fica congelado durante o
   *  gesto de zoom (escrito por zoomAt; 0 = sem congelamento). */
  zoomFreezeUntil: number
}

/** Estado de input — handlers de DOM só ESCREVEM aqui; a sim lê no passo fixo.
 *  Regra de roteamento: keydown vindo de input/textarea/contentEditable NUNCA
 *  entra aqui (ver engine/input.ts). */
export type InputState = {
  keys: Set<string>
  /** Clique de movimento pendente (coords de mundo), consumido pela sim. */
  clickWorld: Vec2 | null
  /** Clique numa mesa (hit-test da cena), consumido pela sim. */
  clickDeskId: string | null
}

export type World = {
  plan: FloorPlan
  boss: BossState
  camera: CameraState
  input: InputState
  /** Mesa em alcance (histerese REACH_ENTER/REACH_EXIT), alvo único. */
  nearDeskId: string | null
  /** Relógio da sim em segundos (para animações determinísticas). */
  time: number
}

// ---------------------------------------------------------------------------
// Eventos discretos sim → UI (espelho zustand em ui/, coalescido ≤10Hz)
// ---------------------------------------------------------------------------

export type SimEvent =
  | { kind: "near-desk"; deskId: string | null }
  | { kind: "arrived-at-desk"; deskId: string }
  | { kind: "camera-mode"; mode: CameraMode }
