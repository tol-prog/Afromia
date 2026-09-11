'use strict';
/**
 * /api/reports/... -- the "Reporting" section: generates the 4 trainee
 * documents (certificates, ID cards, application forms, record books) plus
 * the COC transmittal letter for any cohort/batch, straight from the data
 * already in the `cohorts`/`trainees` collections. Everything here is
 * read-only against the generic document store except the one import
 * endpoint, which upserts the extra reporting fields (sex, age, region,
 * etc.) onto trainee records and onto the cohort itself -- fields the
 * existing schema doesn't carry yet but the generic JSONB `documents` table
 * accepts without a migration.
 */
const express = require('express');
const { query } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { shapeCohortData, completeness } = require('./shared');
const { generateCertificatesPdf } = require('./certificate');
const { generateIdCardsPdf } = require('./idCards');
const { generateApplicationFormsPdf } = require('./applicationForm');
const { generateRecordBooksPdf } = require('./recordBook');
const { generateCocReportPdf } = require('./cocReport');
const { generateCocExcelReport } = require('./cocExcelReport');

const router = express.Router();
router.use(requireAuth);

async function loadCohortAndTrainees(cohortId) {
  const [cohortRes, traineesRes] = await Promise.all([
    query(`SELECT data FROM documents WHERE collection = 'cohorts' AND doc_id = $1`, [cohortId]),
    query(`SELECT doc_id, data FROM documents WHERE collection = 'trainees' AND data->>'cohortId' = $1`, [cohortId]),
  ]);
  if (!cohortRes.rows.length) return null;
  const cohort = { id: cohortId, ...cohortRes.rows[0].data };
  const trainees = traineesRes.rows.map((r) => ({ id: r.doc_id, ...r.data }));
  return { cohort, trainees };
}

router.get('/:cohortId/status', async (req, res) => {
  try {
    const loaded = await loadCohortAndTrainees(req.params.cohortId);
    if (!loaded) return res.status(404).json({ error: 'Cohort not found' });
    const { trainees } = shapeCohortData(loaded.cohort, loaded.trainees);
    res.json({ cohortId: req.params.cohortId, traineeCount: trainees.length, completeness: completeness(trainees) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

const DOC_BUILDERS = {
  certificates: { build: generateCertificatesPdf, filename: (code) => `${code}_Certificates.pdf` },
  'id-cards': { build: generateIdCardsPdf, filename: (code) => `${code}_ID_Cards.pdf` },
  'application-forms': { build: generateApplicationFormsPdf, filename: (code) => `${code}_Application_Forms.pdf` },
  'record-books': { build: generateRecordBooksPdf, filename: (code) => `${code}_Record_Books.pdf` },
};

router.get('/:cohortId/:docType.pdf', async (req, res) => {
  try {
    const { cohortId, docType } = req.params;
    const builder = DOC_BUILDERS[docType];
    if (!builder) return res.status(404).json({ error: 'Unknown report type' });

    const loaded = await loadCohortAndTrainees(cohortId);
    if (!loaded) return res.status(404).json({ error: 'Cohort not found' });
    if (!loaded.trainees.length) return res.status(400).json({ error: 'This cohort has no trainees yet' });

    const cohortData = shapeCohortData(loaded.cohort, loaded.trainees);
    const buffer = await builder.build(cohortData);
    const codeSlug = (loaded.cohort.code || cohortId).replace(/\s+/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${builder.filename(codeSlug)}"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

// The "major" COC Excel report -- one row per trainee, in the same layout
// as the original AFRBatch_010_New.xlsx template -- needs no extra input
// beyond the cohort id, so (like the 4 PDF downloads) it's a plain GET.
router.get('/:cohortId/coc-excel-report.xlsx', async (req, res) => {
  try {
    const { cohortId } = req.params;
    const loaded = await loadCohortAndTrainees(cohortId);
    if (!loaded) return res.status(404).json({ error: 'Cohort not found' });
    if (!loaded.trainees.length) return res.status(400).json({ error: 'This cohort has no trainees yet' });

    const cohortData = shapeCohortData(loaded.cohort, loaded.trainees);
    const buffer = await generateCocExcelReport(cohortData);
    const codeSlug = (loaded.cohort.code || cohortId).replace(/\s+/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${codeSlug}_COC_Excel_Report.xlsx"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

// The COC report needs two extra, non-derivable inputs (the institute's own
// outgoing reference number, and optionally an explicit sign-off date), so
// it's a POST rather than a plain GET download link.
router.post('/:cohortId/coc-report.pdf', async (req, res) => {
  try {
    const { cohortId } = req.params;
    const { refNo, letterDate } = req.body || {};
    if (!refNo) return res.status(400).json({ error: 'A reference number (refNo) is required for the COC report' });

    const loaded = await loadCohortAndTrainees(cohortId);
    if (!loaded) return res.status(404).json({ error: 'Cohort not found' });
    if (!loaded.trainees.length) return res.status(400).json({ error: 'This cohort has no trainees yet' });

    const cohortData = shapeCohortData(loaded.cohort, loaded.trainees);
    const { buffer } = await generateCocReportPdf(cohortData, { refNo, letterDate: letterDate || undefined });
    const codeSlug = (loaded.cohort.code || cohortId).replace(/\s+/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${codeSlug}_COC_Report.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

// Bulk-upserts the extra reporting fields onto trainee records (matched by
// name, case-insensitively, within this cohort) plus cohort-level report
// settings. Admin-only, since it edits official-document source data.
router.post('/:cohortId/import-batch-data', requireAdmin, async (req, res) => {
  try {
    const { cohortId } = req.params;
    const { trainees: rows, cohortMeta } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected a "trainees" array of rows' });

    const loaded = await loadCohortAndTrainees(cohortId);
    if (!loaded) return res.status(404).json({ error: 'Cohort not found' });

    const byName = new Map(loaded.trainees.map((t) => [String(t.name || '').trim().toLowerCase(), t]));
    const updated = [];
    const unmatched = [];
    for (const row of rows) {
      const key = String(row.fullName || row.name || '').trim().toLowerCase();
      const existing = key && byName.get(key);
      if (!existing) {
        unmatched.push(row.fullName || row.name || '(blank name)');
        continue;
      }
      const fields = {
        sex: row.sex, age: row.age, educationLevel: row.educationLevel, region: row.region,
        cityZone: row.cityZone, woredaKebele: row.woredaKebele, labourId: row.labourId,
        passportNo: row.passportNo, phone: row.phone, regNo: row.regNo, batchSn: row.sn || row.batchSn,
      };
      const patch = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== '') patch[k] = v;
      }
      if (Object.keys(patch).length) {
        const merged = { ...existing, ...patch };
        delete merged.id;
        await query(
          `UPDATE documents SET data = $2::jsonb, updated_at = now() WHERE collection = 'trainees' AND doc_id = $1`,
          [existing.id, JSON.stringify(merged)]
        );
        updated.push(existing.name);
      }
    }

    if (cohortMeta && typeof cohortMeta === 'object') {
      const merged = { ...loaded.cohort, ...cohortMeta };
      delete merged.id;
      await query(
        `INSERT INTO documents (collection, doc_id, data, updated_at) VALUES ('cohorts', $1, $2::jsonb, now())
         ON CONFLICT (collection, doc_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
        [cohortId, JSON.stringify(merged)]
      );
    }

    res.json({ updatedCount: updated.length, unmatched });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
