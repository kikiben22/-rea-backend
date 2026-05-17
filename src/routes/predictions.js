const express = require('express');
const axios = require('axios');
const Patient = require('../models/Patient');
const VitalSign = require('../models/VitalSign');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// POST /api/predictions/:patientId — demander prédiction IA
router.post('/:patientId', authenticate, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId);
    if (!patient) return res.status(404).json({ message: 'Patient non trouvé' });

    // Derniers vitaux
    const latestVitals = await VitalSign.findOne({ patientId: patient._id })
      .sort({ timestamp: -1 });

    // Appel au service Python ML
    const payload = {
      patient_id: patient._id,
      age: patient.age,
      sex: patient.sex,
      diagnoses: patient.diagnoses,
      chronic_diseases: patient.chronicDiseases,
      vitals: latestVitals ? {
        heart_rate: latestVitals.heartRate?.value,
        spo2: latestVitals.spo2?.value,
        systolic_bp: latestVitals.systolicBP?.value,
        diastolic_bp: latestVitals.diastolicBP?.value,
        resp_rate: latestVitals.respRate?.value,
        temperature: latestVitals.temperature?.value,
        etco2: latestVitals.etco2?.value,
        glasgow: latestVitals.glasgow?.value
      } : null,
      admission_reason: patient.admissionReason
    };

    let prediction;
    try {
      const mlResponse = await axios.post(`${ML_URL}/predict`, payload, { timeout: 5000 });
      prediction = mlResponse.data;
    } catch (mlErr) {
      // Fallback: calcul local simplifié si ML service indisponible
      prediction = calculateLocalPrediction(payload);
    }

    // Sauvegarder le score dans le patient
    await Patient.findByIdAndUpdate(patient._id, {
      gravityScore: prediction.gravity_score,
      mortalityRisk24h: prediction.mortality_risk_24h,
      mortalityRisk48h: prediction.mortality_risk_48h,
      lastPredictionDate: new Date()
    });

    res.json(prediction);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Calcul local de prédiction (fallback si Python down)
function calculateLocalPrediction(data) {
  const vitals = data.vitals || {};
  let score = 50;

  if (vitals.spo2 && vitals.spo2 < 90) score += 20;
  if (vitals.heart_rate && (vitals.heart_rate < 40 || vitals.heart_rate > 140)) score += 15;
  if (vitals.systolic_bp && vitals.systolic_bp < 80) score += 20;
  if (vitals.glasgow && vitals.glasgow < 8) score += 25;
  if (vitals.resp_rate && (vitals.resp_rate < 8 || vitals.resp_rate > 35)) score += 15;
  if (data.age > 70) score += 10;

  score = Math.min(score, 100);
  return {
    gravity_score: score,
    mortality_risk_24h: score / 150,
    mortality_risk_48h: score / 120,
    risk_level: score > 75 ? 'CRITICAL' : score > 50 ? 'HIGH' : score > 25 ? 'MEDIUM' : 'LOW',
    factors: ['Calcul local — service ML indisponible'],
    recommendations: ['Réévaluer les paramètres vitaux', 'Alerter le médecin réanimateur'],
    model: 'fallback'
  };
}

module.exports = router;
