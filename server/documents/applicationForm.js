'use strict';
/**
 * OCA Candidates Assessment Application Form (OF/OCAPD/001): one page per
 * trainee. Matches the current official issue of the form (as supplied in
 * OF_OCAPD_001_Candidates_Application_Form1.docx) -- the OCA letterhead
 * table (logo, trilingual agency name, document number, title, issue/page
 * number), the field layout below it, and the "check this is the correct
 * issue" footer. Fields not present in the trainee record (birth date,
 * employment status, language ability, health/disability note) are left
 * blank rather than fabricated, same as the previous issue of this
 * generator did.
 *
 * Previously ported from /home/claude/afromia-docs/scripts/gen_form.py;
 * this issue keeps that field-to-trainee-data mapping but redraws the
 * header and the field layout/wording to match the new template exactly.
 */
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const {
  imagePath, embedEthiopicFont, ASSESSMENT_CENTER, OCCUPATION, APPLICATION_FEE, PRACTICAL_EXPERIENCE_DAYS,
  OCA_AGENCY_NAME_OM, OCA_AGENCY_NAME_AM, OCA_AGENCY_NAME_EN, OCA_COMPANY_LABEL_OM, OCA_COMPANY_LABEL_EN,
  OCA_DOCNO_LABEL_OM, OCA_DOCNO_LABEL_EN, OCA_TITLE_LABEL_OM, OCA_ISSUE_LABEL_OM, OCA_PAGE_LABEL_OM, OCA_ISSUE_NO,
  DOC_NO_APPLICATION_FORM, APPLICATION_FORM_TITLE_OM, OCA_ISSUE_CHECK_OM, OCA_ISSUE_CHECK_EN,
} = require('./shared');

const PAGE_W = 612;
const PAGE_H = 792;
const L = 40; // header table + body left margin
const R = 40; // header table + body right margin
const BLACK = rgb(0, 0, 0);
const NAVY = rgb(0x1c / 255, 0x3f / 255, 0x94 / 255);

/**
 * Draws the OCA letterhead table shared by every current-issue OCA
 * document: logo + "Company Name" block (trilingual agency name) + doc
 * number in the top row, "Title" + bilingual document title + issue/page
 * number in the second row. Returns the y just below the table.
 */
function drawOcaHeaderTable(page, fonts, seal, { x, yTop, width, docNo, titleLines }) {
  const { reg, bold, boldItalic, amharic } = fonts;
  const row1H = 78;
  const row2H = 46;
  const logoColW = 85;
  const issueColW = 58;
  const pageColW = 50;
  const rightColW = issueColW + pageColW; // doc-no column (row1) / issue+page (row2)
  const mainColW = width - logoColW - rightColW;

  const yRow1Bot = yTop - row1H;
  const yRow2Bot = yRow1Bot - row2H;

  // outer + row/column rules
  page.drawRectangle({ x, y: yRow2Bot, width, height: row1H + row2H, borderColor: BLACK, borderWidth: 1 });
  page.drawLine({ start: { x, y: yRow1Bot }, end: { x: x + width, y: yRow1Bot }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x + logoColW, y: yTop }, end: { x: x + logoColW, y: yRow1Bot }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x + logoColW + mainColW, y: yTop }, end: { x: x + logoColW + mainColW, y: yRow2Bot }, thickness: 1, color: BLACK });
  page.drawLine({ start: { x: x + logoColW + mainColW + issueColW, y: yRow1Bot }, end: { x: x + logoColW + mainColW + issueColW, y: yRow2Bot }, thickness: 1, color: BLACK });

  if (seal) {
    const s = 56;
    page.drawImage(seal, { x: x + (logoColW - s) / 2, y: yRow1Bot + (row1H - s) / 2, width: s, height: s });
  }

  // company-name block (row 1, middle column)
  const midX = x + logoColW + 8;
  let ty = yTop - 12;
  page.drawText(OCA_COMPANY_LABEL_OM, { x: midX, y: ty, size: 8.6, font: reg, color: BLACK });
  ty -= 10;
  page.drawText(OCA_COMPANY_LABEL_EN, { x: midX, y: ty, size: 8.6, font: reg, color: BLACK });
  ty -= 14;
  page.drawText(OCA_AGENCY_NAME_OM, { x: midX, y: ty, size: 10.5, font: bold, color: NAVY });
  ty -= 13;
  page.drawText(OCA_AGENCY_NAME_AM, { x: midX, y: ty, size: 10.5, font: amharic, color: NAVY });
  ty -= 13;
  page.drawText(OCA_AGENCY_NAME_EN, { x: midX, y: ty, size: 10.2, font: bold, color: NAVY });

  // document number block (row 1, right column)
  const docX = x + logoColW + mainColW + 10;
  let dy = yTop - 12;
  page.drawText(OCA_DOCNO_LABEL_OM, { x: docX, y: dy, size: 8.6, font: reg, color: BLACK });
  dy -= 10;
  page.drawText(OCA_DOCNO_LABEL_EN, { x: docX, y: dy, size: 8.6, font: reg, color: BLACK });
  dy -= 22;
  page.drawText(docNo, { x: docX, y: dy, size: 12.5, font: bold, color: BLACK });

  // title row (row 2)
  page.drawText(OCA_TITLE_LABEL_OM, { x: x + 8, y: yRow1Bot - 18, size: 9.4, font: reg, color: BLACK });
  const titleCx = x + logoColW + mainColW / 2;
  const t1w = bold.widthOfTextAtSize(titleLines[0], 11.5);
  page.drawText(titleLines[0], { x: titleCx - t1w / 2, y: yRow1Bot - 17, size: 11.5, font: bold, color: BLACK });
  const t2w = bold.widthOfTextAtSize(titleLines[1], 11.5);
  page.drawText(titleLines[1], { x: titleCx - t2w / 2, y: yRow1Bot - 33, size: 11.5, font: bold, color: BLACK });

  // issue no / page no (row 2, right two columns) -- labels wrapped onto
  // two short lines, same as the official template, so they fit their
  // narrow columns without colliding with each other.
  const issueX = x + logoColW + mainColW + 5;
  page.drawText('Lakk.Maxxans', { x: issueX, y: yRow1Bot - 11, size: 7, font: reg, color: BLACK });
  page.drawText('aa/Issue No.', { x: issueX, y: yRow1Bot - 20, size: 7, font: reg, color: BLACK });
  page.drawText(OCA_ISSUE_NO, { x: issueX, y: yRow1Bot - 37, size: 10.5, font: bold, color: BLACK });
  const pageX = x + logoColW + mainColW + issueColW + 5;
  page.drawText('Fuula/Page', { x: pageX, y: yRow1Bot - 11, size: 7, font: reg, color: BLACK });
  page.drawText('No.', { x: pageX, y: yRow1Bot - 20, size: 7, font: reg, color: BLACK });
  page.drawText('Page 1 of 1', { x: pageX, y: yRow1Bot - 37, size: 7.6, font: boldItalic, color: BLACK });

  return yRow2Bot;
}

