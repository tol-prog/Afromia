'use strict';
/**
 * Batch completion certificates: one page per trainee, reusing the sample
 * Certf.pdf's exact static background (embedded once, referenced on every
 * page) with the trainee name + Reg.No. rendered via the same cursive font
 * the original used, composited as a small transparent overlay image
 * (sharp/SVG) because that font isn't reliably embeddable as a PDF text
 * font from Node without extra native tooling -- pre-rasterizing it here
 * gets pixel-identical results to the Python reference build.
 */
const fs = require('fs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { ensureFontconfig, imagePath, fontPath } = require('./shared');

const PAGE_W = 594.96;
const PAGE_H = 841.92;
const BG_W = 1819;
const BG_H = 2573;
const SCALE_X = BG_W / PAGE_W;
const SCALE_Y = BG_H / PAGE_H;

const NAME_BOX = { top: 327.96, bottom: 363.96, x0: 150, x1: 470, fontSize: 36 };
const REGNO_BOX = { top: 615.78, bottom: 635.7, x0: 220, x1: 350, fontSize: 19.92 };
const DATE_BOX = { top: 763.96, bottom: 775.0, x0: 425.52, x1: 560, fontSize: 11.04 };
const INK = '#1e1b42';

// The custom cursive fonts (AfromiaCertName/RegNo/Date) are hand-built with
// only the handful of glyphs their original calibration text needed --
// AfromiaCertName is missing I O P Q U V X Y Z (and lowercase p q v x, and
// the apostrophe), and RegNo/Date only cover "A"+digits+hyphen and the
// literal string "August, 2026" respectively. Without a fallback, any
// trainee name containing one of those letters (e.g. "Yeshi", anything with
// a "Y") renders that letter as a blank/notdef box. 'Nothing You Could Do'
// (bundled below, OFL-licensed) is listed as a CSS font-family fallback so
// the SVG renderer substitutes a legible handwriting-style glyph for
// anything the primary font can't draw, instead of a broken box.
const SCRIPT_FALLBACK = "'Nothing You Could Do'";

/**
 * Renders `text` to a tightly-cropped transparent PNG (trimmed to its ink
 * bounding box). Returned `width`/`height` are the trimmed image size in
 * px, used both to scale the image down to fit `maxWidthPt` and to center
 * it inside its target box (see `boxCenterPdfY` below) -- centering on the
 * box rather than trying to reproduce one exact baseline is what makes
 * this robust across names with wildly different ascenders/descenders.
 */
async function renderTextPng(text, fontFamily, fontSizePt, maxWidthPt, color = INK) {
  const sizePx = Math.round(fontSizePt * SCALE_Y);
  const approxWidthPx = text.length * sizePx * 0.7 + 80;
  const canvasW = Math.max(200, Math.ceil(approxWidthPx));
  const baselineY = Math.round(sizePx * 1.3);
  const canvasH = Math.round(sizePx * 1.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
    <text x="0" y="${baselineY}" font-family="${fontFamily}, ${SCRIPT_FALLBACK}" font-size="${sizePx}" fill="${color}">${escapeXml(text)}</text>
  </svg>`;
  const raw = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(raw).trim().raw().toBuffer({ resolveWithObject: true });
  let width = info.width;
  let height = info.height;
  let buffer = await sharp(data, { raw: { width, height, channels: info.channels } }).png().toBuffer();

  const maxWidthPx = maxWidthPt * SCALE_X;
  if (width > maxWidthPx) {
    const scale = maxWidthPx / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    buffer = await sharp(buffer).resize({ width, height }).png().toBuffer();
  }
  return { buffer, width, height };
}

/** Converts a pdfplumber-style box (top/bottom measured down from the page
 * top, as extracted straight off the original sample PDF) into the
 * vertical center of that box in pdf-lib's bottom-up page coordinates. */
function boxCenterPdfY(box) {
  const topPdf = PAGE_H - box.top;
  const bottomPdf = PAGE_H - box.bottom;
  return (topPdf + bottomPdf) / 2;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateCertificatesPdf(cohortData) {
  ensureFontconfig();
  const pdfDoc = await PDFDocument.create();
  const bgBytes = fs.readFileSync(imagePath('certificate_bg.png'));
  const bgImage = await pdfDoc.embedPng(bgBytes);

  const dateLabel = cohortData.meta.certDateLabel || 'August, 2026';
  const dateOverlay = await renderTextPng(dateLabel, 'AfromiaCertDate', DATE_BOX.fontSize, DATE_BOX.x1 - DATE_BOX.x0);
  const dateImg = await pdfDoc.embedPng(dateOverlay.buffer);

  const nameCenterX = (NAME_BOX.x0 + NAME_BOX.x1) / 2 + 18.6;
  const regnoCenterX = (REGNO_BOX.x0 + REGNO_BOX.x1) / 2 + 13.65;

  for (const t of cohortData.trainees) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawImage(bgImage, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

    const nameOverlay = await renderTextPng(t.fullName, 'AfromiaCertName', NAME_BOX.fontSize, NAME_BOX.x1 - NAME_BOX.x0);
    const nameImg = await pdfDoc.embedPng(nameOverlay.buffer);
    const nameWPt = nameOverlay.width / SCALE_X;
    const nameHPt = nameOverlay.height / SCALE_Y;
    page.drawImage(nameImg, {
      x: nameCenterX - nameWPt / 2,
      y: boxCenterPdfY(NAME_BOX) - nameHPt / 2,
      width: nameWPt,
      height: nameHPt,
    });

    const regnoOverlay = await renderTextPng(t.regNo, 'AfromiaCertRegNo', REGNO_BOX.fontSize, REGNO_BOX.x1 - REGNO_BOX.x0);
    const regnoImg = await pdfDoc.embedPng(regnoOverlay.buffer);
    const regnoWPt = regnoOverlay.width / SCALE_X;
    const regnoHPt = regnoOverlay.height / SCALE_Y;
    page.drawImage(regnoImg, {
      x: regnoCenterX - regnoWPt / 2,
      y: boxCenterPdfY(REGNO_BOX) - regnoHPt / 2,
      width: regnoWPt,
      height: regnoHPt,
    });

    const dateWPt = dateOverlay.width / SCALE_X;
    const dateHPt = dateOverlay.height / SCALE_Y;
    page.drawImage(dateImg, {
      x: DATE_BOX.x0,
      y: boxCenterPdfY(DATE_BOX) - dateHPt / 2,
      width: dateWPt,
      height: dateHPt,
    });
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateCertificatesPdf };
