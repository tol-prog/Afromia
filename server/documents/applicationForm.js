'use strict';
/**
 * OCA Candidates Application Form: one page per trainee, matching the
 * sample Form.pdf layout. Fields not present in the trainee record (birth
 * day, employment status, language ability, health/disability note) are
 * left blank rather than fabricated.
 *
 * Ported from /home/claude/afromia-docs/scripts/gen_form.py.
 */
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { imagePath, ASSESSMENT_CENTER, OCCUPATION, APPLICATION_FEE, PRACTICAL_EXPERIENCE_DAYS } = require('./shared');

const PAGE_W = 612;
const PAGE_H = 792;
const L = 65;
const BLACK = rgb(0, 0, 0);

async function generateApplicationFormsPdf(cohortData) {
  const assessmentBranch = (cohortData.meta.assessmentBranch || 'AMBO BRANCH').replace(
    /\w\S*/g,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
  const gradYear = cohortData.meta.gradYearEC || '';
  // Institute-level facts: default to Afromia's own, but let a different
  // institute's spreadsheet-upload override them (see shared.js's
  // shapeUploadedRows).
  const assessmentCenter = cohortData.meta.assessmentCenter || ASSESSMENT_CENTER;
  const occupation = cohortData.meta.occupation || OCCUPATION;
  const applicationFee = cohortData.meta.applicationFee || APPLICATION_FEE;
  const practicalExperienceDays = cohortData.meta.practicalExperienceDays || PRACTICAL_EXPERIENCE_DAYS;

  const pdfDoc = await PDFDocument.create();
  const reg = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const bold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const it = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const boldIt = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

  let seal = null;
  const sealPath = imagePath('oromia_seal.png');
  if (fs.existsSync(sealPath)) {
    seal = await pdfDoc.embedPng(fs.readFileSync(sealPath));
  }

  for (const t of cohortData.trainees) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    const centerText = (str, cx, yy, size, font) => {
      const w = font.widthOfTextAtSize(str, size);
      page.drawText(str, { x: cx - w / 2, y: yy, size, font, color: BLACK });
    };

    /** Draws `value` underlined starting at (x, y); returns the x just
     * past the underline (for chaining adjacent fields on one line). */
    const underlineField = (x, yy, value, font = boldIt, size = 11, minWidth = 70) => {
      page.drawText(value, { x, y: yy, size, font, color: BLACK });
      const w = Math.max(font.widthOfTextAtSize(value, size), minWidth);
      page.drawLine({ start: { x, y: yy - 2 }, end: { x: x + w + 6, y: yy - 2 }, thickness: 0.7, color: BLACK });
      return x + w + 6;
    };

    const checkbox = (x, yy, label, checked = false, size = 9) => {
      page.drawRectangle({ x, y: yy - 1, width: 9, height: 9, borderColor: BLACK, borderWidth: 0.8 });
      if (checked) {
        page.drawText('X', { x: x + 1.3, y: yy - 0.5, size: 9, font: bold, color: BLACK });
      }
      page.drawText(label, { x: x + 13, y: yy, size, font: reg, color: BLACK });
    };

    let y = PAGE_H - 55;
    if (seal) {
      page.drawImage(seal, { x: L, y: y - 55, width: 70, height: 70 });
    }

    centerText('Oromia Occupational Competence Assurance Agency', PAGE_W / 2 + 20, y, 15, bold);
    centerText('Candidates Application Form:', PAGE_W / 2 + 20, y - 20, 15, bold);
    centerText(assessmentBranch, PAGE_W / 2 + 20, y - 40, 15, bold);

    const boxX = PAGE_W - 145;
    const boxY = y - 5;
    const boxW = 65;
    const boxH = 65;
    page.drawRectangle({ x: boxX, y: boxY - boxH + 55, width: boxW, height: boxH, borderColor: BLACK, borderWidth: 1 });
    centerText('3x4', boxX + boxW / 2, boxY - boxH / 2 + 55, 10, reg);

    y -= 95;
    page.drawText('This form, when completed, must be forwarded together with four (size 3x4) photos to the center of', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 15;
    page.drawText('competence.', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 26;

    page.drawText('I', { x: L, y, size: 11, font: reg, color: BLACK });
    let nx = underlineField(L + 15, y, t.firstName || '');
    nx = underlineField(nx + 40, y, t.fatherName || '');
    underlineField(nx + 40, y, t.grandfatherName || '');
    y -= 13;
    page.drawText('Name', { x: L + 15, y, size: 9, font: reg, color: BLACK });
    page.drawText("Father's Name", { x: L + 165, y, size: 9, font: reg, color: BLACK });
    page.drawText('Grand Father\'s Name', { x: L + 330, y, size: 9, font: reg, color: BLACK });
    y -= 24;

    page.drawText('Birth day', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 62, y, '', boldIt, 11, 90);
    page.drawText('Age', { x: L + 190, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 218, y, t.age != null ? String(t.age) : '', boldIt, 11, 45);
    page.drawText('Sex', { x: L + 320, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 345, y, t.sex || '', boldIt, 11, 25);
    y -= 24;

    page.drawText('Citizenship', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 75, y, 'Ethiopian', boldIt, 11, 80);
    page.drawText('Address', { x: L + 220, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 275, y, t.region || '', boldIt, 11, 100);
    y -= 24;

    page.drawText('Woreda/ sub city', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 110, y, t.cityZone || '', boldIt, 11, 90);
    page.drawText('Kebele', { x: L + 260, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 305, y, t.woredaKebele || '', boldIt, 11, 90);
    page.drawText('H.No.', { x: L + 450, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 485, y, '', boldIt, 11, 45);
    y -= 24;

    page.drawText('Phone/ Residence', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 115, y, '', boldIt, 11, 110);
    page.drawText('Office', { x: L + 260, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 300, y, '', boldIt, 11, 90);
    page.drawText('Cell/ Mobile', { x: L + 400, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 470, y, t.phone || '', boldIt, 11, 90);
    y -= 24;

    page.drawText('Presently:', { x: L, y, size: 11, font: reg, color: BLACK });
    checkbox(L + 65, y, 'Student');
    checkbox(L + 150, y, 'Employed');
    checkbox(L + 245, y, 'Self employed');
    checkbox(L + 365, y, 'Job seeker');
    y -= 24;

    page.drawText('Year of Graduation', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 118, y, gradYear ? String(gradYear) : '', boldIt, 11, 45);
    page.drawText('Employment Date', { x: L + 220, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 330, y, '', boldIt, 11, 150);
    y -= 22;

    underlineField(L, y, assessmentCenter, boldIt, 11, 520);
    y -= 13;
    page.drawText('(Name and address of school, company or training center)', { x: L + 5, y, size: 9, font: it, color: BLACK });
    y -= 20;

    page.drawText('I here by submit my application for assessment of my competencies as a', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 22;
    underlineField(L, y, occupation, boldIt, 11, 520);
    y -= 13;
    page.drawText('(Name of Occupation)', { x: L + 5, y, size: 9, font: it, color: BLACK });
    y -= 20;

    page.drawText('I assure that I have gained practical experience in the occupation of', { x: L, y, size: 11, font: reg, color: BLACK });
    page.drawText(occupation, { x: L + 322, y, size: 11, font: boldIt, color: BLACK });
    page.drawText('of', { x: L + 322 + boldIt.widthOfTextAtSize(occupation, 11) + 2, y, size: 11, font: reg, color: BLACK });
    y -= 22;
    underlineField(L, y, '', boldIt, 11, 170);
    page.drawText('for', { x: L + 185, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 205, y, practicalExperienceDays, boldIt, 11, 25);
    page.drawText('days.', { x: L + 240, y, size: 11, font: reg, color: BLACK });
    y -= 26;

    page.drawText('I am able to read and write and communicate in the following language:', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 20;
    checkbox(L, y, 'English');
    page.drawText('other, which one', { x: L + 90, y, size: 9, font: reg, color: BLACK });
    underlineField(L + 210, y, '', boldIt, 11, 300);
    y -= 26;

    page.drawText('Along with this application I shall pay an application fee of Birr', { x: L, y, size: 11, font: reg, color: BLACK });
    page.drawText(applicationFee, { x: L + 320, y, size: 11, font: boldIt, color: BLACK });
    y -= 20;
    page.drawText('If any special arrangements (Related to health and physical disability) you', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 20;
    page.drawText('No!', { x: L, y, size: 11, font: bold, color: BLACK });
    page.drawLine({ start: { x: L + 20, y: y - 2 }, end: { x: PAGE_W - L, y: y - 2 }, thickness: 0.7, color: BLACK });
    y -= 15;
    page.drawLine({ start: { x: L, y }, end: { x: PAGE_W - L, y }, thickness: 0.7, color: BLACK });
    y -= 32;

    page.drawText('I wish to be assessed for the occupation mentioned above.', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 46;

    page.drawLine({ start: { x: L, y }, end: { x: L + 190, y }, thickness: 0.7, color: BLACK });
    page.drawLine({ start: { x: PAGE_W - L - 190, y }, end: { x: PAGE_W - L, y }, thickness: 0.7, color: BLACK });
    y -= 13;
    centerText('Signature', L + 95, y, 10, reg);
    centerText('Date', PAGE_W - L - 95, y, 10, reg);
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateApplicationFormsPdf };
