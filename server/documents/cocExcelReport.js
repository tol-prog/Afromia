'use strict';
/**
 * COC Excel report: the "major excel COC report" per batch, replicating the
 * layout of the original hand-built AFRBatch_010_New.xlsx reference file
 * (institute header block, training-schedule dates, then one row per
 * trainee with S/N, Full Name, Sex, Age, Education level, Address
 * [Region/City-Zone/Woreda-Kebele], Labour ID, Passport No. and Phone).
 *
 * Unlike that one-off spreadsheet, this is generated straight from the
 * cohort's own trainee data every time, so it stays current as trainees are
 * enrolled one by one rather than needing a manual spreadsheet rebuild per
 * batch.
 */
const ExcelJS = require('exceljs');
const { ASSESSMENT_CENTER, INSTITUTE_PHONE, fmtEcDate } = require('./shared');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9E4D8' } };
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const CENTER = { vertical: 'middle', horizontal: 'center', wrapText: true };

async function generateCocExcelReport(cohortData) {
  const assessmentCenter = cohortData.meta.assessmentCenter || ASSESSMENT_CENTER;
  const institutePhone = cohortData.meta.institutePhone || INSTITUTE_PHONE;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Afromia Training Manager';
  wb.created = new Date();

  const ws = wb.addWorksheet('COC Report');
  ws.columns = [
    { width: 4.5 }, { width: 48.5 }, { width: 6.83 }, { width: 7 }, { width: 9.33 },
    { width: 22.5 }, { width: 20.5 }, { width: 19.33 }, { width: 22.5 }, { width: 20.16 }, { width: 21.16 },
  ];

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'Domestic Work Candidates  Information that filled by the institute  for Assessment.';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 22;

  ws.getCell('A2').value = `Name Of Assessment Center:- ${assessmentCenter}`;
  ws.getCell('A3').value = `Adress ( City/Zone):- ${cohortData.meta.trainingCity || ''}`;
  ws.getCell('A4').value = `Phone Number:-  ${institutePhone}`;
  ['A2', 'A3', 'A4'].forEach((ref) => { ws.getCell(ref).font = { bold: true, size: 11 }; });

  ws.mergeCells('J2:K2');
  ws.getCell('J2').value = 'Training Schedule(EC)';
  ws.getCell('J2').font = { bold: true };
  ws.getCell('J2').alignment = { horizontal: 'center' };
  ws.getCell('J3').value = 'Start Date';
  ws.getCell('K3').value = 'End Date';
  ws.getCell('J3').font = { bold: true };
  ws.getCell('K3').font = { bold: true };
  ws.getCell('J3').alignment = { horizontal: 'center' };
  ws.getCell('K3').alignment = { horizontal: 'center' };
  ws.getCell('J4').value = fmtEcDate(cohortData.meta.trainingStartEC);
  ws.getCell('K4').value = fmtEcDate(cohortData.meta.trainingEndEC);
  ws.getCell('J4').alignment = { horizontal: 'center' };
  ws.getCell('K4').alignment = { horizontal: 'center' };

  const row5Labels = { A: 'S/N', B: 'Full Name', C: 'Sex', D: 'Age', E: 'Education level', F: 'Adress', I: 'Labour ID Number', J: 'Passport No.', K: 'Phone Number' };
  for (const [col, label] of Object.entries(row5Labels)) ws.getCell(`${col}5`).value = label;
  ws.getCell('F6').value = 'Region/city administration';
  ws.getCell('G6').value = 'City/Zone';
  ws.getCell('H6').value = 'Woreda/Kebele';

  ['A', 'B', 'C', 'D', 'E', 'I', 'J', 'K'].forEach((col) => ws.mergeCells(`${col}5:${col}6`));
  ws.mergeCells('F5:H5');

  for (let r = 5; r <= 6; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > 11) return;
      cell.font = { bold: true };
      cell.alignment = CENTER;
      cell.fill = HEADER_FILL;
      cell.border = ALL_BORDERS;
    });
  }
  ws.getRow(5).height = 18;
  ws.getRow(6).height = 26;

  let r = 7;
  for (const t of cohortData.trainees) {
    ws.getRow(r).values = [
      t.sn, t.fullName, t.sex || '', t.age != null ? t.age : '', t.educationLevel != null ? t.educationLevel : '',
      t.region || '', t.cityZone || '', t.woredaKebele || '', t.labourId || '', t.passportNo || '', t.phone || '',
    ];
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > 11) return;
      cell.border = ALL_BORDERS;
      cell.alignment = colNumber === 2 ? { vertical: 'middle' } : { vertical: 'middle', horizontal: 'center' };
    });
    r++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateCocExcelReport };
