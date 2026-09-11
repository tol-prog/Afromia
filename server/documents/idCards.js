'use strict';
/**
 * OCA admission (ID) cards: 4 landscape cards per A4 page (2x2 grid), each
 * rotated 90 degrees, matching the sample ID_4_by_4.pdf layout (Oromia
 * government seal, agency header, trainee fields, legal disclaimer,
 * coordinator signature line, blank stamp/photo box).
 *
 * Ported from /home/claude/afromia-docs/scripts/gen_id_cards.py, which used
 * reportlab's canvas.translate/rotate(90)/translate transform stack so the
 * whole card could be drawn in a simple local landscape coordinate system
 * (origin bottom-left, CARD_W x CARD_H) and come out correctly rotated in
 * its quadrant. pdf-lib has no such transform stack, and an initial attempt
 * to reproduce it by drawing each card unrotated onto its own scratch page
 * and embedding+rotating that page as an XObject (pdf-lib's embedPage/
 * drawPage) produced corrupt output once more than one card's worth of
 * fonts/images were embedded this way (confirmed against both poppler and
 * qpdf: real resource-dictionary wiring bugs, not just a poppler quirk) --
 * abandoned in favor of the approach below.
 *
 * Instead, every element is drawn directly on the real output page, with
 * its local (card-space) anchor point run through `toPage()`, which
 * reproduces the exact composed matrix
 * translate(cellCx,cellCy) . rotate(90) . translate(-CARD_W/2,-CARD_H/2)
 * that the Python version applied via its canvas transform stack (derived
 * analytically -- see toPage below) -- and `rotate: degrees(90)` is passed
 * to every drawText/drawRectangle/drawImage call so each element's own
 * orientation rotates too, exactly as it would under a rotated canvas.
 */
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { imagePath, ASSESSMENT_CENTER, OCCUPATION } = require('./shared');

const PAGE_W = 595.2;
const PAGE_H = 841.8;
const MARGIN = 18;
const CELL_W = (PAGE_W - 2 * MARGIN) / 2;
const CELL_H = (PAGE_H - 2 * MARGIN) / 2;

const CARD_W = 380; // logical landscape card width (becomes vertical extent after rotation)
const CARD_H = 258; // logical landscape card height (becomes horizontal extent after rotation)
const ROT = degrees(90);

const NAVY = rgb(0x1c / 255, 0x3f / 255, 0x94 / 255);
const ORANGE = rgb(0xe0 / 255, 0x7b / 255, 0x1a / 255);
const BLACK = rgb(0.067, 0.067, 0.067);

/**
 * Builds the local-card-space -> page-space transform for one 90-degree-
 * rotated card centered in a grid cell (cellCx, cellCy). See the file
 * header for the derivation; this is the anchor-point half of it. Every
 * draw call below supplies its own *local, unrotated* anchor (as if
 * drawing the card in isolation, origin bottom-left) and gets back the
 * (x, y) to actually draw at, with `rotate: degrees(90)` handling the
 * element's own orientation.
 */
function makeTransform(cellCx, cellCy) {
  return function toPage(lx, ly) {
    return { x: cellCx + CARD_H / 2 - ly, y: cellCy + lx - CARD_W / 2 };
  };
}

