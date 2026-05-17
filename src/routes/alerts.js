const express = require('express');
const Alert = require('../models/Alert');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// POST /api/alerts — créer une alerte (ex: depuis la caméra live)
router.post('/', authenticate, async (req, res) => {
  try {
    const alert = await Alert.create(req.body);
    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/alerts — toutes les alertes actives
router.get('/', authenticate, async (req, res) => {
  try {
    const { resolved = false, severity, patientId, page = 1, limit = 50 } = req.query;
    const filter = { resolved: resolved === 'true' };
    if (severity) filter.severity = severity;
    if (patientId) filter.patientId = patientId;

    const alerts = await Alert.find(filter)
      .populate('patientId', 'firstName lastName patientId bedNumber')
      .populate('monitorId', 'monitorId bedNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Alert.countDocuments(filter);
    res.json({ alerts, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/alerts/:id/acknowledge — acquitter alerte
router.put('/:id/acknowledge', authenticate, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        acknowledged: true,
        acknowledgedBy: `${req.user.firstName} ${req.user.lastName}`,
        acknowledgedAt: new Date()
      },
      { new: true }
    );
    res.json(alert);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/alerts/:id/resolve — résoudre alerte
router.put('/:id/resolve', authenticate, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { resolved: true, resolvedAt: new Date() },
      { new: true }
    );
    res.json(alert);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/alerts/active/count
router.get('/active/count', authenticate, async (req, res) => {
  try {
    const critical = await Alert.countDocuments({ resolved: false, severity: 'CRITICAL' });
    const high = await Alert.countDocuments({ resolved: false, severity: 'HIGH' });
    const medium = await Alert.countDocuments({ resolved: false, severity: 'MEDIUM' });
    res.json({ critical, high, medium, total: critical + high + medium });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
