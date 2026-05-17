const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Patient = require('../models/Patient');
const VitalSign = require('../models/VitalSign');
const Alert = require('../models/Alert');
const Medicament = require('../models/Medicament');
const Prescription = require('../models/Prescription');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/* ════════════════════════════════════════════════════
   Données contextuelles à injecter dans le prompt
════════════════════════════════════════════════════ */
async function fetchContext(patientId) {
  const parts = [];

  try {
    const patients = await Patient.find({ isActive: true }).sort({ admissionDate: -1 }).limit(20);
    parts.push(`\n--- PATIENTS ACTIFS (${patients.length}) ---`);
    patients.forEach(p => {
      parts.push(
        `• ${p.firstName} ${p.lastName} | Lit: ${p.bedNumber || '—'} | Statut: ${p.status} | Urgence: ${p.urgencyLevel} | Score IA: ${p.gravityScore ?? '—'}%`
      );
    });
  } catch {}

  if (patientId) {
    try {
      const p = await Patient.findById(patientId);
      if (p) {
        parts.push(`\n--- DOSSIER PATIENT SÉLECTIONNÉ ---`);
        parts.push(`Nom: ${p.firstName} ${p.lastName} | Age: ${p.age} ans | Sexe: ${p.sex}`);
        parts.push(`Admission: ${p.admissionDate} | Raison: ${p.admissionReason}`);
        parts.push(`Diagnostics: ${p.diagnoses?.map(d => d.label).join(', ') || '—'}`);
        parts.push(`Antécédents: ${p.chronicDiseases?.join(', ') || '—'}`);
        parts.push(`Médecin: ${p.referentDoctor || '—'} | Infirmier: ${p.nurseAssigned || '—'}`);
        parts.push(`Score gravité IA: ${p.gravityScore ?? '—'}% | Mortalité 24h: ${Math.round((p.mortalityRisk24h || 0) * 100)}%`);
      }
    } catch {}

    try {
      const v = await VitalSign.findOne({ patientId }).sort({ timestamp: -1 });
      if (v) {
        parts.push(`\n--- VITAUX EN TEMPS RÉEL ---`);
        parts.push(`FC: ${v.heartRate?.value ?? '—'} bpm [${v.heartRate?.alarm}]`);
        parts.push(`SpO2: ${v.spo2?.value ?? '—'}% [${v.spo2?.alarm}]`);
        parts.push(`PA: ${v.systolicBP?.value ?? '—'}/${v.diastolicBP?.value ?? '—'} mmHg [${v.systolicBP?.alarm}]`);
        parts.push(`FR: ${v.respRate?.value ?? '—'} /min [${v.respRate?.alarm}]`);
        parts.push(`Temp: ${v.temperature?.value ?? '—'}°C [${v.temperature?.alarm}]`);
        parts.push(`Glasgow: ${v.glasgow?.value ?? '—'}/15 [${v.glasgow?.alarm}]`);
        parts.push(`EtCO2: ${v.etco2?.value ?? '—'} mmHg`);
        parts.push(`Mesure: ${v.timestamp}`);
      }
    } catch {}

    try {
      const prescriptions = await Prescription.find({ patientId }).sort({ datePrescription: -1 }).limit(10);
      if (prescriptions.length > 0) {
        parts.push(`\n--- PRESCRIPTIONS ---`);
        prescriptions.forEach(p => {
          parts.push(`• ${p.medicament} ${p.dosage} | ${p.voie} | ${p.frequence} | Statut: ${p.statut}`);
        });
      }
    } catch {}
  }

  try {
    const alerts = await Alert.find({ resolved: false, ...(patientId ? { patientId } : {}) })
      .sort({ createdAt: -1 }).limit(10);
    if (alerts.length > 0) {
      parts.push(`\n--- ALERTES ACTIVES (${alerts.length}) ---`);
      alerts.forEach(a => parts.push(`⚠️ [${a.severity}] ${a.message}`));
    }
  } catch {}

  try {
    const lowStock = await Medicament.find({ isActive: true })
      .sort({ quantiteStock: 1 }).limit(5);
    const critiques = lowStock.filter(m => m.quantiteStock <= m.seuilAlerte);
    if (critiques.length > 0) {
      parts.push(`\n--- STOCK CRITIQUE ---`);
      critiques.forEach(m => parts.push(`• ${m.nom} : ${m.quantiteStock} ${m.unite} (seuil: ${m.seuilAlerte})`));
    }
  } catch {}

  return parts.join('\n');
}

function buildSystemPrompt(userRole, contextData) {
  return `Tu es Gemini, un assistant médical IA de pointe intégré dans le système REA (Réanimation) d'un hôpital algérien.

RÔLE DE L'UTILISATEUR: ${userRole}

DONNÉES TEMPS RÉEL DU SYSTÈME REA:
${contextData || '(Données non disponibles — vérifiez la connexion à la base de données)'}

INSTRUCTIONS:
- Réponds TOUJOURS en français, de manière professionnelle, précise et concise
- Utilise les données temps réel ci-dessus pour contextualiser tes réponses
- Si tu détectes des valeurs critiques dans les vitaux, signale-les avec ⚠️
- Ne pose jamais de diagnostic définitif — analyses et suggestions uniquement
- Adapte ton niveau de détail au rôle (médecin vs infirmier)
- Indique clairement les unités médicales (bpm, mmHg, °C, %)
- En cas d'urgence détectée, recommande d'appeler le médecin senior
- Tu peux répondre à des questions médicales générales (protocoles, scores, médicaments)
- Sois empathique et professionnel avec le personnel médical`;
}

/* ════════════════════════════════════════════════════
   ROUTE STREAMING SSE
════════════════════════════════════════════════════ */
router.post('/stream', authenticate, async (req, res) => {
  const { message, patientId, history = [] } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('METS-TA-CLE') || apiKey.length < 10) {
    send({ type: 'error', text: 'Clé API Gemini manquante. Configurez GEMINI_API_KEY dans le fichier .env du backend.' });
    res.end();
    return;
  }

  try {
    send({ type: 'status', text: '🔍 Chargement des données patients...' });
    const contextData = await fetchContext(patientId);

    send({ type: 'status', text: '🤖 Gemini analyse...' });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = buildSystemPrompt(req.user.role, contextData);

    // Construire l'historique au format Gemini
    const chatHistory = history.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Compris. Je suis Gemini, votre assistant médical REA. Je vais analyser les données en temps réel pour vous aider.' }] },
        ...chatHistory
      ],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.3,
      }
    });

    send({ type: 'start' });

    const result = await chat.sendMessageStream(message);

    let fullText = '';
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullText += text;
        send({ type: 'delta', text });
      }
    }

    send({ type: 'done', model: 'gemini-1.5-flash' });
    res.end();

  } catch (err) {
    console.error('[Gemini Stream Error]', err.message);
    send({ type: 'error', text: 'Erreur Gemini: ' + err.message });
    res.end();
  }
});

/* ════════════════════════════════════════════════════
   ROUTE VÉRIFICATION CLÉ API
════════════════════════════════════════════════════ */
router.get('/status', authenticate, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const hasKey = apiKey && !apiKey.includes('METS-TA-CLE') && apiKey.length > 10;
  res.json({ configured: hasKey, model: 'gemini-1.5-flash' });
});

module.exports = router;
