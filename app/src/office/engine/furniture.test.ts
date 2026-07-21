import { describe, expect, it } from "vitest"
import {
  EXECUTIVE_STATION_SPEC,
  type FurnitureAssemblySpec,
  validateFurnitureAssembly,
} from "./furniture"

function cloneSpec(): FurnitureAssemblySpec {
  return JSON.parse(JSON.stringify(EXECUTIVE_STATION_SPEC)) as FurnitureAssemblySpec
}

describe("furniture semantic QA", () => {
  it("valida apoio, orientação, eixo de trabalho e simetria da estação executiva", () => {
    expect(validateFurnitureAssembly(EXECUTIVE_STATION_SPEC)).toEqual([])
  })

  it("detecta a regressão de cadeira e monitor em lados diferentes", () => {
    const broken = cloneSpec()
    broken.supported.monitor.rect.x = -0.72
    const codes = validateFurnitureAssembly(broken).map((issue) => issue.code)
    expect(codes).toContain("operator-axis")
  })

  it("detecta equipamentos parcialmente sem apoio", () => {
    const broken = cloneSpec()
    broken.supported.notepad.rect.x = 0.72
    const issues = validateFurnitureAssembly(broken)
    expect(issues).toContainEqual({
      code: "unsupported-part",
      message: "notepad is not fully supported by return",
    })
  })
})