function drawCard(page, toPage, fonts, seal, t, assessmentBranch) {
  const { timesBold, times, timesBoldItalic, timesItalic } = fonts;

  const rect = (lx, ly, width, height, borderColor, borderWidth) => {
    const { x, y } = toPage(lx, ly);
    page.drawRectangle({ x, y, width, height, borderColor, borderWidth, rotate: ROT });
  };
  const text = (lx, ly, str, size, font, color = BLACK) => {
    const { x, y } = toPage(lx, ly);
    page.drawText(str, { x, y, size, font, color, rotate: ROT });
  };
  const image = (lx, ly, width, height, img) => {
    const { x, y } = toPage(lx, ly);
    page.drawImage(img, { x, y, width, height, rotate: ROT });
  };
  const line = (lx0, ly0, lx1, ly1, color, thickness) => {
    const p0 = toPage(lx0, ly0);
    const p1 = toPage(lx1, ly1);
    page.drawLine({ start: p0, end: p1, color, thickness });
  };
  /** Draws a "Label  value" pair with the value underlined (a blank line
   * when the value is empty, so the card still shows a fillable slot
   * rather than looking broken). */
  const labeledUnderlineField = (lx, ly, label, value, size, font, minWidth = 26) => {
    text(lx, ly, label, size, font);
    const labelW = font.widthOfTextAtSize(label, size);
    const valueX = lx + labelW;
    if (value) text(valueX, ly, value, size, font);
    const valueW = Math.max(font.widthOfTextAtSize(value || '', size), minWidth);
    line(valueX, ly - 2.6, valueX + valueW, ly - 2.6, BLACK, 0.6);
  };

  rect(2, 2, CARD_W - 4, CARD_H - 4, NAVY, 1.6);
  rect(6, 6, CARD_W - 12, CARD_H - 12, NAVY, 0.6);

  const sealSize = 46;
  const sealX = 14;
  const sealY = CARD_H - 14 - sealSize;
  if (seal) {
    image(sealX, sealY, sealSize, sealSize, seal);
  }

  const textX = sealX + sealSize + 10;
  let y = CARD_H - 22;
  text(textX, y, 'OROMIA REGIONAL GOVERNMENT', 8.6, timesBold);
  y -= 10;
  text(textX, y, 'OROMIA OCCUPATIONAL COMPETENCY', 8.6, timesBold);
  y -= 10;
  text(textX, y, 'ASSURANCE AGENCY', 8.6, timesBold);
  y -= 11;
  text(textX, y, assessmentBranch, 9.2, timesBold);

  const admissionLabel = 'ADMISSION CARD – 2026 (2018 E.C.)';
  const admissionW = timesBoldItalic.widthOfTextAtSize(admissionLabel, 8.6);
  text(CARD_W / 2 - admissionW / 2, sealY - 12, admissionLabel, 8.6, timesBoldItalic);
  line(18, sealY - 16, CARD_W - 18, sealY - 16, NAVY, 0.7);

  let fy = sealY - 32;
  const lineGap = 13.2;
  text(16, fy, 'Full Name:', 9.6, timesBold);
  text(80, fy, t.fullName, 9.6, times);
  fy -= lineGap;

  text(16, fy, 'Reg.No.', 9.6, timesBold);
  text(56, fy, t.regNo, 9.6, times);
  fy -= lineGap;

  labeledUnderlineField(16, fy, 'Age  ', t.age != null ? String(t.age) : '', 9.6, timesBoldItalic);
  labeledUnderlineField(120, fy, 'Sex  ', t.sex || '', 9.6, timesBoldItalic);
  fy -= lineGap;

  text(16, fy, `Occupation: ${OCCUPATION}`, 9.6, timesBoldItalic);
  fy -= lineGap;
  text(16, fy, `Assessment Center: ${ASSESSMENT_CENTER}`, 9.6, timesBoldItalic);
  fy -= lineGap + 2;

  const disclaimer = [
    'This card is to be presented by the candidate at the session of the',
    'assessment for which he/she is registered. It is illegal for the',
    "candidate to attempt to sit for the occupation for which he/she is not",
    'registered.',
  ];
  for (const dline of disclaimer) {
    text(16, fy, dline, 6.9, timesItalic);
    fy -= 8.6;
  }

  const coordLabel = 'Assessment Center Coordinator';
  const coordW = timesBold.widthOfTextAtSize(coordLabel, 8.4);
  text(CARD_W / 2 - 30 - coordW / 2, 16, coordLabel, 8.4, timesBold);
  line(CARD_W / 2 - 78, 24, CARD_W / 2 + 18, 24, NAVY, 0.6);

  const boxW = 46;
  const boxH = 32;
  rect(CARD_W - boxW - 14, 10, boxW, boxH, ORANGE, 1.1);
}

async function generateIdCardsPdf(cohortData) {
  const assessmentBranch = cohortData.meta.assessmentBranch || 'AMBO BRANCH';

  const outDoc = await PDFDocument.create();
  const timesBold = await outDoc.embedFont(StandardFonts.TimesRomanBold);
  const times = await outDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldItalic = await outDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const timesItalic = await outDoc.embedFont(StandardFonts.TimesRomanItalic);
  const fonts = { timesBold, times, timesBoldItalic, timesItalic };

  let seal = null;
  const sealPath = imagePath('oromia_seal.png');
  if (fs.existsSync(sealPath)) {
    seal = await outDoc.embedPng(fs.readFileSync(sealPath));
  }

  const slots = [
    { x: MARGIN, y: PAGE_H - MARGIN - CELL_H }, // top-left
    { x: MARGIN + CELL_W, y: PAGE_H - MARGIN - CELL_H }, // top-right
    { x: MARGIN, y: MARGIN }, // bottom-left
    { x: MARGIN + CELL_W, y: MARGIN }, // bottom-right
  ];

  let page = null;
  cohortData.trainees.forEach((t, i) => {
    const slotIdx = i % 4;
    if (slotIdx === 0) {
      page = outDoc.addPage([PAGE_W, PAGE_H]);
    }
    const { x: sx, y: sy } = slots[slotIdx];
    const cellCx = sx + CELL_W / 2;
    const cellCy = sy + CELL_H / 2;
    const toPage = makeTransform(cellCx, cellCy);
    drawCard(page, toPage, fonts, seal, t, assessmentBranch);
  });

  return Buffer.from(await outDoc.save());
}

module.exports = { generateIdCardsPdf };
