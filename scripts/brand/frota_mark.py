"""Geometria única da marca Frota (horizonte artificial).

Fonte de verdade do desenho: todo ativo de marca (ícone de app, tray, favicon,
SVG mestre) sai daqui, para nenhuma superfície divergir do símbolo.

Espaço de coordenadas: 44 x 44, o mesmo do `FrotaMark.tsx`.

  circulo   centro (22, 22), raio 20
  horizonte (6.5, 24.5) → (18, 22) → (22, 23) → (26, 22) → (37.5, 24.5)
  mastro    (22, 16) → (22, 26)
  barra     (13, 29) → (31, 29)

Níveis de detalhe: o símbolo cheio precisa de espaço. Abaixo de ~96 px o
horizonte e a barra encostam um no outro e viram borrão, então o desenho perde
elementos de baixo para cima (barra primeiro, depois mastro). O círculo e o
horizonte, que são a marca, nunca saem.
"""

from __future__ import annotations

VIEWBOX = 44.0

CIRCLE_CENTER = (22.0, 22.0)
CIRCLE_RADIUS = 20.0

HORIZON = [(6.5, 24.5), (18.0, 22.0), (22.0, 23.0), (26.0, 22.0), (37.5, 24.5)]
MAST = [(22.0, 16.0), (22.0, 26.0)]
BAR = [(13.0, 29.0), (31.0, 29.0)]

# ordem de sobrevivência: o que some primeiro fica no fim
DETAIL_FULL = "full"  # círculo + horizonte + mastro + barra
DETAIL_MID = "mid"  # círculo + horizonte + mastro
DETAIL_SMALL = "small"  # círculo + horizonte


def strokes_for(detail: str) -> list[list[tuple[float, float]]]:
    """Polilinhas do símbolo (fora o círculo) para o nível de detalhe."""
    if detail == DETAIL_FULL:
        return [HORIZON, MAST, BAR]
    if detail == DETAIL_MID:
        return [HORIZON, MAST]
    if detail == DETAIL_SMALL:
        return [HORIZON]
    raise ValueError(f"nível de detalhe desconhecido: {detail}")


def detail_for(mark_px: float) -> str:
    """Nível de detalhe pelo tamanho em pixels que o símbolo vai ocupar."""
    if mark_px >= 96:
        return DETAIL_FULL
    if mark_px >= 32:
        return DETAIL_MID
    return DETAIL_SMALL


def stroke_for(mark_px: float) -> float:
    """Peso do traço, em unidades do viewBox 44, pelo tamanho de render.

    Compensação óptica: traço fino demais some no menu bar e no ícone de 32 px;
    grosso demais fecha o miolo do círculo. Os números saíram da folha de
    contato em `--preview` olhada a 1x e a 2x.
    """
    if mark_px >= 256:
        return 2.4
    if mark_px >= 96:
        return 2.8
    if mark_px >= 44:
        return 3.2
    if mark_px >= 24:
        return 3.6
    return 4.0


def path_d(points: list[tuple[float, float]]) -> str:
    """Polilinha em `d` de SVG, sempre absoluta (implícito depois do M é L)."""
    head = points[0]
    rest = " ".join(f"L{x:g} {y:g}" for x, y in points[1:])
    return f"M{head[0]:g} {head[1]:g} {rest}"
