const express = require('express');
const mongoose = require('mongoose');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

/* ── Schéma inline détections caméra ── */
const detectionSchema = new mongoose.Schema({
  patientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  monitorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor' },
  bedNumber:    String,
  // Détections IA
  movement:     { type: String, enum: ['STABLE', 'MOUVEMENT', 'AGITATION'], default: 'STABLE' },
  eye:          String,
  tete:         String,
  finger:       String,
  corps:        String,
  nose_bleeding:String,
  magnitude:    Number,
  // Cause de la capture (ce qui a déclenché la sauvegarde)
  alerte:       String,   // ex: AGITATION, Bouge Tête, Saignement de Nez...
  cause:        String,   // alias de alerte (nouveau label lisible)
  // Capture image base64
  image:        String,   // data:image/jpeg;base64,...
  // Heure lisible
  heureCapture: String,   // ex: "14:32:05"
}, { timestamps: true }); // createdAt = horodatage automatique

detectionSchema.index({ patientId: 1, createdAt: -1 });
detectionSchema.index({ createdAt: -1 });

const Detection = mongoose.models.CameraDetection ||
  mongoose.model('CameraDetection', detectionSchema);

/* POST /api/camera-detections — sauvegarder une détection */
router.post('/', authenticate, async (req, res) => {
  try {
    const doc = await Detection.create(req.body);
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* GET /api/camera-detections — historique (filtre par patientId ou bedNumber) */
router.get('/', authenticate, async (req, res) => {
  try {
    const { patientId, bedNumber, limit = 50 } = req.query;
    const filter = {};
    if (patientId) filter.patientId = patientId;
    if (bedNumber)  filter.bedNumber  = bedNumber;

    const results = await Detection.find(filter)
      .populate('patientId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* GET /api/camera-detections/latest — dernière détection par patient */
router.get('/latest', authenticate, async (req, res) => {
  try {
    const { patientId } = req.query;
    if (!patientId) return res.status(400).json({ message: 'patientId requis' });

    const doc = await Detection.findOne({ patientId })
      .sort({ createdAt: -1 });
    res.json(doc || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
