'use strict';
/**
 * Shared helpers for the Reporting document generators: font setup for
 * sharp (so the certificate's cursive font renders on a fresh container),
 * asset paths, batch data shaping, and small formatting utilities.
 *
 * See /home/claude/afromia-docs (the one-off Python build for Batch 10)
 * for the reference implementation these generators are ported from --
 * layouts, coordinates and data-field mapping all trace back to that.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const FONTS_DIR = path.join(ASSETS_DIR, 'fonts');
const IMAGES_DIR = path.join(ASSETS_DIR, 'images');

let fontconfigReady = false;
function ensureFontconfig() {
  if (fontconfigReady) return;
  const cacheDir = path.join(os.tmpdir(), 'afromia-fontconfig-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const confPath = path.join(os.tmpdir(), 'afromia-fonts.conf');
  const conf = `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${FONTS_DIR}</dir>\n  <cachedir>${cacheDir}</cachedir>\n</fontconfig>\n`;
  fs.writeFileSync(confPath, conf);
  process.env.FONTCONFIG_FILE = confPath;
  fontconfigReady = true;
}

function imagePath(name) {
  return path.join(IMAGES_DIR, name);
}
function fontPath(name) {
  return path.join(FONTS_DIR, name);
}

const BATCH_CODE_PREFIX_DEFAULT = 'A10';
const ASSESSMENT_CENTER = 'Afromia DWTC';
const OCCUPATION = 'Domestic Works';
const APPLICATION_FEE = '349';
const PRACTICAL_EXPERIENCE_DAYS = '21';
const INSTITUTE_PHONE = '0966711456';

/** Replicates the sample ID cards' (inconsistent) numbering: 3-digit for
 * sn < 10, 4-digit for sn >= 10. See Batch 10 delivery notes for why this
 * is kept as-is rather than normalized. */
function regNo(prefix, sn) {
  if (sn < 10) return `${prefix}-${String(sn).padStart(3, '0')}`;
  return `${prefix}-0${String(sn).padStart(3, '0')}`;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', father: '', grandfather: '' };
  if (parts.length === 1) return { first: parts[0], father: '', grandfather: '' };
  if (parts.length === 2) return { first: parts[0], father: parts[1], grandfather: '' };
  return { first: parts[0], father: parts.slice(1, -1).join(' '), grandfather: parts[parts.length - 1] };
}

function fmtEcDate(dateStr) {
  // Expects 'YYYY-MM-DD' (Ethiopian-calendar numbers stored as a plain
  // date string, same convention the app already uses for Gregorian
  // dates elsewhere) and renders 'DD/MM/YYYY'.
  if (!dateStr) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return String(dateStr);
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/**
 * Normalizes one cohort's trainees (as stored in the `trainees` collection)
 * plus the cohort's own reporting fields into the flat shape the document
 * generators expect. Trainees are sorted by their `batchSn` (the
 * sequential seat number within the batch, e.g. 1..40) when present,
 * otherwise by name, and any missing field is returned as '' / null
 * rather than fabricated -- callers should surface incompleteness to the
 * user (see /api/reports/:cohortId/status) rather than silently printing
 * blanks on an official document.
 */
function shapeCohortData(cohort, trainees) {
  const prefix = cohort.regNoPrefix || BATCH_CODE_PREFIX_DEFAULT;
  const shaped = trainees
    .map((t, i) => {
      const sn = t.batchSn || i + 1;
      const { first, father, grandfather } = splitName(t.name);
      return {
        id: t.id,
        sn,
        fullName: t.name || '',
        firstName: first,
        fatherName: father,
        grandfatherName: grandfather,
        sex: (t.sex || t.gender || '').toUpperCase().slice(0, 1),
        age: t.age != null && t.age !== '' ? Number(t.age) : null,
        educationLevel: t.educationLevel != null ? t.educationLevel : '',
        region: t.region || '',
        cityZone: t.cityZone || '',
        woredaKebele: t.woredaKebele || '',
        labourId: t.labourId || '',
        passportNo: t.passportNo || '',
        phone: t.phone || '',
        regNo: t.regNo || regNo(prefix, sn),
      };
    })
    .sort((a, b) => a.sn - b.sn);

  return {
    trainees: shaped,
    meta: {
      cohortCode: cohort.code || '',
      assessmentBranch: cohort.assessmentBranch || 'AMBO BRANCH',
      trainingCity: cohort.trainingCity || '',
      trainingStartEC: cohort.trainingStartEC || '',
      trainingEndEC: cohort.trainingEndEC || '',
      gradYearEC: cohort.trainingEndEC ? cohort.trainingEndEC.slice(0, 4) : '',
      trainingYearLabel: cohort.trainingYearLabel || '',
      certDateLabel: cohort.certDateLabel || '',
    },
  };
}

/** Fields required on a trainee record for each document type to be
 * meaningful (used by /api/reports/:cohortId/status to warn before a PDF
 * with blank official fields gets generated). */
const REQUIRED_FIELDS = {
  certificate: ['fullName'],
  idCard: ['fullName', 'sex', 'age'],
  applicationForm: ['fullName', 'sex', 'age', 'region', 'cityZone', 'woredaKebele', 'phone'],
  recordBook: ['fullName'],
  cocReport: ['fullName', 'sex'],
  cocExcelReport: ['fullName', 'sex', 'age', 'educationLevel', 'region', 'cityZone', 'woredaKebele'],
};

function completeness(shapedTrainees) {
  const report = {};
  for (const [doc, fields] of Object.entries(REQUIRED_FIELDS)) {
    const missing = [];
    for (const t of shapedTrainees) {
      const missingFields = fields.filter((f) => t[f] === '' || t[f] === null || t[f] === undefined);
      if (missingFields.length) missing.push({ sn: t.sn, name: t.fullName, fields: missingFields });
    }
    report[doc] = { complete: missing.length === 0, missing };
  }
  return report;
}

module.exports = {
  ensureFontconfig,
  imagePath,
  fontPath,
  regNo,
  splitName,
  fmtEcDate,
  shapeCohortData,
  completeness,
  ASSESSMENT_CENTER,
  OCCUPATION,
  APPLICATION_FEE,
  PRACTICAL_EXPERIENCE_DAYS,
  BATCH_CODE_PREFIX_DEFAULT,
  INSTITUTE_PHONE,
};
