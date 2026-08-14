#!/usr/bin/env python3
"""Gera todos os ícones da Frota a partir da geometria em `frota_mark.py`.

Uso (da raiz do repo):

    python3 scripts/brand/gen_icons.py --write            # escreve os ativos
    python3 scripts/brand/gen_icons.py --preview <dir>    # folhas de contato

Saídas de `--write`:

    assets/brand/frota-mark.svg          símbolo puro (currentColor, traço)
    assets/brand/frota-icon.svg          ícone de app (squircle + símbolo)
    app/public/favicon.svg               ícone de app, versão web
    app/src-tauri/icons/32x32.png        \
    app/src-tauri/icons/64x64.png         | família declarada no
    app/src-tauri/icons/128x128.png       | tauri.conf.json (+ vizinhos)
    app/src-tauri/icons/128x128@2x.png    |
    app/src-tauri/icons/icon.png         /
    app/src-tauri/icons/icon.icns        macOS (via iconutil)
    app/src-tauri/icons/icon.ico         Windows (escrito à mão, PNG embutido)
    app/src-tauri/icons/tray-template.png    menu bar 1x (template: só alfa)
    app/src-tauri/icons/tray-template@2x.png menu bar 2x

Dependências: Pillow (já instalado) e `iconutil` (nativo do macOS).
Nenhuma dependência nova foi instalada para isto.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from frota_mark import (  # noqa: E402
    CIRCLE_CENTER,
    CIRCLE_RADIUS,
    DETAIL_MID,
    VIEWBOX,
    detail_for,
    path_d,
    stroke_for,
    strokes_for,
)

REPO = Path(__file__).resolve().parents[2]
ICONS = REPO / "app" / "src-tauri" / "icons"
PUBLIC = REPO / "app" / "public"
BRAND = REPO / "assets" / "brand"

# Paleta da casa (docs/STYLEGUIDE.md · index.css). O ícone de app é uma
# superfície escura com o brass do tema escuro, que é o brass legível sobre
# grafite; o brass do tema claro (#a9742b) some no fundo do Dock escuro.
BRASS = (228, 168, 98, 255)  # --brass (escuro)
BG_TOP = (34, 38, 44, 255)
BG_BOTTOM = (11, 13, 17, 255)
RIM = (255, 255, 255, 26)


def _ss(size: int) -> int:
    """Fator de supersample: desenha grande e reduz com LANCZOS.

    Teto de ~2048 px de tela intermediária: acima disso o custo explode sem
    ganho visível (o tamanho grande já tem resolução de sobra).
    """
    return max(2, min(8, 2048 // max(1, size)))


# Proporções do ícone de app no grid do macOS: a arte ocupa 824 de 1024.
# Nos tamanhos pequenos a arte cresce dentro do quadro (é o que a Apple faz nas
# variantes de 16/32 px): com a margem cheia, o símbolo some no Finder em lista.
SQUIRCLE_FRAC = 824 / 1024
# Expoente da superelipse. n=6 foi calibrado contra o AppIcon.icns do Notes.app:
# o topo reto do Notes dá raio efetivo 0,220 do lado; n=6 dá 0,226 (n=5 dá 0,267,
# arredondado demais).
SQUIRCLE_N = 6.0
MARK_IN_SQUIRCLE = 0.60


def _squircle_frac(size: int) -> float:
    if size <= 32:
        return 0.94
    if size <= 64:
        return 0.90
    return SQUIRCLE_FRAC


def _mark_frac(size: int) -> float:
    if size <= 32:
        return 0.70
    if size <= 64:
        return 0.66
    return MARK_IN_SQUIRCLE


# --------------------------------------------------------------------------- #
# desenho do símbolo
# --------------------------------------------------------------------------- #


def _stroke_polyline(draw: ImageDraw.ImageDraw, pts, width: float, fill) -> None:
    """Polilinha com ponta e junta redondas (o PIL não tem linecap)."""
    w = max(1, int(round(width)))
    draw.line(pts, fill=fill, width=w, joint="curve")
    r = w / 2.0
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def draw_mark(
    img: Image.Image,
    *,
    box: tuple[float, float, float, float],
    color,
    stroke_units: float,
    detail: str,
) -> None:
    """Desenha o símbolo dentro de `box` (x, y, w, h) já em escala SS."""
    x0, y0, w, _h = box
    scale = w / VIEWBOX
    draw = ImageDraw.Draw(img)
    sw = stroke_units * scale

    def px(p):
        return (x0 + p[0] * scale, y0 + p[1] * scale)

    cx, cy = px(CIRCLE_CENTER)
    r = CIRCLE_RADIUS * scale
    draw.ellipse(
        (cx - r, cy - r, cx + r, cy + r),
        outline=color,
        width=max(1, int(round(sw))),
    )
    for poly in strokes_for(detail):
        _stroke_polyline(draw, [px(p) for p in poly], sw, color)


def render_mark(
    size: int,
    *,
    color=BRASS,
    fill_frac: float = 0.94,
    detail: str | None = None,
    stroke_units: float | None = None,
) -> Image.Image:
    """Símbolo sozinho, fundo transparente, quadrado de `size` px."""
    mark_px = size * fill_frac
    detail = detail or detail_for(mark_px)
    stroke_units = stroke_units if stroke_units is not None else stroke_for(mark_px)

    big = size * _ss(size)
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    side = big * fill_frac
    off = (big - side) / 2
    draw_mark(
        img,
        box=(off, off, side, side),
        color=color,
        stroke_units=stroke_units,
        detail=detail,
    )
    return img.resize((size, size), Image.LANCZOS)


# --------------------------------------------------------------------------- #
# ícone de app
# --------------------------------------------------------------------------- #


def _squircle_points(size: float, n: float = SQUIRCLE_N) -> list[tuple[float, float]]:
    """Contorno da superelipse |x/a|^n + |y/a|^n = 1."""
    a = size / 2.0
    pts = []
    steps = 1440
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = a * (abs(ct) ** (2 / n)) * (1 if ct >= 0 else -1)
        y = a * (abs(st) ** (2 / n)) * (1 if st >= 0 else -1)
        pts.append((a + x, a + y))
    return pts


def _squircle_mask(size: int, n: float = SQUIRCLE_N) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(_squircle_points(size, n), fill=255)
    return mask


def mask_full(big: int, mask: Image.Image, off: int) -> Image.Image:
    """A máscara da arte posicionada na tela inteira (para recortar o fio)."""
    full = Image.new("L", (big, big), 0)
    full.paste(mask, (off, off))
    return full


def _vertical_gradient(size: int, top, bottom) -> Image.Image:
    grad = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel(
            (0, y),
            tuple(int(round(top[i] + (bottom[i] - top[i]) * t)) for i in range(4)),
        )
    return grad.resize((size, size), Image.BICUBIC)


def render_app_icon(size: int) -> Image.Image:
    """Ícone de app: squircle com margem (grid do macOS) + símbolo em brass."""
    big = size * _ss(size)
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    side = int(round(big * _squircle_frac(size)))
    off = (big - side) // 2
    mask = _squircle_mask(side)

    # sombra sutil por baixo da arte (o Dock não adiciona sombra própria).
    # Abaixo de 64 px ela só comeria pixel do desenho.
    if size >= 64:
        shadow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 110), (off, off + int(big * 0.012)), mask)
        shadow = shadow.filter(ImageFilter.GaussianBlur(big * 0.016))
        canvas = Image.alpha_composite(canvas, shadow)

    body = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    body.paste(_vertical_gradient(side, BG_TOP, BG_BOTTOM), (off, off), mask)
    canvas = Image.alpha_composite(canvas, body)

    # fio de luz na borda: separa o grafite do fundo escuro do Dock
    ring = Image.new("L", (big, big), 0)
    outline = [(off + x, off + y) for x, y in _squircle_points(side)]
    ImageDraw.Draw(ring).line(
        outline + [outline[0]],
        fill=255,
        width=max(1, int(round(big * 0.004))),
        joint="curve",
    )
    ring = Image.composite(ring, Image.new("L", (big, big), 0), mask_full(big, mask, off))
    rim = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    rim.paste(RIM, (0, 0), ring)
    canvas = Image.alpha_composite(canvas, rim)

    # símbolo
    mark_side = side * _mark_frac(size)
    mark_off = (big - mark_side) / 2
    mark_px = size * _squircle_frac(size) * _mark_frac(size)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mark(
        layer,
        box=(mark_off, mark_off, mark_side, mark_side),
        color=BRASS,
        stroke_units=stroke_for(mark_px),
        detail=detail_for(mark_px),
    )
    canvas = Image.alpha_composite(canvas, layer)

    return canvas.resize((size, size), Image.LANCZOS)


# --------------------------------------------------------------------------- #
# tray (template: o macOS usa só o alfa e inverte sozinho)
# --------------------------------------------------------------------------- #

# O tray-icon (0.24.1, macos/mod.rs:296) escala a NSImage para 18pt de altura,
# então a arte de 72 px cai em 36 px físicos numa tela Retina e em 18 px numa
# tela 1x. O alvo de legibilidade é esse, não os 72 px do arquivo.
#
# Por que a barra de baixo sai da silhueta do tray: com fill 0.94 em 18pt, 1
# unidade do viewBox = 0.77 px físico em Retina. O horizonte (y=24.5) e a barra
# (y=29) ficam a 4,5 unidades = 3,46 px de centro a centro, e o traço de 3,2
# unidades já tem 2,46 px, sobrando 1 px de respiro em Retina (mistura no
# antialias) e 0,5 px em 1x (funde de vez). Círculo, horizonte e mastro seguem;
# a barra é o elemento que morre primeiro e o que menos carrega a marca.
TRAY_DETAIL = DETAIL_MID
TRAY_STROKE = 3.2
TRAY_FILL = 0.94


def render_tray(size: int) -> Image.Image:
    return render_mark(
        size,
        color=(0, 0, 0, 255),
        fill_frac=TRAY_FILL,
        detail=TRAY_DETAIL,
        stroke_units=TRAY_STROKE,
    )


# --------------------------------------------------------------------------- #
# SVG
# --------------------------------------------------------------------------- #


def svg_mark() -> str:
    sw = 2.4
    paths = "\n  ".join(f'<path d="{path_d(p)}" />' for p in strokes_for("full"))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" fill="none"\n'
        '  stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"\n'
        f'  stroke-width="{sw}">\n'
        "  <!-- Frota · horizonte artificial. Gerado por scripts/brand/gen_icons.py -->\n"
        f'  <circle cx="{CIRCLE_CENTER[0]:g}" cy="{CIRCLE_CENTER[1]:g}" r="{CIRCLE_RADIUS:g}" />\n'
        f"  {paths}\n"
        "</svg>\n"
    )


def svg_icon(size: int = 64) -> str:
    """Ícone de app em SVG: mesmo squircle, mesmo símbolo, para web/favicon."""
    # squircle em Bézier: aproxima a superelipse com raio contínuo
    inset = (1 - SQUIRCLE_FRAC) / 2 * 44
    s = 44 - 2 * inset
    r = s * 0.2255
    x0, y0 = inset, inset
    x1, y1 = inset + s, inset + s
    k = r * 0.35  # controle: canto contínuo, não circular
    d = (
        f"M{x0 + r:.2f} {y0:.2f}H{x1 - r:.2f}C{x1 - k:.2f} {y0:.2f} {x1:.2f} {y0 + k:.2f} {x1:.2f} {y0 + r:.2f}"
        f"V{y1 - r:.2f}C{x1:.2f} {y1 - k:.2f} {x1 - k:.2f} {y1:.2f} {x1 - r:.2f} {y1:.2f}"
        f"H{x0 + r:.2f}C{x0 + k:.2f} {y1:.2f} {x0:.2f} {y1 - k:.2f} {x0:.2f} {y1 - r:.2f}"
        f"V{y0 + r:.2f}C{x0:.2f} {y0 + k:.2f} {x0 + k:.2f} {y0:.2f} {x0 + r:.2f} {y0:.2f}Z"
    )
    mark_side = s * MARK_IN_SQUIRCLE
    scale = mark_side / 44
    off = (44 - mark_side) / 2
    body = "\n    ".join(f'<path d="{path_d(p)}" />' for p in strokes_for("full"))
    top = "#%02x%02x%02x" % BG_TOP[:3]
    bottom = "#%02x%02x%02x" % BG_BOTTOM[:3]
    brass = "#%02x%02x%02x" % BRASS[:3]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 44 44">\n'
        "  <!-- Frota · ícone de app. Gerado por scripts/brand/gen_icons.py -->\n"
        "  <defs>\n"
        '    <linearGradient id="frota-bg" x1="0" y1="0" x2="0" y2="1">\n'
        f'      <stop offset="0" stop-color="{top}" />\n'
        f'      <stop offset="1" stop-color="{bottom}" />\n'
        "    </linearGradient>\n"
        "  </defs>\n"
        f'  <path d="{d}" fill="url(#frota-bg)" />\n'
        f'  <path d="{d}" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="0.6" />\n'
        f'  <g transform="translate({off:.3f} {off:.3f}) scale({scale:.5f})" fill="none"\n'
        f'     stroke="{brass}" stroke-linecap="round" stroke-linejoin="round" stroke-width="{stroke_for(1024 * MARK_IN_SQUIRCLE):g}">\n'
        f'    <circle cx="{CIRCLE_CENTER[0]:g}" cy="{CIRCLE_CENTER[1]:g}" r="{CIRCLE_RADIUS:g}" />\n'
        f"    {body}\n"
        "  </g>\n"
        "</svg>\n"
    )


# --------------------------------------------------------------------------- #
# containers
# --------------------------------------------------------------------------- #


def write_icns(dest: Path) -> None:
    """.icns via iconutil, com arte própria por tamanho (não upscale)."""
    sizes = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "frota.iconset"
        iconset.mkdir()
        cache: dict[int, Image.Image] = {}
        for name, px in sizes:
            if px not in cache:
                cache[px] = render_app_icon(px)
            cache[px].save(iconset / name)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(dest)],
            check=True,
        )


def write_ico(dest: Path, sizes=(16, 24, 32, 48, 64, 128, 256)) -> None:
    """.ico com arte própria por tamanho (não é upscale de uma imagem só).

    O `append_images` do Pillow faz cada entrada usar a imagem que casa com o
    tamanho pedido, então o 16 px sai com a silhueta reduzida e o 256 px com o
    símbolo cheio. As entradas ficam em PNG, que é o mesmo formato do `.ico`
    que o `tauri icon` gerou antes (Windows Vista+ lê).
    """
    arts = {px: render_app_icon(px) for px in sizes}
    biggest = arts[max(sizes)]
    biggest.save(
        dest,
        format="ICO",
        sizes=[(px, px) for px in sizes],
        append_images=[arts[px] for px in sizes if px != max(sizes)],
    )


# --------------------------------------------------------------------------- #
# preview
# --------------------------------------------------------------------------- #


def _template_on(bar: tuple[int, int, int], glyph: tuple[int, int, int], img: Image.Image):
    """Simula o que o macOS faz com um template: descarta a cor, usa o alfa."""
    out = Image.new("RGBA", img.size, bar + (255,))
    ink = Image.new("RGBA", img.size, glyph + (255,))
    out.paste(ink, (0, 0), img.split()[3])
    return out


def preview(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. tray: candidatos de silhueta, no tamanho real de render (36 px = 18pt
    #    em Retina, 18 px em tela 1x) e ampliados, nas duas barras.
    from frota_mark import DETAIL_FULL, DETAIL_SMALL

    cands = [
        ("cheio", DETAIL_FULL, 3.2),
        ("sem-barra", DETAIL_MID, 3.4),
        ("so-horizonte", DETAIL_SMALL, 3.6),
    ]
    pad, cell = 12, 160
    sheet = Image.new("RGBA", (pad + len(cands) * cell, 2 * cell + pad), (24, 24, 24, 255))
    for i, (name, detail, sw) in enumerate(cands):
        art = render_mark(72, color=(0, 0, 0, 255), fill_frac=TRAY_FILL, detail=detail, stroke_units=sw)
        for j, (bar, glyph) in enumerate([((245, 245, 245), (0, 0, 0)), ((44, 44, 44), (255, 255, 255))]):
            base = Image.new("RGBA", (cell, cell), bar + (255,))
            r36 = art.resize((36, 36), Image.LANCZOS)
            r18 = art.resize((18, 18), Image.LANCZOS)
            base.paste(_template_on(bar, glyph, r36), (10, 12))
            base.paste(_template_on(bar, glyph, r18), (56, 21))
            base.paste(
                _template_on(bar, glyph, r36).resize((108, 108), Image.NEAREST), (10, 48)
            )
            sheet.paste(base, (pad + i * cell, j * cell + pad // 2))
        art.save(out_dir / f"tray-{name}-72.png")
    sheet.save(out_dir / "tray-candidatos.png")

    # 2. ícone de app na escala inteira
    row = [16, 32, 64, 128, 256]
    w = sum(s for s in row) + 20 * len(row)
    sheet2 = Image.new("RGBA", (w, 300), (245, 245, 245, 255))
    sheet2.paste(Image.new("RGBA", (w, 150), (18, 18, 20, 255)), (0, 150))
    x = 10
    for s in row:
        icon = render_app_icon(s)
        sheet2.paste(icon, (x, 10), icon)
        sheet2.paste(icon, (x, 160), icon)
        x += s + 20
    sheet2.save(out_dir / "app-escala.png")
    render_app_icon(512).save(out_dir / "app-512.png")
    render_app_icon(128).resize((512, 512), Image.NEAREST).save(out_dir / "app-128-zoom.png")
    render_app_icon(32).resize((256, 256), Image.NEAREST).save(out_dir / "app-32-zoom.png")


# --------------------------------------------------------------------------- #


def write_all() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    (BRAND / "frota-mark.svg").write_text(svg_mark(), encoding="utf-8")
    (BRAND / "frota-icon.svg").write_text(svg_icon(), encoding="utf-8")
    (PUBLIC / "favicon.svg").write_text(svg_icon(), encoding="utf-8")

    for name, px in [
        ("32x32.png", 32),
        ("64x64.png", 64),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
    ]:
        render_app_icon(px).save(ICONS / name)

    write_icns(ICONS / "icon.icns")
    write_ico(ICONS / "icon.ico")

    render_tray(36).save(ICONS / "tray-template.png")
    render_tray(72).save(ICONS / "tray-template@2x.png")

    print("ícones escritos em", ICONS)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="escreve os ativos no repo")
    ap.add_argument("--preview", metavar="DIR", help="gera folhas de contato")
    args = ap.parse_args()
    if args.preview:
        preview(Path(args.preview))
        print("preview em", args.preview)
    if args.write:
        if not shutil.which("iconutil"):
            print("iconutil não encontrado (macOS): .icns não será gerado", file=sys.stderr)
            return 1
        write_all()
    if not args.write and not args.preview:
        ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
