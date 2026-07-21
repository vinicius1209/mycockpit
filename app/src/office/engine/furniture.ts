/** Semantic geometry for composite furniture. Coordinates are expressed in
 * world tiles relative to the furniture anchor, before isometric projection. */
export type FurniturePoint = { x: number; y: number }

export type FurnitureRect = FurniturePoint & { w: number; h: number }

export type SupportedFurniturePart = {
  rect: FurnitureRect
  surface: string
}

export type FurnitureAssemblySpec = {
  footprint: { w: number; h: number }
  anchorFromTile: FurniturePoint
  surfaces: Record<string, FurnitureRect>
  supported: Record<string, SupportedFurniturePart>
  operator: {
    chairCollision: FurnitureRect
    chairVisual: FurnitureRect
    facing: FurniturePoint
    monitorPart: string
    keyboardPart: string
    maxLateralOffset: number
  }
  visitors: Array<{
    center: FurniturePoint
    footprint: { w: number; h: number }
    facing: FurniturePoint
  }>
  interaction: FurniturePoint
}

export type FurnitureValidationIssue = {
  code: string
  message: string
}

export const EXECUTIVE_STATION_SPEC: FurnitureAssemblySpec = {
  footprint: { w: 4, h: 2 },
  anchorFromTile: { x: 2, y: 1 },
  surfaces: {
    main: { x: 0, y: -0.28, w: 3.55, h: 0.92 },
    return: { x: 1.28, y: 0.2, w: 0.98, h: 1.32 },
  },
  supported: {
    deskPad: {
      rect: { x: -0.25, y: -0.06, w: 1.32, h: 0.48 },
      surface: "main",
    },
    keyboard: {
      rect: { x: -0.5, y: 0.08, w: 0.62, h: 0.2 },
      surface: "main",
    },
    monitor: {
      rect: { x: -0.5, y: -0.05, w: 0.38, h: 0.22 },
      surface: "main",
    },
    notepad: {
      rect: { x: 1.08, y: 0.28, w: 0.38, h: 0.28 },
      surface: "return",
    },
    lamp: {
      rect: { x: 0.78, y: -0.12, w: 0.2, h: 0.2 },
      surface: "main",
    },
  },
  operator: {
    // Collision remains a stable 2x1 tile bay. The narrower visual chair sits
    // on the same world-x axis as monitor and keyboard.
    chairCollision: { x: 0, y: -1.5, w: 2, h: 1 },
    chairVisual: { x: -0.5, y: -1.5, w: 0.82, h: 0.66 },
    facing: { x: 0, y: 1 },
    monitorPart: "monitor",
    keyboardPart: "keyboard",
    maxLateralOffset: 0.05,
  },
  visitors: [
    { center: { x: -1.5, y: 2.5 }, footprint: { w: 1, h: 1 }, facing: { x: 0, y: -1 } },
    { center: { x: 1.5, y: 2.5 }, footprint: { w: 1, h: 1 }, facing: { x: 0, y: -1 } },
  ],
  interaction: { x: 0, y: 1 },
}

const EPSILON = 1e-6

function edges(rect: FurnitureRect) {
  return {
    left: rect.x - rect.w / 2,
    right: rect.x + rect.w / 2,
    top: rect.y - rect.h / 2,
    bottom: rect.y + rect.h / 2,
  }
}

function contains(outer: FurnitureRect, inner: FurnitureRect): boolean {
  const a = edges(outer)
  const b = edges(inner)
  return (
    b.left >= a.left - EPSILON &&
    b.right <= a.right + EPSILON &&
    b.top >= a.top - EPSILON &&
    b.bottom <= a.bottom + EPSILON
  )
}

function overlap(a: FurnitureRect, b: FurnitureRect): boolean {
  const ae = edges(a)
  const be = edges(b)
  return (
    Math.min(ae.right, be.right) - Math.max(ae.left, be.left) > EPSILON &&
    Math.min(ae.bottom, be.bottom) - Math.max(ae.top, be.top) > EPSILON
  )
}

