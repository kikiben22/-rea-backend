const express    = require('express');
const TestResult = require('../models/TestResult');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/tests?patientId=xxx
router.get('/', authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.labTestId)  filter.labTestId  = req.query.labTestId;
    const tests = await TestResult.find(filter).sort({ dateTest: -1 }).limit(200);
    res.json(tests);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/tests/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const t = await TestResult.findById(req.params.id);
    if (!t) return res.status(404).json({ message: 'Test non trouvé' });
    res.json(t);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/tests
router.post('/', authenticate, async (req, res) => {
  try {
    const t = new TestResult({ ...req.body, saisiPar: `${req.user.firstName} ${req.user.lastName}` });
    await t.save();
    res.status(201).json(t);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/tests/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const t = await TestResult.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!t) return res.status(404).json({ message: 'Test non trouvé' });
    res.json(t);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/tests/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await TestResult.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
