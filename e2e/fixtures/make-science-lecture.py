# Writes science-lecture.pdf: a 3-page lecture with the notation Bradley wants captured exactly
# (binomial names, gene/protein names, formulas with sub/superscripts, equations, Greek letters,
# arrows, units, ranges, negatives, decimals). Used by the extraction tests and the e2e test
# "science notation survives extraction, cards and display".
#
# Page 1 and 2 use real Unicode glyphs (embedded DejaVu Sans, like PDFs from LaTeX/Google Docs).
# Page 3 draws subscripts and superscripts the way Word does: ordinary digits, smaller and
# shifted (so text extraction sees "H2O"), plus an "fi" ligature glyph.
# Run: python3 e2e/fixtures/make-science-lecture.py   (needs reportlab and DejaVu Sans)
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate

pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
body = ParagraphStyle("body", fontName="DejaVu", fontSize=11, leading=16, spaceAfter=8)
head = ParagraphStyle("head", parent=body, fontSize=15, leading=20, spaceAfter=10)

PAGE1 = [
    "Lecture 7: Molecules of life",
    "Escherichia coli (E. coli) is a Gram-negative bacterium that lives in the gut of Homo sapiens.",
    "Photosynthesis is summarised by the equation 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂, which takes place in the chloroplast.",
    "Each water molecule, H₂O, has a bond angle of about 104.5°. Glucose, C₆H₁₂O₆, has a molar mass of 180.16 g/mol.",
    "The sulfate ion SO₄²⁻ carries a charge of −2, while the calcium ion Ca²⁺ carries a charge of +2.",
    "Carbonic acid dissociates reversibly: H₂CO₃ ⇌ H⁺ + HCO₃⁻.",
    "The tumour suppressor gene BRCA1 is linked to breast cancer, and the protein p53 halts the cell cycle when DNA is damaged.",
    "The Na⁺/K⁺-ATPase pumps 3 Na⁺ ions out of the cell and 2 K⁺ ions in for every ATP hydrolysed.",
]
PAGE2 = [
    "Lecture 7: Energy and structure",
    "Gibbs free energy change is given by ΔG = ΔH − TΔS; a reaction is spontaneous when ΔG is negative.",
    "Einstein's mass–energy equivalence is written E = mc².",
    "The acidity of a solution is defined as pH = −log[H⁺]; human arterial blood has a pH of 7.35–7.45.",
    "In proteins, the α-helix has 3.6 residues per turn, and β-sheets are held together by hydrogen bonds between strands.",
    "A typical animal cell is 10–30 µm across, and the resting membrane potential is −70 mV.",
    "Enzymes in the human body work best at 37 °C; the concentration of glucose in blood is about 5.5 mmol·L⁻¹.",
    "The rate constant k doubled from 0.012 s⁻¹ to 0.024 s⁻¹ when the temperature rose by 10 °C.",
]
PAGE3 = [
    "Lecture 7: Word-style notation",
    "Respiration releases energy: C<sub>6</sub>H<sub>12</sub>O<sub>6</sub> + 6O<sub>2</sub> → 6CO<sub>2</sub> + 6H<sub>2</sub>O.",
    "Calcium ions (Ca<super>2+</super>) trigger muscle contraction; the speed of light c is 3.0 × 10<super>8</super> m/s.",
    "Mitochondrial efﬁciency is limited because some energy is lost as heat during oxidative phosphorylation.",
    "Water freezes at 0 °C and the lowest temperature on the Kelvin scale is −273.15 °C.",
]

story = []
for i, page in enumerate([PAGE1, PAGE2, PAGE3]):
    story.append(Paragraph(page[0], head))
    story += [Paragraph(t, body) for t in page[1:]]
    if i < 2:
        story.append(PageBreak())
out = Path(__file__).with_name("science-lecture.pdf")
SimpleDocTemplate(str(out), pagesize=A4, title="Lecture 7", author="StudyNest QA", invariant=1).build(story)
print("wrote", out)
