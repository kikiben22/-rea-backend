const express  = require('express');
const LabTest  = require('../models/LabTest');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/lab-tests
router.get('/', authenticate, async (req, res) => {
  try {
    const tests = await LabTest.find({ actif: true }).sort({ categorie: 1, nom: 1 });
    res.json(tests);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/lab-tests
router.post('/', authenticate, async (req, res) => {
  try {
    const test = new LabTest(req.body);
    await test.save();
    res.status(201).json(test);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/lab-tests/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const test = await LabTest.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!test) return res.status(404).json({ message: 'Test non trouvé' });
    res.json(test);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/lab-tests/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await LabTest.findByIdAndUpdate(req.params.id, { actif: false });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
