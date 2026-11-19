'use strict';
/**
 * OCA admission (ID) cards -- "Candidate Identification Card Form"
 * (OF/OCAPD/002): 4 landscape cards per A4 page (2x2 grid), each rotated 90
 * degrees. Redrawn to match the current official issue of the card (as
 * supplied in Admission_card.pub): the same OCA letterhead table used on
 * the application form (logo, trilingual agency name, document number,
 * title, issue/page number) -- scaled down to fit the card -- followed by
 * the Brach/Full Name/Reg.No/Age/Sex/Occupation fields, a labeled 3x4
 * photo box, the Assessment Center field, the legal disclaimer, and the
 * coordinator signature line.
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
const {
  imagePath, embedEthiopicFont, ASSESSMENT_CENTER, OCCUPATION,
  OCA_AGENCY_NAME_OM, OCA_AGENCY_NAME_AM, OCA_AGENCY_NAME_EN, OCA_COMPANY_LABEL_OM, OCA_COMPANY_LABEL_EN,
  OCA_DOCNO_LABEL_OM, OCA_DOCNO_LABEL_EN, OCA_TITLE_LABEL_OM, OCA_ISSUE_NO,
  DOC_NO_ID_CARD, ID_CARD_TITLE_OM,
} = require('./shared');

const PAGE_W = 595.2;
const PAGE_H = 841.8;
const MARGIN = 18;
const CELL_W = (PAGE_W - 2 * MARGIN) / 2;
const CELL_H = (PAGE_H - 2 * MARGIN) / 2;

const CARD_W = 380; // logical landscape card width (becomes vertical extent after rotation)
const CARD_H = 258; // logical landscape card height (becomes horizontal extent after rotation)
const ROT = degrees(90);

const NAVY = rgb(0x1c / 255, 0x3f / 255, 0x94 / 255);
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

function drawCard(page, toPage, fonts, seal, t, assessmentBranch, assessmentCenter, occupation) {
  const { bold, reg, boldItalic, italic, amharic } = fonts;

  const rect = (lx, ly, width, height, borderColor, borderWidth) => {
    const { x, y } = toPage(lx, ly);
    page.drawRectangle({ x, y, width, height, borderColor, borderWidth, rotate: ROT });
  };
  const text = (lx, ly, str, size, font, color = BLACK) => {
    const { x, y } = toPage(lx, ly);
    page.drawText(str, { x, y, size, font, color, rotate: ROT });
  };
  const centerText = (lx, ly, str, widthSpan, size, font, color = BLACK) => {
    const w = font.widthOfTextAtSize(str, size);
    text(lx + (widthSpan - w) / 2, ly, str, size, font, color);
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
    line(valueX, ly - 2.4, valueX + valueW, ly - 2.4, BLACK, 0.5);
  };

  rect(2, 2, CARD_W - 4, CARD_H - 4, NAVY, 1.6);
  rect(6, 6, CARD_W - 12, CARD_H - 12, NAVY, 0.6);

  // ---- OCA letterhead table: same design as the application form's, at
  // card scale (logo + trilingual agency name + doc number, then title +
  // issue/page number) ----
  const tx = 10;
  const tw = CARD_W - 20; // 360
  const logoColW = 56;
  const issueColW = 40;
  const pageColW = 34;
  const rightColW = issueColW + pageColW; // 74
  const mainColW = tw - logoColW - rightColW; // 230
  const row1H = 50;
  const row2H = 30;
  const yTop = CARD_H - 8; // 250
  const yRow1Bot = yTop - row1H; // 200
  const yRow2Bot = yRow1Bot - row2H; // 170

  rect(tx, yRow2Bot, tw, row1H + row2H, BLACK, 1);
  line(tx, yRow1Bot, tx + tw, yRow1Bot, BLACK, 1);
  line(tx + logoColW, yTop, tx + logoColW, yRow1Bot, BLACK, 1);
  line(tx + logoColW + mainColW, yTop, tx + logoColW + mainColW, yRow2Bot, BLACK, 1);
  line(tx + logoColW + mainColW + issueColW, yRow1Bot, tx + logoColW + mainColW + issueColW, yRow2Bot, BLACK, 1);

  if (seal) {
    const s = 36;
    image(tx + (logoColW - s) / 2, yRow1Bot + (row1H - s) / 2, s, s, seal);
  }

  // company-name block (row 1, middle column)
  const midX = tx + logoColW + 6;
  let ty = yTop - 8;
  text(midX, ty, OCA_COMPANY_LABEL_OM, 5.4, reg);
  ty -= 7;
  text(midX, ty, OCA_COMPANY_LABEL_EN, 5.4, reg);
  ty -= 9;
  text(midX, ty, OCA_AGENCY_NAME_OM, 7, bold, NAVY);
  ty -= 8.5;
  text(midX, ty, OCA_AGENCY_NAME_AM, 7, amharic, NAVY);
  ty -= 8.5;
  text(midX, ty, OCA_AGENCY_NAME_EN, 6.8, bold, NAVY);

  // document number block (row 1, right column)
  const docX = tx + logoColW + mainColW + 6;
  let dy = yTop - 8;
  text(docX, dy, OCA_DOCNO_LABEL_OM, 5.4, reg);
  dy -= 7;
  text(docX, dy, OCA_DOCNO_LABEL_EN, 5.4, reg);
  dy -= 14;
  text(docX, dy, DOC_NO_ID_CARD, 8, bold);

  // title row (row 2)
  text(tx + 5, yRow1Bot - 10, OCA_TITLE_LABEL_OM, 5.8, reg);
  centerText(tx + logoColW, yRow1Bot - 10, ID_CARD_TITLE_OM[0], mainColW, 6.6, bold);
  centerText(tx + logoColW, yRow1Bot - 20, ID_CARD_TITLE_OM[1], mainColW, 6.6, bold);

  // issue no / page no (row 2, right two columns) -- labels wrapped onto
  // two short lines so they fit their narrow columns without colliding.
  const issueX = tx + logoColW + mainColW + 4;
  text(issueX, yRow1Bot - 7, 'Lakk.Maxxans', 4.4, reg);
  text(issueX, yRow1Bot - 13, 'aa/Issue No.', 4.4, reg);
  text(issueX, yRow1Bot - 25, OCA_ISSUE_NO, 7, bold);
  const pageX = tx + logoColW + mainColW + issueColW + 4;
  text(pageX, yRow1Bot - 7, 'Fuula/Page', 4.4, reg);
  text(pageX, yRow1Bot - 13, 'No.', 4.4, reg);
  text(pageX, yRow1Bot - 25, 'Page 1 of 1', 4.8, boldItalic);

  // ---- trainee fields ----
  let fy = yRow2Bot - 14; // 156
  const lineGap = 14;
  labeledUnderlineField(16, fy, 'Brach: ', assessmentBranch || '', 8.6, bold, 150);
  fy -= lineGap;
  labeledUnderlineField(16, fy, 'Full Name: ', t.fullName || '', 8.6, bold, 190);
  fy -= lineGap;
  labeledUnderlineField(16, fy, 'Reg.No. ', t.regNo || '', 8.6, bold, 190);
  fy -= lineGap;
  labeledUnderlineField(16, fy, 'Age ', t.age != null ? String(t.age) : '', 8.6, boldItalic, 30);
  labeledUnderlineField(130, fy, 'Sex ', t.sex || '', 8.6, boldItalic, 40);
  fy -= lineGap;
  labeledUnderlineField(16, fy, 'Occupation ', occupation, 8.6, boldItalic, 150);
  fy -= lineGap + 8;

  // 3x4 photo box -- top-right, below the header, clear of the field rows
  // above (which stop well short of it, see labeledUnderlineField minWidths).
  const boxW = 50;
  const boxH = 66;
  const boxX = CARD_W - boxW - 12;
  const boxY = yRow2Bot - 6 - boxH;
  rect(boxX, boxY, boxW, boxH, NAVY, 1);
  centerText(boxX, boxY + boxH - 11, '3x4', boxW, 7.6, italic);

  // Assessment Center (below the photo box, full width again)
  const acLabel = 'Assessment Center : ';
  text(16, fy, acLabel, 8.6, bold);
  const acLabelW = bold.widthOfTextAtSize(acLabel, 8.6);
  if (assessmentCenter) text(16 + acLabelW, fy, assessmentCenter, 8.6, bold);
  const acValueW = Math.max(bold.widthOfTextAtSize(assessmentCenter || '', 8.6), 110);
  line(16 + acLabelW, fy - 2.4, 16 + acLabelW + acValueW, fy - 2.4, BLACK, 0.5);
  fy -= lineGap + 2;

  const disclaimer = [
    'This card is to be presented by the candidate at the session of the',
    'assessment for which he/she is registered. It is illegal for the',
    'candidate to attempt to sit for the occupation for which he/she is',
    'not registered.',
  ];
  for (const dline of disclaimer) {
    text(16, fy, dline, 6.6, italic);
    fy -= 8.4;
  }

  const coordLabel = 'Assessment Center Coordinator';
  const coordW = bold.widthOfTextAtSize(coordLabel, 8);
  text(CARD_W / 2 - coordW / 2, 12, coordLabel, 8, bold);
  line(CARD_W / 2 - 70, 20, CARD_W / 2 + 70, 20, NAVY, 0.6);
}

async function generateIdCardsPdf(cohortData) {
  const assessmentBranch = cohortData.meta.assessmentBranch || 'AMBO BRANCH';
  const assessmentCenter = cohortData.meta.assessmentCenter || ASSESSMENT_CENTER;
  const occupation = cohortData.meta.occupation || OCCUPATION;

  const outDoc = await PDFDocument.create();
  const bold = await outDoc.embedFont(StandardFonts.TimesRomanBold);
  const reg = await outDoc.embedFont(StandardFonts.TimesRoman);
  const boldItalic = await outDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const italic = await outDoc.embedFont(StandardFonts.TimesRomanItalic);
  const amharic = await embedEthiopicFont(outDoc);
  const fonts = { bold, reg, boldItalic, italic, amharic };

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
    drawCard(page, toPage, fonts, seal, t, assessmentBranch, assessmentCenter, occupation);
  });

  return Buffer.from(await outDoc.save());
}

module.exports = { generateIdCardsPdf };