async function generateApplicationFormsPdf(cohortData) {
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
  const amharic = await embedEthiopicFont(pdfDoc);
  const fonts = { reg, bold, it, boldItalic: boldIt, amharic };

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

    let y = PAGE_H - 36;
    y = drawOcaHeaderTable(page, fonts, seal, {
      x: L, yTop: y, width: PAGE_W - L - R, docNo: DOC_NO_APPLICATION_FORM, titleLines: APPLICATION_FORM_TITLE_OM,
    });
    y -= 22;

    page.drawText('This form, when completed, must be forwarded together with four (size 3X4) photos to the center of', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 15;
    page.drawText('competence.', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 26;

    const boxX = PAGE_W - R - 85;
    const boxY = y - 5;
    const boxW = 75;
    const boxH = 70;
    page.drawRectangle({ x: boxX, y: boxY - boxH + 11, width: boxW, height: boxH, borderColor: BLACK, borderWidth: 1 });
    centerText('Photos', boxX + boxW / 2, boxY - boxH / 2 + 11, 10, reg);

    let nx = underlineField(L, y, t.firstName || '', boldIt, 11, 90);
    nx = underlineField(nx + 20, y, t.fatherName || '', boldIt, 11, 90);
    underlineField(nx + 20, y, t.grandfatherName || '', boldIt, 11, 90);
    y -= 13;
    page.drawText('Name', { x: L + 20, y, size: 9, font: reg, color: BLACK });
    page.drawText("Father's Name", { x: L + 185, y, size: 9, font: reg, color: BLACK });
    page.drawText('Grand Father\'s Name', { x: L + 345, y, size: 9, font: reg, color: BLACK });
    y -= 24;

    page.drawText('Birth date', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 64, y, '', boldIt, 11, 80);
    page.drawText('Age', { x: L + 180, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 207, y, t.age != null ? String(t.age) : '', boldIt, 11, 50);
    page.drawText('Gender', { x: L + 300, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 345, y, t.sex || '', boldIt, 11, 40);
    y -= 26;

    page.drawText('Citizenship', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 75, y, 'Ethiopian', boldIt, 11, 90);
    page.drawText('Address', { x: L + 230, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 285, y, t.region || '', boldIt, 11, 110);
    y -= 26;

    page.drawText("Woreda's/ Sub City", { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 120, y, t.cityZone || '', boldIt, 11, 80);
    page.drawText('Kebele', { x: L + 265, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 305, y, t.woredaKebele || '', boldIt, 11, 80);
    page.drawText('H.No', { x: L + 445, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 475, y, '', boldIt, 11, 40);
    y -= 26;

    page.drawText('Phone/Residence', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 100, y, '', boldIt, 11, 85);
    page.drawText('Office', { x: L + 245, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 280, y, '', boldIt, 11, 70);
    page.drawText('Cell/Mobile', { x: L + 360, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 421, y, t.phone || '', boldIt, 11, 70);
    y -= 26;

    page.drawText('Presently:-', { x: L, y, size: 11, font: reg, color: BLACK });
    page.drawText('Student', { x: L + 65, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 115, y, '', boldIt, 11, 35);
    page.drawText('Employed', { x: L + 190, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 255, y, '', boldIt, 11, 25);
    page.drawText('Self Employed', { x: L + 310, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 400, y, '', boldIt, 11, 25);
    page.drawText('Job Sector', { x: L + 455, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 515, y, '', boldIt, 11, 20);
    y -= 26;

    page.drawText('Year of Graduation', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 120, y, gradYear ? String(gradYear) : '', boldIt, 11, 55);
    page.drawText('Employment Date', { x: L + 230, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 350, y, '', boldIt, 11, 150);
    y -= 28;

    page.drawText('(Name of Occupation)', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 107, y, occupation, boldIt, 11, 130);
    page.drawText('Assessment Center', { x: L + 258, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 350, y, assessmentCenter, boldIt, 11, 170);
    y -= 28;

    page.drawText('I assure that I have gained practical experience in the occupation', { x: L, y, size: 11, font: reg, color: BLACK });
    let ex = underlineField(L + 358, y, occupation, boldIt, 11, 70);
    page.drawText('of', { x: ex, y, size: 11, font: reg, color: BLACK });
    y -= 20;
    ex = underlineField(L, y, '', boldIt, 11, 90);
    page.drawText('for', { x: ex + 6, y, size: 11, font: reg, color: BLACK });
    ex = underlineField(ex + 28, y, practicalExperienceDays, boldIt, 11, 40);
    page.drawText('months/Year', { x: ex + 4, y, size: 11, font: reg, color: BLACK });
    y -= 28;

    page.drawText('I am able to read and write and communicate in the following language', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 22;
    page.drawText('English', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 55, y, '', boldIt, 11, 70);
    page.drawText('other, which one', { x: L + 165, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 290, y, '', boldIt, 11, 220);
    y -= 26;

    page.drawText('Along with this application, I shall pay an application fee of birr', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 345, y, applicationFee, boldIt, 11, 70);
    y -= 24;

    page.drawText('If any special arrangement (related to health and physical disability)', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 18;
    page.drawLine({ start: { x: L, y }, end: { x: PAGE_W - R, y }, thickness: 0.7, color: BLACK });
    y -= 24;

    page.drawText('I wish to be assessed for the occupation mentioned above', { x: L, y, size: 11, font: reg, color: BLACK });
    y -= 34;

    page.drawText('Name', { x: L, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 38, y, t.fullName || '', boldIt, 11, 150);
    page.drawText('Date', { x: L + 260, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 295, y, '', boldIt, 11, 85);
    page.drawText('Signature', { x: L + 400, y, size: 11, font: reg, color: BLACK });
    underlineField(L + 460, y, '', boldIt, 11, 80);

    // footer: "make sure this is the correct issue" notice, in both languages
    const footY = 46;
    page.drawLine({ start: { x: L, y: footY + 18 }, end: { x: PAGE_W - R, y: footY + 18 }, thickness: 1.1, color: BLACK });
    centerText(OCA_ISSUE_CHECK_OM, PAGE_W / 2, footY, 9.5, bold);
    centerText(OCA_ISSUE_CHECK_EN, PAGE_W / 2, footY - 13, 9.5, bold);
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateApplicationFormsPdf };
