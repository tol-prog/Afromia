'use strict';
/**
 * Trainees Record Book: one page per trainee, matching the sample
 * Record_Book.pdf layout. The day-to-day attendance grid is left blank
 * (attendance isn't tracked per-session in the data model); the training
 * start/end dates ARE known from the cohort, so -- unlike the blank
 * sample -- they are filled in here.
 *
 * Ported from /home/claude/afromia-docs/scripts/gen_record_book.py.
 */
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { imagePath, fmtEcDate, ASSESSMENT_CENTER } = require('./shared');

const PAGE_W = 612;
const PAGE_H = 792;
const L = 50;
const BLACK = rgb(0, 0, 0);
const GREEN = rgb(0.180, 0.490, 0.196);

const COMPETENCE_ITEMS = [
  'Basic Arabic and English Communication for Domestic Work Setting.',
  'Housekeeping And Laundry Operation.',
  'Preparing, Cooking and Serving Saudi Arabian Food and Beverage.',
  'Care Giving.',
  'Entrepreneurship And Financial Management.',
  'Life Skill, Ethics and Pre-Departure.',
];

const INSTRUCTIONS = [
  'Morning session starts at 8:30am and End at 12:30pm.',
  'Afternoon session start at 1:30am and End at 5:30pm.',
  'Lunch break from 12:30pm to 1:30pm.',
  'All Trainees are expected to complete all Modules.',
];

function fmtEcDateWithSuffix(dateStr) {
  const d = fmtEcDate(dateStr);
  return d ? `${d} E.C.` : '';
}

function drawAttendanceTable(page, x, topY, width, height, font, bold) {
  const colDate = 22;
  const colTime = 34;
  const colAmpm = 30;
  const colSign = 55;
  const colTrainer = 50;
  const colComment = 60;
  const halfCols = [colDate, colTime, colAmpm, colSign, colTrainer, colComment];
  const halfW = halfCols.reduce((a, b) => a + b, 0);
  const rowH = height / 12;

  const centerText = (text, cx, y, size, f) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cx - w / 2, y, size, font: f, color: BLACK });
  };

  for (let half = 0; half < 2; half++) {
    const hx = x + half * (halfW + 4);
    page.drawRectangle({ x: hx, y: topY - rowH, width: halfW, height: rowH, borderColor: BLACK, borderWidth: 0.8 });
    const topLabelY = topY - rowH * 0.38;
    const bottomLabelY = topY - rowH * 0.82;

    centerText('Date', hx + colDate / 2, topY - rowH / 2 - 3, 7.2, bold);
    centerText('Time', hx + colDate + (colTime + colAmpm) / 2, topLabelY, 7.2, bold);
    centerText("Trainee's", hx + colDate + colTime + colAmpm + colSign / 2, topY - 12, 7.2, bold);
    centerText('Sign', hx + colDate + colTime + colAmpm + colSign / 2, topY - 20, 7.2, bold);
    centerText("Trainer's", hx + colDate + colTime + colAmpm + colSign + colTrainer / 2, topY - rowH / 2 - 3, 7.2, bold);
    centerText('Comment', hx + colDate + colTime + colAmpm + colSign + colTrainer + colComment / 2, topY - rowH / 2 - 3, 7.2, bold);
    centerText('AM', hx + colDate + colTime / 2, bottomLabelY, 6.4, font);
    centerText('PM', hx + colDate + colTime + colAmpm / 2, bottomLabelY, 6.4, font);

    let vx = hx;
    for (const w of [colDate, colTime, colAmpm, colSign, colTrainer]) {
      vx += w;
      page.drawLine({ start: { x: vx, y: topY - rowH }, end: { x: vx, y: topY }, thickness: 0.8, color: BLACK });
    }
    page.drawLine({
      start: { x: hx + colDate, y: topY - rowH * 0.55 },
      end: { x: hx + colDate + colTime + colAmpm, y: topY - rowH * 0.55 },
      thickness: 0.8,
      color: BLACK,
    });
    page.drawLine({
      start: { x: hx + colDate + colTime, y: topY - rowH * 0.55 },
      end: { x: hx + colDate + colTime, y: topY - rowH },
      thickness: 0.8,
      color: BLACK,
    });

    for (let r = 0; r < 11; r++) {
      const rowNum = half * 11 + r + 1;
      const ryTop = topY - rowH * (r + 2);
      page.drawRectangle({ x: hx, y: ryTop, width: halfW, height: rowH, borderColor: BLACK, borderWidth: 0.8 });
      let vx2 = hx;
      for (const w of [colDate, colTime, colAmpm, colSign, colTrainer]) {
        vx2 += w;
        page.drawLine({ start: { x: vx2, y: ryTop }, end: { x: vx2, y: ryTop + rowH }, thickness: 0.8, color: BLACK });
      }
      page.drawLine({
        start: { x: hx + colDate + colTime, y: ryTop },
        end: { x: hx + colDate + colTime, y: ryTop + rowH },
        thickness: 0.8,
        color: BLACK,
      });
      centerText(`${rowNum}.`, hx + colDate / 2, ryTop + rowH / 2 - 3, 7.6, font);
    }
  }
}

async function drawRecordBookPage(pdfDoc, page, fonts, t, cohortMeta, watermarkImg) {
  const { helv, helvBold, helvBoldOblique } = fonts;

  const centerText = (text, cx, y, size, f, color = BLACK) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cx - w / 2, y, size, font: f, color });
  };
  const underline = (x0, x1, y) => page.drawLine({ start: { x: x0, y: y - 2 }, end: { x: x1, y: y - 2 }, thickness: 0.6, color: BLACK });

  let y = PAGE_H - 55;
  centerText('Afromia Short-Term Training Institute', PAGE_W / 2, y, 16, helv);
  y -= 20;
  centerText('Department: Domestic Works', PAGE_W / 2, y, 16, helv);
  y -= 20;
  centerText('Level II', PAGE_W / 2, y, 14, helv);
  {
    const tw = helv.widthOfTextAtSize('Level II', 14);
    underline(PAGE_W / 2 - tw / 2, PAGE_W / 2 + tw / 2, y);
  }
  y -= 20;
  centerText('Trainees Record Book', PAGE_W / 2, y, 14, helvBold);
  {
    const tw = helvBold.widthOfTextAtSize('Trainees Record Book', 14);
    underline(PAGE_W / 2 - tw / 2, PAGE_W / 2 + tw / 2, y);
  }

  y -= 50;
  const photoX = L;
  const photoY = y - 70;
  const photoS = 80;
  page.drawRectangle({ x: photoX, y: photoY, width: photoS, height: photoS, borderColor: BLACK, borderWidth: 1 });

  const fx = photoX + photoS + 20;
  let fy = y;
  page.drawText('Name Of Trainee: ', { x: fx, y: fy, size: 12, font: helv, color: BLACK });
  let nx = fx + helv.widthOfTextAtSize('Name Of Trainee: ', 12);
  page.drawText(t.fullName, { x: nx, y: fy, size: 12, font: helvBoldOblique, color: BLACK });
  underline(nx, nx + helvBoldOblique.widthOfTextAtSize(t.fullName, 12), fy);
  fy -= 17;
  page.drawText('Sector: Domestic Works', { x: fx, y: fy, size: 12, font: helv, color: BLACK });
  fy -= 17;
  page.drawText('Year: ', { x: fx, y: fy, size: 12, font: helv, color: BLACK });
  nx = fx + helv.widthOfTextAtSize('Year: ', 12);
  const yearLabel = cohortMeta.trainingYearLabel || '';
  page.drawText(yearLabel, { x: nx, y: fy, size: 12, font: helv, color: BLACK });
  underline(nx, nx + helv.widthOfTextAtSize(yearLabel, 12), fy);
  fy -= 17;
  page.drawText('Institute: ', { x: fx, y: fy, size: 12, font: helv, color: BLACK });
  nx = fx + helv.widthOfTextAtSize('Institute: ', 12);
  page.drawText(ASSESSMENT_CENTER, { x: nx, y: fy, size: 12, font: helvBoldOblique, color: BLACK });
  underline(nx, nx + helvBoldOblique.widthOfTextAtSize(ASSESSMENT_CENTER, 12), fy);

  y = photoY - 24;
  page.drawText('Competence', { x: L, y, size: 11, font: helvBoldOblique, color: BLACK });
  y -= 15;
  for (let i = 0; i < COMPETENCE_ITEMS.length; i++) {
    page.drawText(`${i + 1}.`, { x: L + 18, y, size: 10.5, font: helv, color: BLACK });
    page.drawText(COMPETENCE_ITEMS[i], { x: L + 34, y, size: 10.5, font: helv, color: BLACK });
    y -= 14.5;
  }

  y -= 4;
  page.drawText('Program Title: Domestic Works.', { x: L, y, size: 11, font: helv, color: BLACK });
  y -= 15;
  page.drawText('Training Venue: Workshop and Room.', { x: L, y, size: 11, font: helv, color: BLACK });
  y -= 15;
  page.drawText(`Date of Training Started: ${fmtEcDateWithSuffix(cohortMeta.trainingStartEC)}`, { x: L, y, size: 11, font: helv, color: BLACK });
  y -= 15;
  page.drawText(`Date of Training Ended: ${fmtEcDateWithSuffix(cohortMeta.trainingEndEC)}`, { x: L, y, size: 11, font: helv, color: BLACK });
  y -= 20;

  const tableTop = y;
  const tableH = 168;
  if (watermarkImg) {
    page.drawImage(watermarkImg, { x: PAGE_W / 2 - 90, y: tableTop - tableH + 15, width: 180, height: 140 });
  }
  drawAttendanceTable(page, L, tableTop, PAGE_W - 2 * L, tableH, helv, helvBold);
  y = tableTop - tableH - 18;

  centerText('General Evaluation:', PAGE_W / 2, y, 11, helv);
  y -= 18;
  const box = 10;
  const satX = PAGE_W / 2 - 110;
  page.drawRectangle({ x: satX, y: y - 2, width: box, height: box, borderColor: GREEN, borderWidth: 0.9 });
  page.drawText('Satisfactory', { x: satX + box + 6, y, size: 11, font: helv, color: BLACK });
  const nsatX = PAGE_W / 2 + 60;
  page.drawRectangle({ x: nsatX, y: y - 2, width: box, height: box, borderColor: GREEN, borderWidth: 0.9 });
  page.drawText('Not Satisfactory', { x: nsatX + box + 6, y, size: 11, font: helv, color: BLACK });
  y -= 20;
  centerText('Comment: ' + '_'.repeat(70) + '.', PAGE_W / 2, y, 11, helv);

  y -= 22;
  page.drawText('Instructions:-', { x: L, y, size: 10, font: helvBold, color: BLACK });
  y -= 15;
  for (const line of INSTRUCTIONS) {
    page.drawText('•  ' + line, { x: L + 14, y, size: 10, font: helv, color: BLACK });
    y -= 14;
  }
}

async function generateRecordBooksPdf(cohortData) {
  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvBoldOblique = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  const fonts = { helv, helvBold, helvBoldOblique };

  let watermarkImg = null;
  const wmPath = imagePath('afromia_watermark.png');
  if (fs.existsSync(wmPath)) {
    watermarkImg = await pdfDoc.embedPng(fs.readFileSync(wmPath));
  }

  for (const t of cohortData.trainees) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    await drawRecordBookPage(pdfDoc, page, fonts, t, cohortData.meta, watermarkImg);
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateRecordBooksPdf };
