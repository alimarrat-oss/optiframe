"""Génère la feuille de capture OptiFrame (PDF vectoriel, cotes exactes en mm).

Compatible avec la feuille déjà imprimée par l'équipe : 4 repères carrés (6 mm, point blanc)
dont les centres forment un rectangle de 100 x 70 mm, bordure passant par les centres, grille de 5 mm.
Ajouts : grille alignée sur les repères, barre d'orientation sous la grille, consignes FR/EN,
QR code de l'app (option --url).

python make_sheet.py --out feuille-capture-optiframe.pdf [--url https://...] [--page letter|a4]
"""
import argparse

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

GW, GH = 100.0, 70.0      # écart entre centres des repères (mm)
MARK = 6.0                # côté des repères
DOT = 1.8                 # diamètre du point blanc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='feuille-capture-optiframe.pdf')
    ap.add_argument('--url', default='')
    ap.add_argument('--page', default='letter', choices=['letter', 'a4'])
    a = ap.parse_args()
    page = letter if a.page == 'letter' else A4
    PW, PH = page[0] / mm, page[1] / mm
    c = canvas.Canvas(a.out, pagesize=page)
    c.setTitle('OptiFrame - feuille de capture 100 x 70 mm')
    c.setAuthor('OptiFrame (SN-SF / CodeML)')

    # repère : origine = centre du repère 1 (haut gauche), y vers le bas, en mm
    ox = (PW - GW) / 2
    oy_top = 62.0  # distance du haut de page au repère 1

    def P(x, y):
        return (ox + x) * mm, (PH - (oy_top + y)) * mm

    # --- titre (au-dessus de y = -35 mm : la bande -32..-12 mm reste blanche)
    c.setFillGray(0.08)
    c.setFont('Helvetica-Bold', 17)
    c.drawString(*P(-20, -48), 'OPTIFRAME  -  feuille de capture / capture sheet')
    c.setFont('Helvetica', 9.5)
    c.drawString(*P(-20, -41.5), 'Imprimer à 100 % (taille réelle), sans « ajuster à la page ».  Print at 100 % (actual size), no "fit to page".')
    c.drawString(*P(-20, -37), 'Vérifier à la règle : 100 mm entre les centres des repères 1 et 2, 70 mm entre 1 et 4.')

    # --- grille de 5 mm (traits fins), alignée sur les repères
    c.setStrokeGray(0.55)
    c.setLineWidth(0.12 * mm)
    for k in range(1, int(GW / 5)):
        x = 5 * k
        c.line(*P(x, 0), *P(x, GH))
    for k in range(1, int(GH / 5)):
        y = 5 * k
        c.line(*P(0, y), *P(GW, y))
    # bordure (passe par les centres des repères)
    c.setStrokeGray(0.1)
    c.setLineWidth(0.35 * mm)
    c.rect(*P(0, GH), GW * mm, GH * mm, stroke=1, fill=0)

    # --- repères
    for i, (x, y) in enumerate([(0, 0), (GW, 0), (GW, GH), (0, GH)]):
        c.setFillGray(0.0)
        c.rect(*P(x - MARK / 2, y + MARK / 2), MARK * mm, MARK * mm, stroke=0, fill=1)
        c.setFillGray(1.0)
        c.circle(*P(x, y), DOT / 2 * mm, stroke=0, fill=1)
        c.setFillGray(0.2)
        c.setFont('Helvetica', 9)
        lx = x - 7 if x == 0 else x + 4.5
        ly = y - 4.5 if y == 0 else y + 7.5
        c.drawString(*P(lx, ly), str(i + 1))

    # --- barre d'orientation (lève l'ambiguïté de 180°) : 30 x 2,5 mm, y = 80..82,5
    c.setFillGray(0.0)
    c.rect(*P(35, 82.5), 30 * mm, 2.5 * mm, stroke=0, fill=1)

    # --- consignes (bande 85..125 mm sous la grille)
    c.setFillGray(0.1)
    lines = [
        ('Helvetica-Bold', 10.5, '1. Feuille bien à plat, surface mate. Verre au centre de la grille, face bombée vers le haut,'),
        ('Helvetica', 10.5, '    tel qu\'on le voit de face sur les lunettes (côté nasal vers le centre des lunettes).'),
        ('Helvetica-Bold', 10.5, '2. Téléphone à plat, 20 à 30 cm au-dessus du verre, les 4 repères dans l\'image.'),
        ('Helvetica-Bold', 10.5, '3. Déplacez la lampe (pas la feuille) pour éviter les reflets sur le bord du verre.'),
        ('Helvetica-Oblique', 9, 'EN: sheet flat; lens in the middle, convex side up, as seen from the front; phone flat 20-30 cm above;'),
        ('Helvetica-Oblique', 9, '      keep the 4 markers in view; move the lamp, not the sheet, to remove glare on the lens edge.'),
    ]
    y = 91
    for font, size, txt in lines:
        c.setFont(font, size)
        c.drawString(*P(-20, y), txt)
        y += 6.2 if size > 10 else 5.0

    # --- contrôle d'échelle : 50 mm entre les centres des traits
    yb = 140
    c.setStrokeGray(0.0)
    c.setLineWidth(0.3 * mm)
    c.line(*P(0, yb), *P(50, yb))
    c.line(*P(0, yb - 2.5), *P(0, yb + 2.5))
    c.line(*P(50, yb - 2.5), *P(50, yb + 2.5))
    c.setFont('Helvetica', 9)
    c.drawString(*P(54, yb + 1.2), 'Contrôle : 50 mm / check: 50 mm')
    # petites graduations au mm sur 50 mm (pour vérifier facilement à la règle)
    c.setLineWidth(0.1 * mm)
    for k in range(51):
        h = 1.6 if k % 10 == 0 else (1.1 if k % 5 == 0 else 0.6)
        c.line(*P(k, yb + 3.5), *P(k, yb + 3.5 + h))

    # --- QR code de l'application
    if a.url:
        qr = QrCodeWidget(a.url)
        b = qr.getBounds()
        s = 26 * mm
        d = Drawing(s, s, transform=[s / (b[2] - b[0]), 0, 0, s / (b[3] - b[1]), 0, 0])
        d.add(qr)
        x, y2 = P(GW - 26, yb + 14)
        renderPDF.draw(d, c, x, y2)
        c.setFont('Helvetica', 7.5)
        c.drawString(*P(GW - 26, yb + 17.5), a.url[:60])

    c.setFont('Helvetica', 7.5)
    c.setFillGray(0.4)
    c.drawString(*P(-20, PH - oy_top - 12), 'OptiFrame - SN-SF / CodeML 2026 - repères : carrés de 6 mm, centres à 100 x 70 mm - grille 5 mm')
    c.showPage()
    c.save()
    print('écrit', a.out, a.page)


if __name__ == '__main__':
    main()
