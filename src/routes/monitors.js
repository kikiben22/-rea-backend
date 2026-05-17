const express = require('express');
const Monitor = require('../models/Monitor');
const Patient = require('../models/Patient');
const VitalSign = require('../models/VitalSign');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/monitors — tous les moniteurs avec patient et vitaux
router.get('/', authenticate, async (req, res) => {
  try {
    const monitors = await Monitor.find({ isOnline: true })
      .populate('currentPatient', 'patientId firstName lastName age sex admissionReason status urgencyLevel gravityScore mortalityRisk24h')
      .sort('bedNumber');
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/monitors/:id — détail moniteur
router.get('/:id', authenticate, async (req, res) => {
  try {
    const monitor = await Monitor.findById(req.params.id)
      .populate('currentPatient');
    if (!monitor) return res.status(404).json({ message: 'Moniteur non trouvé' });

    const latestVitals = await VitalSign.findOne({ monitorId: monitor._id })
      .sort({ timestamp: -1 });

    res.json({ monitor, latestVitals });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/monitors — créer moniteur
router.post('/', authenticate, async (req, res) => {
  try {
    const monitorId = `MON-${req.body.bedNumber || Date.now()}`;
    const monitor = new Monitor({ ...req.body, monitorId });
    await monitor.save();
    res.status(201).json(monitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/monitors/:id/thresholds — mettre à jour seuils
router.put('/:id/thresholds', authenticate, async (req, res) => {
  try {
    const monitor = await Monitor.findByIdAndUpdate(
      req.params.id,
      { thresholds: req.body },
      { new: true }
    );
    res.json(monitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/monitors/:id — supprimer un moniteur (si non occupé)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const monitor = await Monitor.findById(req.params.id);
    if (!monitor) return res.status(404).json({ message: 'Moniteur non trouvé' });
    if (monitor.isOccupied) return res.status(400).json({ message: 'Impossible de supprimer un lit occupé par un patient' });
    await Monitor.findByIdAndDelete(req.params.id);
    res.json({ message: 'Moniteur supprimé' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/monitors/:id — mettre à jour un moniteur
router.put('/:id', authenticate, async (req, res) => {
  try {
    const monitor = await Monitor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!monitor) return res.status(404).json({ message: 'Moniteur non trouvé' });
    res.json(monitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/monitors/stats/dashboard — stats pour le dashboard
router.get('/stats/dashboard', authenticate, async (req, res) => {
  try {
    const total = await Monitor.countDocuments();
    const online = await Monitor.countDocuments({ isOnline: true });
    const occupied = await Monitor.countDocuments({ isOccupied: true });
    const critical = await Monitor.countDocuments({ alarmStatus: 'CRITICAL' });
    res.json({ total, online, occupied, available: online - occupied, critical });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