function length(point: FurniturePoint): number {
  return Math.hypot(point.x, point.y)
}

function dot(a: FurniturePoint, b: FurniturePoint): number {
  return a.x * b.x + a.y * b.y
}

/** Converts a relative rect into the NW tile used by the collision/layout API. */
export function furnitureRectTile(
  anchor: FurniturePoint,
  rect: FurnitureRect,
): FurniturePoint {
  return {
    x: anchor.x + rect.x - rect.w / 2,
    y: anchor.y + rect.y - rect.h / 2,
  }
}

/** Pure QA harness: catches unsupported equipment, disconnected surfaces,
 * visual/collision drift and seats that do not face their work target. */
export function validateFurnitureAssembly(
  spec: FurnitureAssemblySpec,
): FurnitureValidationIssue[] {
  const issues: FurnitureValidationIssue[] = []
  const footprint: FurnitureRect = { x: 0, y: 0, ...spec.footprint }
  const surfaceEntries = Object.entries(spec.surfaces)

  for (const [id, surface] of surfaceEntries) {
    if (!contains(footprint, surface)) {
      issues.push({ code: "surface-outside-footprint", message: `${id} exceeds furniture footprint` })
    }
  }
  if (
    surfaceEntries.length > 1 &&
    !surfaceEntries.slice(1).every(([, surface]) => overlap(surfaceEntries[0][1], surface))
  ) {
    issues.push({ code: "disconnected-surface", message: "composite work surfaces do not overlap" })
  }

  for (const [id, part] of Object.entries(spec.supported)) {
    const surface = spec.surfaces[part.surface]
    if (!surface) {
      issues.push({ code: "missing-support", message: `${id} references missing surface ${part.surface}` })
    } else if (!contains(surface, part.rect)) {
      issues.push({ code: "unsupported-part", message: `${id} is not fully supported by ${part.surface}` })
    }
  }

  const operator = spec.operator
  if (!contains(operator.chairCollision, operator.chairVisual)) {
    issues.push({ code: "chair-outside-collision", message: "operator chair exceeds its blocked bay" })
  }
  const facingLength = length(operator.facing)
  const monitor = spec.supported[operator.monitorPart]?.rect
  const keyboard = spec.supported[operator.keyboardPart]?.rect
  if (facingLength <= EPSILON || !monitor || !keyboard) {
    issues.push({ code: "invalid-operator", message: "operator bay lacks facing, monitor or keyboard" })
  } else {
    const facing = { x: operator.facing.x / facingLength, y: operator.facing.y / facingLength }
    const lateral = { x: -facing.y, y: facing.x }
    for (const [id, target] of [["monitor", monitor], ["keyboard", keyboard]] as const) {
      const delta = {
        x: target.x - operator.chairVisual.x,
        y: target.y - operator.chairVisual.y,
      }
      if (dot(delta, facing) <= 0) {
        issues.push({ code: "operator-facing", message: `${id} is behind the operator chair` })
      }
      if (Math.abs(dot(delta, lateral)) > operator.maxLateralOffset + EPSILON) {
        issues.push({ code: "operator-axis", message: `${id} is outside the operator work axis` })
      }
    }
  }

  if (spec.visitors.length === 2) {
    const [left, right] = spec.visitors
    if (
      Math.abs(left.center.x + right.center.x) > EPSILON ||
      Math.abs(left.center.y - right.center.y) > EPSILON
    ) {
      issues.push({ code: "visitor-asymmetry", message: "visitor chairs are not symmetric around the desk" })
    }
  }
  for (const [index, visitor] of spec.visitors.entries()) {
    const towardDesk = { x: -visitor.center.x, y: -visitor.center.y }
    const denominator = length(towardDesk) * length(visitor.facing)
    if (denominator <= EPSILON || dot(towardDesk, visitor.facing) / denominator < 0.8) {
      issues.push({ code: "visitor-facing", message: `visitor chair ${index} does not face the desk` })
    }
  }

  return issues
}
