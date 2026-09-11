'use strict';
/**
 * COC (Oromia Occupational Competence Assurance Agency) reporting /
 * transmittal letter for a batch -- requests assessment for the trainees
 * who completed training. Matches the format of the sample Xalayaa_AFR.docx
 * (same letterhead, wording, stamp, and signature), but data-driven so it
 * regenerates correctly for any future batch: male/female/total counts and
 * the training date range come from the batch's own trainee/cohort data.
 * The only two things that are NOT derivable from that data are the
 * institute's own outgoing reference number and (optionally) the letter's
 * sign-off date -- both are passed in by the caller (the /api/reports
 * route), defaulting to today's date when no sign-off date is given.
 *
 * Ported from the validated Python reference at
 * /home/claude/afromia-docs/scripts/gen_coc_report.py -- same layout,
 * wording and static institutional facts.
 */
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { imagePath, fmtEcDate } = require('./shared');

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0, 0, 0);

// Static institutional facts (same for every batch, like the certificate's
// signatories) -- change here once if the institute updates them.
const COC_OFFICE = 'Ejeensii Mirkaneessa Gahumsa Ogummaa Oromiyaa Adaamatiif';
const COC_OFFICE_CITY = 'Adaama';
const CC_OFFICE = 'Ejeensii MGO Oromiyaa Damee Ambootiif';
const CC_CITY = 'Amboo';
const SIGNATORY_NAME = 'Ibsituu Qannaa';
const SIGNATORY_TITLE = 'Itti Gaafatamtuu Dhaabbatichaa';

/** Splits `markup` (plain text with <b>...</b> spans) into
 * {text, bold}[] word tokens, splitting on whitespace but keeping each
 * word's bold flag so the line-wrapper below can pick the right font
 * per word while still wrapping at word boundaries. */
function tokenize(markup) {
  const tokens = [];
  const re = /<b>(.*?)<\/b>|([^<]+)/g;
  let m;
  while ((m = re.exec(markup))) {
    const [, boldText, plainText] = m;
    const bold = boldText != null;
    const text = bold ? boldText : plainText;
    for (const word of text.split(/(\s+)/)) {
      if (word === '') continue;
      tokens.push({ text: word, bold });
    }
  }
  return tokens;
}

/** Word-wraps `tokens` (as produced by tokenize) to `maxWidth`, returning
 * an array of lines, each an array of {text, bold} word/space tokens. */
function wrapTokens(tokens, font, boldFont, size, maxWidth) {
  const lines = [];
  let line = [];
  let lineWidth = 0;
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok.text);
    const f = tok.bold ? boldFont : font;
    const w = f.widthOfTextAtSize(tok.text, size);
    if (!isSpace && lineWidth + w > maxWidth && line.length) {
      // drop a trailing space token before wrapping
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
      lines.push(line);
      line = [];
      lineWidth = 0;
    }
    line.push(tok);
    lineWidth += w;
  }
  if (line.length) {
    while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
    lines.push(line);
  }
  return lines;
}

function drawJustifiedLines(page, lines, font, boldFont, size, leading, x, topY, maxWidth, justifyAllButLast = true) {
  let y = topY;
  lines.forEach((line, idx) => {
    const isLast = idx === lines.length - 1;
    const naturalWidth = line.reduce((sum, tok) => sum + (tok.bold ? boldFont : font).widthOfTextAtSize(tok.text, size), 0);
    const spaceTokens = line.filter((t) => /^\s+$/.test(t.text));
    const extra = !isLast && justifyAllButLast && spaceTokens.length ? (maxWidth - naturalWidth) / spaceTokens.length : 0;

    let cx = x;
    for (const tok of line) {
      const f = tok.bold ? boldFont : font;
      const w = f.widthOfTextAtSize(tok.text, size);
      if (!/^\s+$/.test(tok.text)) {
        page.drawText(tok.text, { x: cx, y, size, font: f, color: INK });
      }
      cx += w + (/^\s+$/.test(tok.text) ? extra : 0);
    }
    y -= leading;
  });
  return y;
}

async function generateCocReportPdf(cohortData, options = {}) {
  const { refNo, letterDate } = options;
  const trainees = cohortData.trainees;
  const male = trainees.filter((t) => t.sex === 'M').length;
  const female = trainees.filter((t) => t.sex === 'F').length;
  const total = trainees.length;

  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const letterheadBytes = fs.readFileSync(imagePath('coc_letterhead.png'));
  const letterhead = await pdfDoc.embedPng(letterheadBytes);
  page.drawImage(letterhead, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  let y = PAGE_H - 150;
  page.drawText(`Lakk ${refNo || ''}`, { x: PAGE_W - 65 - helv.widthOfTextAtSize(`Lakk ${refNo || ''}`, 11), y, size: 11, font: helv, color: INK });
  y -= 16;
  const dateLabel = `Guyyaa ${fmtEcDate(letterDate) || ''}`;
  page.drawText(dateLabel, { x: PAGE_W - 65 - helv.widthOfTextAtSize(dateLabel, 11), y, size: 11, font: helv, color: INK });

  y -= 55;
  page.drawText(COC_OFFICE, { x: 65, y, size: 11.5, font: helvBold, color: INK });
  y -= 15;
  page.drawText(COC_OFFICE_CITY, { x: 65, y, size: 11.5, font: helvBold, color: INK });

  y -= 30;
  page.drawText('Dhimmi: - ', { x: 65, y, size: 11.5, font: helvBold, color: INK });
  const subjX = 65 + helvBold.widthOfTextAtSize('Dhimmi: - ', 11.5);
  const subj = 'Gaaffii Madaallii dhiyeessuu ta’a.';
  page.drawText(subj, { x: subjX, y, size: 11.5, font: helvBold, color: INK });
  const subjW = helvBold.widthOfTextAtSize(subj, 11.5);
  page.drawLine({ start: { x: subjX, y: y - 2 }, end: { x: subjX + subjW, y: y - 2 }, thickness: 0.6, color: INK });

  y -= 20;
  const body =
    `Akkuma armaan olitti ibsamuuf yaalameetti <b>Dhaabbanni Leenjii Afroomiyaa</b> magaalaa ` +
    `<b>${cohortData.meta.trainingCity || ''}atti argamu</b> Leenjifamtoota Dhi. ${male} akkasumas Dha. ${female} ` +
    `waliigala ${total}  guyyaa ${fmtEcDate(cohortData.meta.trainingStartEC)} hanga ${fmtEcDate(cohortData.meta.trainingEndEC)}` +
    `tti leenjisee waan xumureef odeeffannoo barbaachisaa ta’e akkaataa guca jiruun seeraan ` +
    `guutamee kan jiruu fi kaffaltii barbaachisaa ta’e galii ta’ee waan jiruuf, ` +
    `lenjifamtoota kanaaf madaalliin akka kennamu kabajaan isin gaafanna.`;
  const maxWidth = PAGE_W - 130;
  const lines = wrapTokens(tokenize(body), helv, helvBold, 11.5, maxWidth);
  y = drawJustifiedLines(page, lines, helv, helvBold, 11.5, 17, 65, y, maxWidth);

  y -= 38;
  const stampW = 130;
  const stampH = 175;
  const stampBytes = fs.readFileSync(imagePath('coc_stamp.png'));
  const stamp = await pdfDoc.embedPng(stampBytes);
  page.drawImage(stamp, { x: 210, y: y - stampH + 55, width: stampW, height: stampH });

  const sign = 'Nagaa wajjiin';
  page.drawText(sign, { x: PAGE_W - 65 - helvBold.widthOfTextAtSize(sign, 11.5), y, size: 11.5, font: helvBold, color: INK });
  const sigW = 90;
  const sigH = 55;
  const sigBytes = fs.readFileSync(imagePath('coc_signature.png'));
  const sigImg = await pdfDoc.embedPng(sigBytes);
  page.drawImage(sigImg, { x: PAGE_W - 65 - sigW, y: y - sigH - 8, width: sigW, height: sigH });
  y -= sigH + 18;
  page.drawText(SIGNATORY_NAME, { x: PAGE_W - 65 - helvBold.widthOfTextAtSize(SIGNATORY_NAME, 11.5), y, size: 11.5, font: helvBold, color: INK });
  y -= 15;
  page.drawText(SIGNATORY_TITLE, { x: PAGE_W - 65 - helvBold.widthOfTextAtSize(SIGNATORY_TITLE, 11.5), y, size: 11.5, font: helvBold, color: INK });

  y -= 45;
  page.drawText('G/G', { x: 65, y, size: 11, font: helv, color: INK });
  y -= 15;
  // pdf-lib's built-in Helvetica uses WinAnsi encoding, which lacks the
  // "➤" glyph the Python/reportlab version used (reportlab's own encoding
  // tolerated it); a bullet is the closest WinAnsi-safe equivalent.
  page.drawText('•  ' + CC_OFFICE, { x: 90, y, size: 11, font: helv, color: INK });
  y -= 14;
  page.drawText(CC_CITY, { x: 105, y, size: 11, font: helv, color: INK });

  return { buffer: Buffer.from(await pdfDoc.save()), male, female, total };
}

module.exports = { generateCocReportPdf };
