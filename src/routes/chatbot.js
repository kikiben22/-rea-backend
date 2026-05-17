const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios    = require('axios');
const Patient = require('../models/Patient');
const VitalSign = require('../models/VitalSign');
const Alert = require('../models/Alert');
const Medicament = require('../models/Medicament');
const Prescription = require('../models/Prescription');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const OLLAMA_URL      = process.env.OLLAMA_URL    || 'http://localhost:11434';
const OLLAMA_MODEL    = 'llama3.2:1b';  // CPU-only : seul modèle 1B assez rapide
const OLLAMA_FAST     = 'llama3.2:1b'; // idem
const CLINICAL_API    = process.env.CLINICAL_API  || 'http://localhost:8082';
const PRO_AI_URL      = process.env.PRO_AI_URL    || 'http://localhost:8085'; // Nouveau service IA pro

// ── Warmup Ollama au démarrage ─────────────────────────────
async function warmupOllama() {
  // Charger llama3.2:1b en mémoire (rapide)
  for (const m of [OLLAMA_MODEL, OLLAMA_FAST]) {
    try {
      await axios.post(`${OLLAMA_URL}/api/chat`, {
        model: m,
        messages: [{ role: 'user', content: 'ok' }],
        stream: false,
        options: { temperature: 0.1, num_ctx: 128, num_predict: 3 }
      }, { timeout: 30000 });
      console.log(`[Ollama] Modele ${m} charge en memoire`);
    } catch (e) {
      console.log(`[Ollama] Warmup ${m} ignore: ${e.message}`);
    }
  }
}
setTimeout(warmupOllama, 3000); // warmup 3s apres demarrage

/* ── Détecte si le message est une question clinique ── */
function detectClinicalQuery(text) {
  const t = text.toLowerCase();
  const keywords = ['complication','complication','test','examen','soin','médicament','medicament','traitement','bilan','diagnostic','plainte','symptôme','symptome'];
  return keywords.some(k => t.includes(k));
}

/* ── Extrait la plainte principale depuis le message ── */
function extractComplaint(text) {
  const t = text.toLowerCase();
  const complaints = ['chest pain','douleur thoracique','shortness of breath','dyspnée','abdominal pain','douleur abdominale',
    'fever','fièvre','headache','céphalée','severe headache','dizziness','vertige','general weakness','faiblesse',
    'palpitations','road traffic trauma','traumatisme','fall at home','chute'];
  for (const c of complaints) {
    if (t.includes(c)) return c;
  }
  return null;
}

/* ── Appel à la Clinical API Python ── */
async function queryClinicalAPI(complaint, riskLevel, department) {
  try {
    const res = await axios.post(`${CLINICAL_API}/api/analyze`, {
      chief_complaint: complaint,
      risk_level: riskLevel || 'Medium',
      department: department || 'Emergency'
    }, { timeout: 5000 });
    return res.data?.formatted || null;
  } catch { return null; }
}

/* ── Vérifie si Ollama est disponible ── */
async function ollamaAvailable() {
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    const models = res.data?.models?.map(m => m.name) || [];
    return models.some(m => m.startsWith('rea-medical') || m.startsWith('llama') || m.startsWith('gemma'));
  } catch { return false; }
}

/* ── Streaming via Ollama (http natif pour fiabilité) ── */
function streamOllama(messages, send, res) {
  return new Promise((resolve) => {
    const http = require('http');
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      options: { temperature: 0.2, num_ctx: 512, num_predict: 300, repeat_penalty: 1.1 }
    });

    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const options = {
      hostname: url.hostname,
      port:     url.port || 11434,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    send({ type: 'start' });

    const req = http.request(options, (ollamaRes) => {
      let buffer = '';

      ollamaRes.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.message?.content) send({ type: 'delta', text: json.message.content });
            if (json.done) {
              send({ type: 'done', model: `${OLLAMA_MODEL} (local)` });
              res.end();
              resolve();
            }
          } catch {}
        }
      });

      ollamaRes.on('end', () => { res.end(); resolve(); });
      ollamaRes.on('error', () => { send({ type: 'error', text: 'Erreur stream Ollama' }); res.end(); resolve(); });
    });

    req.on('error', (err) => {
      send({ type: 'error', text: 'Ollama inaccessible : ' + err.message });
      res.end();
      resolve();
    });

    req.setTimeout(90000, () => {
      req.destroy();
      send({ type: 'error', text: 'Timeout Ollama (90s)' });
      res.end();
      resolve();
    });

    req.write(body);
    req.end();
  });
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ═══════════════════════════════════════════
   CONTEXTE TEMPS RÉEL — injecté dans Gemini
═══════════════════════════════════════════ */
async function fetchReaContext(patientId) {
  const parts = [];
  try {
    const patients = await Patient.find({ isActive: true }).sort({ admissionDate: -1 }).limit(20);
    parts.push(`--- PATIENTS ACTIFS (${patients.length}) ---`);
    patients.forEach(p => {
      parts.push(`• ${p.firstName} ${p.lastName} | Lit: ${p.bedNumber || '—'} | Statut: ${p.status} | Urgence: ${p.urgencyLevel} | Score IA: ${p.gravityScore ?? '—'}%`);
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
        parts.push(`Score gravité: ${p.gravityScore ?? '—'}% | Mortalité 24h: ${Math.round((p.mortalityRisk24h || 0) * 100)}%`);
      }
    } catch {}

    try {
      const v = await VitalSign.findOne({ patientId }).sort({ timestamp: -1 });
      if (v) {
        parts.push(`\n--- VITAUX TEMPS RÉEL ---`);
        parts.push(`FC: ${v.heartRate?.value ?? '—'} bpm [${v.heartRate?.alarm}] | SpO2: ${v.spo2?.value ?? '—'}% [${v.spo2?.alarm}]`);
        parts.push(`PA: ${v.systolicBP?.value ?? '—'}/${v.diastolicBP?.value ?? '—'} mmHg | FR: ${v.respRate?.value ?? '—'} /min | Temp: ${v.temperature?.value ?? '—'}°C`);
        parts.push(`Glasgow: ${v.glasgow?.value ?? '—'}/15 | EtCO2: ${v.etco2?.value ?? '—'} mmHg`);
      }
    } catch {}

    try {
      const prescriptions = await Prescription.find({ patientId }).sort({ datePrescription: -1 }).limit(10);
      if (prescriptions.length > 0) {
        parts.push(`\n--- PRESCRIPTIONS ---`);
        prescriptions.forEach(p => parts.push(`• ${p.medicament} ${p.dosage} | ${p.voie} | ${p.frequence}`));
      }
    } catch {}
  }

  try {
    const alerts = await Alert.find({ resolved: false, ...(patientId ? { patientId } : {}) })
      .sort({ createdAt: -1 }).limit(10);
    if (alerts.length > 0) {
      parts.push(`\n--- ALERTES ACTIVES ---`);
      alerts.forEach(a => parts.push(`⚠️ [${a.severity}] ${a.message}`));
    }
  } catch {}

  return parts.join('\n');
}

/* ─ Streaming Gemini ─────────────────────────────── */
async function streamGemini(message, patientId, history, userRole, send, res) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  send({ type: 'status', text: '🔍 Chargement des données REA...' });
  const contextData = await fetchReaContext(patientId);

  const systemPrompt = `${buildSystemPrompt(userRole)}\n\nDONNÉES TEMPS RÉEL:\n${contextData}`;

  const chatHistory = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Compris. Je suis Gemini, votre assistant médical REA. Je vais analyser les données en temps réel pour vous aider.' }] },
    ...history.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }))
  ];

  const chat = model.startChat({
    history: chatHistory,
    generationConfig: { maxOutputTokens: 8192, temperature: 0.3 }
  });

  send({ type: 'start' });
  const result = await chat.sendMessageStream(message);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) send({ type: 'delta', text });
  }

  send({ type: 'done', model: 'Gemini 1.5 Flash' });
  res.end();
}

/* ═══════════════════════════════════════════
   OUTILS MCP — Claude peut appeler ces fonctions
   pour accéder aux données en temps réel
═══════════════════════════════════════════ */
const MCP_TOOLS = [
  {
    name: 'get_patient_info',
    description: 'Récupère les informations complètes d\'un patient (identité, admission, diagnostic, antécédents, statut)',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'ID MongoDB du patient' }
      },
      required: ['patient_id']
    }
  },
  {
    name: 'get_vitals',
    description: 'Récupère les derniers paramètres vitaux d\'un patient (FC, SpO2, pression artérielle, température, Glasgow, EtCO2)',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'ID MongoDB du patient' }
      },
      required: ['patient_id']
    }
  },
  {
    name: 'get_prescriptions',
    description: 'Récupère les ordonnances et prescriptions médicamenteuses d\'un patient',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'ID MongoDB du patient' }
      },
      required: ['patient_id']
    }
  },
  {
    name: 'get_alerts',
    description: 'Récupère les alertes médicales actives d\'un patient ou de tous les patients',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'ID MongoDB du patient (optionnel — si vide, retourne toutes les alertes actives)' }
      }
    }
  },
  {
    name: 'get_stock',
    description: 'Consulte le stock de médicaments disponibles dans l\'unité REA',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Nom du médicament à rechercher (optionnel)' }
      }
    }
  },
  {
    name: 'list_patients',
    description: 'Liste tous les patients actifs dans l\'unité de réanimation avec leur statut',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filtrer par statut: CRITIQUE, URGENT, STABLE, AMÉLIORATION (optionnel)' }
      }
    }
  },
  {
    name: 'predict_icu_risk',
    description: 'Prédit les risques ICU en temps réel (choc septique, défaillance respiratoire, instabilité hémodynamique) à partir des signes vitaux — modèle XGBoost entraîné sur 50 000 relevés (dataset Hôpital A)',
    input_schema: {
      type: 'object',
      properties: {
        heart_rate:  { type: 'number', description: 'Fréquence cardiaque en bpm' },
        spo2:        { type: 'number', description: 'Saturation en oxygène en %' },
        resp_rate:   { type: 'number', description: 'Fréquence respiratoire en /min' },
        temperature: { type: 'number', description: 'Température corporelle en °C' },
        map_value:   { type: 'number', description: 'Pression artérielle moyenne (PAM) en mmHg' },
      },
      required: ['heart_rate', 'spo2', 'resp_rate', 'temperature', 'map_value']
    }
  },
  {
    name: 'predict_mortality',
    description: 'Prédit le risque de décès hospitalier à partir des données cliniques d\'admission — modèle Random Forest entraîné sur 91 713 patients (WiDS Datathon 2020)',
    input_schema: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'ID MongoDB du patient (les données seront récupérées automatiquement)' }
      },
      required: ['patient_id']
    }
  },
  {
    name: 'predict_triage',
    description: 'Détermine le niveau de priorité de triage (Low/Medium/High) pour un patient aux urgences — modèle entraîné sur dataset triage',
    input_schema: {
      type: 'object',
      properties: {
        heart_rate:       { type: 'number', description: 'Fréquence cardiaque bpm' },
        systolic_bp:      { type: 'number', description: 'Pression systolique mmHg' },
        temperature:      { type: 'number', description: 'Température °C' },
        resp_rate:        { type: 'number', description: 'Fréquence respiratoire /min' },
        spo2:             { type: 'number', description: 'SpO₂ %' },
        chief_complaint:  { type: 'string', description: 'Motif principal de consultation' },
        age:              { type: 'number', description: 'Âge du patient' },
      },
      required: ['heart_rate', 'systolic_bp', 'temperature', 'resp_rate', 'spo2']
    }
  }
];

/* ═══════════════════════════════════
   EXÉCUTION DES OUTILS MCP
═══════════════════════════════════ */
async function executerOutil(toolName, input) {
  try {
    switch (toolName) {

      case 'get_patient_info': {
        const p = await Patient.findById(input.patient_id);
        if (!p) return { erreur: 'Patient non trouvé' };
        return {
          id: p.patientId,
          nom: p.lastName,
          prenom: p.firstName,
          age: p.age,
          sexe: p.sex,
          groupe_sanguin: p.bloodType || 'Non renseigné',
          date_admission: p.admissionDate,
          raison_admission: p.admissionReason,
          diagnostic: p.diagnoses?.map(d => d.label).join(', ') || '—',
          antecedents: p.chronicDiseases || [],
          statut: p.status,
          urgence: p.urgencyLevel,
          lit: p.bedNumber || '—',
          medecin: p.referentDoctor || '—',
          infirmier: p.nurseAssigned || '—',
          score_gravite: p.gravityScore,
          risque_mortalite_24h: Math.round((p.mortalityRisk24h || 0) * 100) + '%'
        };
      }

      case 'get_vitals': {
        const v = await VitalSign.findOne({ patientId: input.patient_id }).sort({ timestamp: -1 });
        if (!v) return { message: 'Aucune mesure vitale récente' };
        return {
          horodatage: v.timestamp,
          frequence_cardiaque: { valeur: v.heartRate?.value, unite: 'bpm', alarme: v.heartRate?.alarm },
          spo2: { valeur: v.spo2?.value, unite: '%', alarme: v.spo2?.alarm },
          pression_arterielle: { systolique: v.systolicBP?.value, diastolique: v.diastolicBP?.value, unite: 'mmHg', alarme: v.systolicBP?.alarm },
          frequence_respiratoire: { valeur: v.respRate?.value, unite: '/min', alarme: v.respRate?.alarm },
          temperature: { valeur: v.temperature?.value, unite: '°C', alarme: v.temperature?.alarm },
          glasgow: { valeur: v.glasgow?.value, max: 15, alarme: v.glasgow?.alarm },
          etco2: { valeur: v.etco2?.value, unite: 'mmHg' }
        };
      }

      case 'get_prescriptions': {
        const prescriptions = await Prescription.find({ patientId: input.patient_id }).sort({ datePrescription: -1 });
        return prescriptions.map(p => ({
          medicament: p.medicament,
          dosage: p.dosage,
          voie: p.voie,
          frequence: p.frequence,
          heure_prise: p.heurePrise || '—',
          duree_jours: p.dureeJours || '—',
          date_fin: p.dateFin || '—',
          statut: p.statut,
          prescrit_par: p.prescritPar,
          instructions: p.instructions || '—'
        }));
      }

      case 'get_alerts': {
        const filter = { resolved: false };
        if (input.patient_id) filter.patientId = input.patient_id;
        const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(20);
        return alerts.map(a => ({
          type: a.type,
          severite: a.severity,
          message: a.message,
          date: a.createdAt,
          acquittee: a.acknowledged
        }));
      }

      case 'get_stock': {
        const filter = { isActive: true };
        if (input.search) filter.nom = { $regex: input.search, $options: 'i' };
        const meds = await Medicament.find(filter).select('-mouvements').sort({ nom: 1 }).limit(30);
        return meds.map(m => ({
          nom: m.nom,
          categorie: m.categorie,
          dosage: m.dosageUnitaire,
          stock: m.quantiteStock,
          unite: m.unite,
          seuil_alerte: m.seuilAlerte,
          niveau: m.quantiteStock === 0 ? 'RUPTURE' : m.quantiteStock <= m.seuilAlerte ? 'FAIBLE' : 'OK',
          emplacement: m.emplacement,
          expiration: m.dateExpiration || '—'
        }));
      }

      case 'list_patients': {
        const filter = { isActive: true };
        if (input.status) filter.status = input.status;
        const patients = await Patient.find(filter).sort({ admissionDate: -1 }).limit(20);
        return patients.map(p => ({
          id: p._id,
          patient_id: p.patientId,
          nom_complet: `${p.firstName} ${p.lastName}`,
          age: p.age,
          lit: p.bedNumber || '—',
          statut: p.status,
          urgence: p.urgencyLevel,
          raison: p.admissionReason,
          score_gravite: p.gravityScore
        }));
      }

      case 'predict_icu_risk': {
        try {
          const r = await axios.post(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/predict-icu4-alerts`, {
            heart_rate:  input.heart_rate,
            spo2:        input.spo2,
            resp_rate:   input.resp_rate,
            temperature: input.temperature,
            map_value:   input.map_value,
          }, { timeout: 8000 });
          const p = r.data.icu4_predictions || {};
          return {
            source: 'ICU4-XGBoost — Hôpital A (50 000 relevés)',
            statut_global: r.data.overall_status,
            risque_choc_septique: {
              probabilite: Math.round((p.septic_shock?.probability || 0) * 100) + '%',
              niveau: p.septic_shock?.level || 'LOW',
              alerte: p.septic_shock?.alert || false,
            },
            risque_insuffisance_respiratoire: {
              probabilite: Math.round((p.resp_failure?.probability || 0) * 100) + '%',
              niveau: p.resp_failure?.level || 'LOW',
              alerte: p.resp_failure?.alert || false,
            },
            risque_instabilite_hemodynamique: {
              probabilite: Math.round((p.hemo_instability?.probability || 0) * 100) + '%',
              niveau: p.hemo_instability?.level || 'LOW',
              alerte: p.hemo_instability?.alert || false,
            },
            alertes: r.data.alerts || [],
          };
        } catch (e) {
          return { erreur: 'Service ML ICU non disponible: ' + e.message };
        }
      }

      case 'predict_mortality': {
        try {
          const p = await Patient.findById(input.patient_id);
          const v = await VitalSign.findOne({ patientId: input.patient_id }).sort({ timestamp: -1 });
          if (!p) return { erreur: 'Patient non trouvé' };
          const r = await axios.post(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/predict`, {
            patient_id: String(p._id),
            age: p.age || 50,
            sex: p.sex || 'M',
            vitals: {
              heart_rate:   v?.heartRate?.value   || null,
              spo2:         v?.spo2?.value         || null,
              resp_rate:    v?.respRate?.value      || null,
              temperature:  v?.temperature?.value  || null,
              systolic_bp:  v?.systolicBP?.value   || null,
              diastolic_bp: v?.diastolicBP?.value  || null,
              glasgow:      v?.glasgow?.value       || null,
              etco2:        v?.etco2?.value         || null,
            },
            chronic_diseases: p.chronicDiseases || [],
            diagnoses:        p.diagnoses       || [],
            admission_reason: p.admissionReason  || '',
          }, { timeout: 8000 });
          const prob = r.data?.mortality_probability ?? r.data?.probability ?? r.data?.prediction;
          return {
            source: 'WiDS 2020 — Random Forest (91 713 patients)',
            patient: `${p.firstName} ${p.lastName}`,
            risque_deces_hospitalier: Math.round((prob || 0) * 100) + '%',
            niveau: prob >= 0.7 ? 'TRÈS ÉLEVÉ' : prob >= 0.4 ? 'ÉLEVÉ' : prob >= 0.2 ? 'MODÉRÉ' : 'FAIBLE',
            interpretation: prob >= 0.7
              ? 'Pronostic très sévère — discussion soins palliatifs recommandée'
              : prob >= 0.4
              ? 'Risque élevé — surveillance rapprochée et réévaluation du plan thérapeutique'
              : 'Risque modéré à faible — continuer le traitement en cours',
          };
        } catch (e) {
          return { erreur: 'Service ML mortalité non disponible: ' + e.message };
        }
      }

      case 'predict_triage': {
        try {
          const r = await axios.post(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/triage`, {
            heart_rate:      input.heart_rate,
            systolic_bp:     input.systolic_bp,
            temperature:     input.temperature,
            resp_rate:       input.resp_rate,
            spo2:            input.spo2,
            chief_complaint: input.chief_complaint || '',
            age:             input.age || 50,
          }, { timeout: 8000 });
          const level = r.data?.risk_level || r.data?.triage_level || r.data?.prediction;
          const probs = r.data?.probabilities || {};
          return {
            source: 'Dataset Triage Urgences — Random Forest',
            niveau_triage: level,
            couleur: level === 'High' ? '🔴 ROUGE — Prise en charge IMMÉDIATE' : level === 'Medium' ? '🟠 ORANGE — Prise en charge < 30 min' : '🟢 VERT — Peut attendre',
            probabilites: {
              faible: Math.round((probs.Low || 0) * 100) + '%',
              moyen:  Math.round((probs.Medium || 0) * 100) + '%',
              eleve:  Math.round((probs.High || 0) * 100) + '%',
            },
          };
        } catch (e) {
          return { erreur: 'Service ML triage non disponible: ' + e.message };
        }
      }

      default:
        return { erreur: `Outil inconnu: ${toolName}` };
    }
  } catch (err) {
    return { erreur: err.message };
  }
}

/* ═══════════════════════════════════
   PROMPT SYSTÈME
═══════════════════════════════════ */
function buildSystemPrompt(userRole) {
  return `Tu es Claude, un assistant médical IA spécialisé en réanimation (ICU) intégré dans le système REA d'un hôpital algérien.

RÔLE DE L'UTILISATEUR: ${userRole}

TES CAPACITÉS (via outils MCP):
• Accéder aux dossiers patients en temps réel
• Consulter les paramètres vitaux
• Voir les prescriptions médicamenteuses
• Analyser les alertes actives
• Vérifier le stock de médicaments
• Lister tous les patients de l'unité
• Prédire les risques ICU avec IA (choc septique, détresse respiratoire, instabilité hémodynamique) — modèle XGBoost entraîné sur 50 000 relevés
• Prédire le risque de mortalité hospitalière — modèle Random Forest entraîné sur 91 713 patients (WiDS 2020)
• Déterminer le niveau de triage urgences (Low/Medium/High) — modèle entraîné sur dataset triage

MODÈLES IA DISPONIBLES:
1. predict_icu_risk — ICU4-XGBoost (Hôpital A, 50k relevés) → 3 risques: choc septique / insuffisance respiratoire / instabilité hémodynamique
2. predict_mortality — WiDS 2020 Random Forest (91 713 patients) → probabilité de décès hospitalier
3. predict_triage — Dataset Triage (urgences) → niveau de priorité Low/Medium/High

INSTRUCTIONS:
- Réponds TOUJOURS en français, de manière professionnelle et concise
- Utilise tes outils pour obtenir des données réelles avant de répondre
- Pour tout patient en REA, utilise systématiquement predict_icu_risk avec ses vitaux actuels
- Pour évaluer le pronostic vital, utilise predict_mortality
- Présente les probabilités ML avec leurs niveaux (FAIBLE/MODÉRÉ/ÉLEVÉ/CRITIQUE)
- Ne fais jamais de diagnostic définitif — seulement des analyses et suggestions basées sur les modèles
- Si tu vois des valeurs critiques, signale-les clairement avec ⚠️
- Adapte tes réponses au rôle (médecin vs infirmier)
- Sois précis avec les unités médicales (bpm, mmHg, °C, %)
- En cas d'urgence détectée par le modèle IA, recommande toujours d'appeler le médecin senior`;
}

/* ═══════════════════════════════════
   ROUTE STREAMING (comme ChatGPT)
═══════════════════════════════════ */
router.post('/stream', authenticate, async (req, res) => {
  const { message, patientId, history = [] } = req.body;

  // Headers SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // ── PRIORITÉ 1 : Gemini (si clé configurée) ──────────────────────────────────
  const hasGeminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10
    && !process.env.GEMINI_API_KEY.includes('METS-TA-CLE')
    && !process.env.ANTHROPIC_API_KEY?.includes('sk-ant-');

  if (hasGeminiKey) {
    try {
      await streamGemini(message, patientId, history, req.user.role, send, res);
      return;
    } catch (err) {
      console.error('[Gemini Error]', err.message);
      send({ type: 'error', text: 'Erreur Gemini: ' + err.message });
      res.end();
      return;
    }
  }

  // Vérifier clé API Claude
  const hasApiKey = process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('METS-TA-CLE');
  if (!hasApiKey) {

    // ── PRIORITÉ 2 : Service IA Pro (pro_medical_ai.py port 8085, Ollama inclus) ──
    try {
      send({ type: 'status', text: '🏥 Assistant IA Médical REA...' });
      const proResp = await axios.post(`${PRO_AI_URL}/api/chat`, {
        message,
        history: history.slice(-6),
        stream: false
      }, { timeout: 60000 });
      if (proResp.data?.answer) {
        send({ type: 'start' });
        const words = proResp.data.answer.split(/(\s+)/);
        for (const w of words) {
          send({ type: 'delta', text: w });
          await new Promise(r => setTimeout(r, 8));
        }
        send({ type: 'done', model: proResp.data.model || 'rea-pro' });
        res.end();
        return;
      }
    } catch (_) { /* service pro non disponible */ }

    // ── PRIORITÉ 2 : Base médicale Python (clinical_api.py port 8082) ──
    try {
      send({ type: 'status', text: '📋 Base médicale REA...' });
      const clinResp = await axios.post(`${CLINICAL_API}/api/chat`, {
        message
      }, { timeout: 5000 });
      const clinAnswer = clinResp.data?.answer;
      if (clinAnswer && !clinAnswer.startsWith("Je n'ai pas trouvé")) {
        send({ type: 'start' });
        const words = clinAnswer.split(/(\s+)/);
        for (const w of words) {
          send({ type: 'delta', text: w });
          await new Promise(r => setTimeout(r, 8));
        }
        send({ type: 'done', model: 'REA-Medical-Base' });
        res.end();
        return;
      }
    } catch (_) { /* service clinique non disponible */ }

    // ── PRIORITÉ 3 : Moteur REA local — MongoDB + ML service ──
    try {
      send({ type: 'status', text: '🏥 Analyse REA en cours...' });
      const smartResp = await generateSmartLocalResponse(message, patientId);
      send({ type: 'start' });
      const words = smartResp.answer.split(/(\s+)/);
      for (const w of words) {
        send({ type: 'delta', text: w });
        await new Promise(r => setTimeout(r, 8));
      }
      send({ type: 'done', model: smartResp.model });
      res.end();
      return;
    } catch (localErr) {
      console.error('[SmartLocal Error]', localErr.message);
    }

    // ── PRIORITÉ 4 : Réponse médicale de base ──
    const localResp = generateLocalResponse(message, null);
    send({ type: 'start' });
    const words = localResp.answer.split(/(\s+)/);
    for (const w of words) {
      send({ type: 'delta', text: w });
      await new Promise(r => setTimeout(r, 8));
    }
    send({ type: 'done', model: localResp.model });
    res.end();
    return;
  }

  try {
    const messages = [
      ...history.slice(-20),
      { role: 'user', content: message }
    ];

    // Phase 1 : outils MCP (sans streaming, pour récupérer les données)
    send({ type: 'status', text: '🔍 Consultation des données...' });

    const systemPrompt = [{ type: 'text', text: buildSystemPrompt(req.user.role), cache_control: { type: 'ephemeral' } }];
    let toolMessages = [...messages];
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      tools: MCP_TOOLS,
      messages: toolMessages
    });

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        send({ type: 'status', text: `📡 ${toolLabels[toolUse.name] || toolUse.name}...` });
        const result = await executerOutil(toolUse.name, toolUse.input);
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) });
      }

      toolMessages.push({ role: 'assistant', content: response.content });
      toolMessages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        tools: MCP_TOOLS,
        messages: toolMessages
      });
    }

    // Phase 2 : streaming de la réponse finale
    send({ type: 'start' });

    // Si Claude a déjà la réponse (stop_reason = end_turn)
    const finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    if (finalText) {
      // Streamer la réponse mot par mot
      const words = finalText.split(/(\s+)/);
      for (const chunk of words) {
        send({ type: 'delta', text: chunk });
        await new Promise(r => setTimeout(r, 15));
      }
    }

    send({ type: 'done', model: 'claude-sonnet-4-6' });
    res.end();

  } catch (err) {
    console.error('[Claude Stream Error]', err.message);
    send({ type: 'error', text: 'Erreur Claude API: ' + err.message });
    res.end();
  }
});

const toolLabels = {
  get_patient_info:   'Lecture du dossier patient',
  get_vitals:         'Récupération des vitaux',
  get_prescriptions:  'Consultation des ordonnances',
  get_alerts:         'Vérification des alertes',
  get_stock:          'Consultation du stock',
  list_patients:      'Liste des patients',
  predict_icu_risk:   '🤖 Prédiction ICU — XGBoost (50k relevés)',
  predict_mortality:  '🤖 Prédiction mortalité — WiDS 2020 (91k patients)',
  predict_triage:     '🤖 Triage urgences — Random Forest',
};

/* ═══════════════════════════════════
   ROUTE NON-STREAMING (compatibilité)
═══════════════════════════════════ */
router.post('/ask', authenticate, async (req, res) => {
  const { message, patientId, history = [] } = req.body;

  const hasApiKey = process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('METS-TA-CLE');
  if (!hasApiKey) {
    // Priorité 1 : Base médicale Python (port 8082)
    try {
      const clinResp = await axios.post(`${CLINICAL_API}/api/chat`, { message }, { timeout: 5000 });
      const clinAnswer = clinResp.data?.answer;
      if (clinAnswer && !clinAnswer.includes("Je n'ai pas trouvé")) {
        return res.json({ answer: clinAnswer, model: 'REA-Medical', sources: ['Base médicale REA'], confidence: 0.92 });
      }
    } catch (_) {}

    // Priorité 2 : Moteur local MongoDB + ML
    try {
      const smartResp = await generateSmartLocalResponse(message, patientId);
      return res.json({ answer: smartResp.answer, model: smartResp.model, sources: ['MongoDB REA', 'ICU4-XGBoost'], confidence: 0.88 });
    } catch (_) {}

    return res.json(generateLocalResponse(message, null));
  }

  try {
    const messages = [...history.slice(-20), { role: 'user', content: message }];
    const systemPrompt = [{ type: 'text', text: buildSystemPrompt(req.user.role), cache_control: { type: 'ephemeral' } }];

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      tools: MCP_TOOLS,
      messages
    });

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executerOutil(toolUse.name, toolUse.input);
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        tools: MCP_TOOLS,
        messages
      });
    }

    const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    res.json({ answer, model: 'claude-sonnet-4-6', sources: ['Claude AI + MCP REA'], confidence: 0.97 });

  } catch (err) {
    console.error('[Claude API Error]', err.message);
    res.json(generateLocalResponse(message, null));
  }
});

/* ═══════════════════════════════════════════════════════════
   MOTEUR REA LOCAL — MongoDB + ML service (sans clé API)
   Accède aux vraies données et modèles ICU4 / WiDS 2020
═══════════════════════════════════════════════════════════ */
async function generateSmartLocalResponse(message, patientId) {
  const msg = message.toLowerCase();
  const ML  = process.env.ML_SERVICE_URL || 'http://localhost:8000';
  const parts = [];

  // ── 1. Données patient si patientId fourni ──────────────────────────────
  let patient = null, vitals = null;
  if (patientId) {
    try { patient = await Patient.findById(patientId); } catch {}
    try { vitals  = await VitalSign.findOne({ patientId }).sort({ timestamp: -1 }); } catch {}
  }

  // ── 2. Détection intention ──────────────────────────────────────────────
  const askingVitals   = /vital|tension|fc|spo2|temp|respi|glasgow|fréquence|paramètre|constante|mesure|signes/i.test(msg);
  const askingPatient  = /patient|dossier|nom|admission|diagnostic|antécédent|traitement|info|données/i.test(msg);
  const askingRisk     = /risque|prédic|score|ia|modèle|probabilité|choc|septi|mortalité|décès|danger/i.test(msg);
  const askingAll      = /tous|liste|tous les patients|unité|service/i.test(msg);
  const anyPatientQuery = askingVitals || askingPatient || askingRisk;

  // ── Liste tous les patients ─────────────────────────────────────────────
  if (askingAll && !patientId) {
    try {
      const patients = await Patient.find({ isActive: true }).sort({ admissionDate: -1 }).limit(10);
      parts.push(`**Patients actifs dans l'unité REA (${patients.length})**\n`);
      patients.forEach(p => {
        const ug = { ROUGE: '🔴', ORANGE: '🟠', JAUNE: '🟡', VERT: '🟢' }[p.urgencyLevel] || '⚪';
        parts.push(`${ug} **${p.firstName} ${p.lastName}** — Lit ${p.bedNumber || '?'} | ${p.status} | ${p.admissionReason?.slice(0, 50) || '—'}`);
      });
      return { answer: parts.join('\n'), model: 'REA-MongoDB' };
    } catch {}
  }

  // ── Alertes actives pour le patient ────────────────────────────────────
  const askingAlerts = /alert|alerte|alarme|urgence|critique|actif|actuel|maintenant/i.test(msg);

  if (askingAlerts && patientId) {
    try {
      const activeAlerts = await Alert.find({ patientId, resolved: false }).sort({ createdAt: -1 }).limit(10);
      if (activeAlerts.length > 0) {
        parts.push(`## ⚠️ Alertes actives — ${patient?.firstName || ''} ${patient?.lastName || ''}\n`);
        activeAlerts.forEach(a => {
          const icon = a.severity === 'CRITICAL' ? '🔴' : a.severity === 'HIGH' ? '🟠' : '🟡';
          const ack = a.acknowledged ? ' ✓' : '';
          parts.push(`${icon} **[${a.severity}]** ${a.message}${ack}`);
          parts.push(`   *${new Date(a.createdAt).toLocaleTimeString('fr-FR')}*\n`);
        });
      } else {
        parts.push(`## ✅ Aucune alerte active\nAucune alerte non résolue pour ce patient.`);
      }
      return { answer: parts.join('\n'), model: 'REA-MongoDB' };
    } catch {}
  }

  if (askingAlerts && !patientId) {
    try {
      const activeAlerts = await Alert.find({ resolved: false }).sort({ createdAt: -1 }).limit(15)
        .populate('patientId', 'firstName lastName bedNumber');
      if (activeAlerts.length > 0) {
        parts.push(`## ⚠️ Alertes actives dans l'unité (${activeAlerts.length})\n`);
        activeAlerts.forEach(a => {
          const icon = a.severity === 'CRITICAL' ? '🔴' : a.severity === 'HIGH' ? '🟠' : '🟡';
          const name = a.patientId ? `${a.patientId.firstName} ${a.patientId.lastName}` : '—';
          const bed = a.patientId?.bedNumber || '?';
          const ack = a.acknowledged ? ' ✓' : '';
          parts.push(`${icon} **${name}** (${bed}) — ${a.message}${ack}`);
        });
      } else {
        parts.push(`## ✅ Aucune alerte active\nTous les patients sont stables.`);
      }
      return { answer: parts.join('\n'), model: 'REA-MongoDB' };
    } catch {}
  }

  // ── Réponse patient sélectionné (avec ou sans vitaux) ──────────────────
  if (patient && (anyPatientQuery || patientId)) {
    const hr  = vitals?.heartRate?.value;
    const sp  = vitals?.spo2?.value;
    const rr  = vitals?.respRate?.value;
    const tmp = vitals?.temperature?.value;
    const sys = vitals?.systolicBP?.value;
    const dia = vitals?.diastolicBP?.value;
    const gcs = vitals?.glasgow?.value;
    const map = sys && dia ? Math.round((sys + 2 * dia) / 3) : null;

    parts.push(`## 📊 ${patient.firstName} ${patient.lastName} — Lit ${patient.bedNumber || '?'}\n`);
    parts.push(`**Admission :** ${patient.admissionReason || '—'}`);
    parts.push(`**Statut :** ${patient.status} | **Urgence :** ${patient.urgencyLevel}\n`);

    if ((askingVitals || askingRisk) && vitals) {
      parts.push(`### Paramètres vitaux (temps réel)`);
      parts.push(`| Paramètre | Valeur | Alarme |`);
      parts.push(`|-----------|--------|--------|`);
      if (hr)  parts.push(`| FC | **${hr} bpm** | ${vitals.heartRate?.alarm === 'CRITICAL' ? '🔴 CRITIQUE' : vitals.heartRate?.alarm === 'WARNING' ? '🟠 ALERTE' : '🟢'} |`);
      if (sp)  parts.push(`| SpO₂ | **${sp}%** | ${vitals.spo2?.alarm === 'CRITICAL' ? '🔴 CRITIQUE' : vitals.spo2?.alarm === 'WARNING' ? '🟠 ALERTE' : '🟢'} |`);
      if (sys) parts.push(`| PA | **${sys}/${dia} mmHg** | ${vitals.systolicBP?.alarm === 'CRITICAL' ? '🔴 CRITIQUE' : '🟢'} |`);
      if (map) parts.push(`| PAM | **${map} mmHg** | ${map < 65 ? '🔴 CRITIQUE' : '🟢'} |`);
      if (rr)  parts.push(`| FR | **${rr} /min** | ${vitals.respRate?.alarm === 'CRITICAL' ? '🔴 CRITIQUE' : '🟢'} |`);
      if (tmp) parts.push(`| Température | **${tmp}°C** | ${vitals.temperature?.alarm === 'CRITICAL' ? '🔴 CRITIQUE' : '🟢'} |`);
      if (gcs) parts.push(`| Glasgow | **${gcs}/15** | ${gcs <= 8 ? '🔴 COMA' : gcs <= 12 ? '🟠' : '🟢'} |`);
      parts.push('');
    }

    // ── Prédiction ML ICU4 ────────────────────────────────────────────────
    if (vitals && (askingRisk || askingVitals) && hr && sp && rr && tmp && map) {
      try {
        const mlRes = await axios.post(`${ML}/predict-icu4-alerts`, {
          heart_rate: hr, spo2: sp, resp_rate: rr, temperature: tmp, map_value: map
        }, { timeout: 6000 });
        const p = mlRes.data.icu4_predictions || {};
        const septic = Math.round((p.septic_shock?.probability    || 0) * 100);
        const resp   = Math.round((p.resp_failure?.probability    || 0) * 100);
        const hemo   = Math.round((p.hemo_instability?.probability || 0) * 100);

        const maxRisk  = Math.max(septic, resp, hemo);
        const globalLv = maxRisk >= 70 ? '🔴 CRITIQUE' : maxRisk >= 45 ? '🟠 ÉLEVÉ' : maxRisk >= 25 ? '🟡 MODÉRÉ' : '🟢 FAIBLE';
        const bar = (v) => '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
        const lv  = (v) => v >= 60 ? '🔴' : v >= 30 ? '🟠' : '🟢';

        parts.push(`\n---`);
        parts.push(`## 🤖 Score IA — ${globalLv}`);
        parts.push(`**Score ICU Global : ${maxRisk}%**\n`);
        parts.push(`🦠 **Choc Septique**`);
        parts.push(`${lv(septic)} ${bar(septic)} **${septic}%**\n`);
        parts.push(`🫁 **Insuffisance Respiratoire**`);
        parts.push(`${lv(resp)} ${bar(resp)} **${resp}%**\n`);
        parts.push(`💉 **Instabilité Hémodynamique**`);
        parts.push(`${lv(hemo)} ${bar(hemo)} **${hemo}%**\n`);
        parts.push(`*ICU4-XGBoost — 50 000 relevés · Hôpital A*`);
        parts.push(`---`);

        if (maxRisk >= 60) parts.push(`⚠️ **ALERTE CRITIQUE** — Appeler le médecin réanimateur immédiatement.`);
        else if (maxRisk >= 30) parts.push(`⚠️ Surveillance rapprochée recommandée.`);
        else parts.push(`✅ Aucun risque critique détecté actuellement.`);
      } catch {
        parts.push(`\n*Service ML non disponible — démarrer : \`uvicorn api:app --port 8000\` dans ml-service/*`);
      }
    }

    if (!vitals) parts.push(`\n*Aucun relevé vital disponible pour ce patient — le simulateur doit être actif.*`);

    // ── Antécédents + diagnostics ─────────────────────────────────────────
    if (askingPatient) {
      if (patient.chronicDiseases?.length) parts.push(`\n**Antécédents :** ${patient.chronicDiseases.join(', ')}`);
      if (patient.diagnoses?.length)       parts.push(`**Diagnostics :** ${patient.diagnoses.map(d => d.label).join(', ')}`);
    }

    return { answer: parts.join('\n'), model: 'REA-MongoDB + ICU4-XGBoost' };
  }

  // ── Pas de patient sélectionné mais question sur les vitaux ────────────
  if (askingVitals && !patientId) {
    try {
      const latestVitals = await VitalSign.find().sort({ timestamp: -1 }).limit(6).populate('patientId', 'firstName lastName bedNumber');
      if (latestVitals.length > 0) {
        parts.push(`**Derniers relevés vitaux dans l'unité**\n`);
        latestVitals.forEach(v => {
          const name = v.patientId ? `${v.patientId.firstName} ${v.patientId.lastName}` : '—';
          const bed  = v.patientId?.bedNumber || '?';
          const alarm = v.overallAlarm === 'CRITICAL' ? '🔴' : v.overallAlarm === 'WARNING' ? '🟠' : '🟢';
          parts.push(`${alarm} **${name}** (${bed}) — FC: ${v.heartRate?.value ?? '—'} | SpO₂: ${v.spo2?.value ?? '—'}% | T°: ${v.temperature?.value ?? '—'}°C`);
        });
        return { answer: parts.join('\n'), model: 'REA-MongoDB' };
      }
    } catch {}
  }

  // ── Réponse médicale générale (fallback final) ──────────────────────────
  return generateLocalResponse(message, null);
}

/* ═══════════════════════════════════
   FALLBACK LOCAL (si pas de clé API)
═══════════════════════════════════ */
function generateLocalResponse(message, ctx) {
  const msg = message.toLowerCase();
  let answer = '';

  // ── Réponses médicales locales (sans IA externe) ────────────────────────
  if (msg.match(/choc septique|sepsis|septic/)) {
    answer = `**Choc Septique — Signes cliniques**\n\n⚠️ Critères Sepsis-3 :\n- PAM <65 mmHg malgré remplissage\n- Lactate >2 mmol/L\n- Vasopresseurs nécessaires\n\n**Signes :**\n- Fièvre >38.3°C ou hypothermie <36°C\n- Tachycardie FC >100 bpm\n- Tachypnée FR >20/min\n- Marbrures, oligurie, confusion\n\n**Bundle 1h :**\n1. Hémocultures avant ATB\n2. Antibiotiques large spectre IV\n3. Remplissage 30 mL/kg\n4. Noradrénaline si PAM <65`;
  } else if (msg.match(/glasgow|gcs|conscience/)) {
    answer = `**Score de Glasgow (GCS)**\n\n**Ouverture des yeux :** Spontanée=4, Voix=3, Douleur=2, Aucune=1\n**Réponse verbale :** Orientée=5, Confuse=4, Mots=3, Sons=2, Aucune=1\n**Réponse motrice :** Ordres=6, Localise=5, Retrait=4, Flexion=3, Extension=2, Aucune=1\n\n⚠️ GCS ≤8 = COMA → protection voies aériennes requise`;
  } else if (msg.match(/sofa|apache|news|score/)) {
    answer = `**Scores de gravité en Réanimation**\n\n**SOFA** (0-24) : évalue 6 organes. Score >11 = mortalité >50%\n**APACHE II** (0-71) : prédit mortalité ICU. >34 = mortalité >80%\n**NEWS2** (0-20) : détection détérioration précoce. ≥7 = critique\n**Glasgow** (3-15) : niveau de conscience. ≤8 = coma`;
  } else if (msg.match(/sdra|ards|detresse respiratoire/)) {
    answer = `**SDRA — Syndrome de Détresse Respiratoire Aiguë**\n\nDéfinition Berlin : PaO2/FiO2 <300 + opacités bilatérales + début <1 semaine\n\n⚠️ Sévère : PaO2/FiO2 <100 → mortalité 45%\n\n**Traitement :**\n- VT 6 mL/kg, plateau <30 cmH2O\n- PEEP 10-15 cmH2O\n- Décubitus ventral >16h/j si <150`;
  } else if (msg.match(/infarctus|idm|stemi|coronar/)) {
    answer = `**Infarctus du Myocarde (STEMI)**\n\n⚠️ Signes : douleur thoracique constrictive >20min, irradiation bras gauche, sueurs\n\nECG : sus-décalage ST ≥1mm dans ≥2 dérivations\n\n**Traitement (fenêtre 2h) :**\n1. Aspirine 250mg + Ticagrelor 180mg\n2. Héparine IV\n3. ⚠️ Coronarographie + Angioplastie <2h`;
  } else if (msg.match(/avc|stroke|accident vasculaire/)) {
    answer = `**AVC — Score FAST**\n\n- **F**ace : asymétrie faciale\n- **A**rm : déficit moteur bras\n- **S**peech : trouble parole\n- **T**ime : ⚠️ Appeler le SAMU immédiatement\n\n**Thrombolyse IV** (Alteplase) : jusqu'à 4h30 après début\n**Thrombectomie** : jusqu'à 24h si occlusion`;
  } else if (msg.match(/noradrenaline|vasopresseur|dopamine|dobutamine/)) {
    answer = `**Vasopresseurs en Réanimation**\n\n- **Noradrénaline** : 1er choix choc septique. 0.1-3 mcg/kg/min. Cible PAM ≥65\n- **Adrénaline** : choc anaphylactique 0.5mg IM / ACR 1mg IV\n- **Dobutamine** : choc cardiogénique. 2.5-20 mcg/kg/min\n\n⚠️ Tout vasopresseur = VVC obligatoire`;
  } else if (msg.match(/hypokali|hyperkali|potassium/)) {
    answer = `**Hyperkaliémie K+ >6.5 mmol/L — URGENCE**\n\n1. Gluconate calcium 10% : 10-20mL IV (protège le cœur)\n2. Insuline 10UI + G30% 60mL IV\n3. Salbutamol nébulisé 10mg\n4. Furosemide si diurèse conservée\n5. ⚠️ Dialyse si IRA stade 3`;
  } else if (msg.match(/intubation|intuber|voies aeriennes/)) {
    answer = `**Intubation Orotrachéale (ISR)**\n\n1. Préoxygénation 3-5 min SpO2 >95%\n2. Induction : Etomidate 0.3mg/kg + Succinylcholine 1.5mg/kg\n3. Laryngoscopie + introduction tube\n4. Vérification : capnographie ETCO2 + auscultation\n\n**Réglages :** VT 6-8 mL/kg, FR 12-16/min, PEEP 5, FiO2 1.0`;
  } else if (msg.match(/bonjour|bonsoir|salut|hello|salam|aide/)) {
    answer = `Bonjour ! Je suis l'assistant IA REA.\n\nJe peux vous aider avec :\n• Scores médicaux (Glasgow, SOFA, APACHE, NEWS2)\n• Urgences (choc septique, ACR, SDRA, IDM, AVC)\n• Médicaments et vasopresseurs\n• Procédures (intubation, VVC)\n• Toutes questions médicales\n\nPosez votre question médicale !`;
  } else if (msg.match(/patient|vital|alerte|tension|fc |spo2/)) {
    answer = `Pour accéder aux données patients en temps réel (vitaux, alertes, dossiers), configurez votre clé API :\n\nFichier : C:\\Users\\DELL\\rea\\backend\\.env\nANTHROPIC_API_KEY=sk-ant-votre-cle\n\nSans la clé, je peux répondre aux questions médicales générales.`;
  } else {
    // Réponse médicale générique
    answer = `Je suis l'assistant REA-Medical.\n\nJe peux répondre à vos questions sur :\n• Choc septique, SDRA, ACR, AVC, IDM\n• Scores : Glasgow, SOFA, APACHE, NEWS2\n• Médicaments : vasopresseurs, sédation, analgésie\n• Procédures : intubation, VVC, drainage\n• Toute question médicale\n\nReformullez votre question avec des mots clés médicaux.`;
  }

  return { answer, model: 'rea-medical-local', sources: ['Base REA-Medical'], confidence: 0.75 };
}

/* ═══════════════════════════════════════════════════════════════
   ROUTE AGENT IA COMPLET — prédictions + patients critiques + stock
═══════════════════════════════════════════════════════════════ */
router.post('/agent-analyze', authenticate, async (req, res) => {
  try {
    const { message, vitals, patientId, age, sex, chronicDiseases, diagnoses, admissionReason } = req.body;
    const ML = process.env.ML_SERVICE_URL || 'http://localhost:8000';

    // ── 1. Appel ML service agent-full-analysis ────────────────────────────
    let mlData = null;
    try {
      const mlRes = await axios.post(`${ML}/agent-full-analysis`, {
        message: message || '',
        vitals: vitals || {},
        patient_id: patientId || 'agent',
        age: age || 50,
        sex: sex || 'M',
        chronic_diseases: chronicDiseases || [],
        diagnoses: diagnoses || [],
        admission_reason: admissionReason || '',
      }, { timeout: 15000 });
      mlData = mlRes.data;
    } catch (e) {
      console.error('[Agent] ML service indisponible, calcul local:', e.message);
      // Calcul local simplifié basé sur les signes vitaux
      const v = vitals || {};
      const hr  = v.heart_rate  || 80;
      const sp  = v.spo2        || 98;
      const rr  = v.resp_rate   || 16;
      const tmp = v.temperature || 37;
      const sbp = v.systolic_bp || 120;
      const gcs = v.glasgow     || 15;
      let risk = 0;
      if (hr > 120 || hr < 50)  risk += 25;
      if (sp < 90)               risk += 30;
      if (rr > 30 || rr < 8)    risk += 20;
      if (tmp > 39 || tmp < 35) risk += 15;
      if (sbp < 90)              risk += 30;
      if (gcs <= 8)              risk += 35;
      risk = Math.min(risk, 95);
      mlData = {
        predictions: {
          mortality:  { probability: risk, risk_percent: risk },
          icu4: { septic_shock: risk > 50 ? risk - 20 : 0, resp_failure: sp < 90 ? 60 : 0, hemo_instability: sbp < 90 ? 65 : 0 },
          triage: { level: risk > 60 ? 'ROUGE' : risk > 30 ? 'ORANGE' : 'VERT', score: risk },
          overall_risk: risk > 60 ? 'CRITICAL' : risk > 30 ? 'HIGH' : 'LOW',
          feature_importance: [
            { label: 'SpO2', importance: Math.round((100 - sp)), critical: sp < 90, current_value: sp, unit: '%' },
            { label: 'FC',   importance: Math.round(Math.abs(hr - 80) / 1.5), critical: hr > 120, current_value: hr, unit: 'bpm' },
            { label: 'PAM',  importance: Math.round(Math.max(0, 90 - sbp)), critical: sbp < 90, current_value: sbp, unit: 'mmHg' },
          ],
          recommendations: risk > 60
            ? ['Surveillance continue — patient en état critique', 'Vérifier voies aériennes et ventilation', 'Bilan biologique urgent']
            : risk > 30
            ? ['Surveillance rapprochée recommandée', 'Réévaluation clinique dans 1h']
            : ['État stable — surveillance standard'],
          source: 'calcul-local',
        }
      };
    }

    // ── 2. Patients critiques (MongoDB) ────────────────────────────────────
    let criticalPatients = [];
    try {
      const Patient   = require('../models/Patient');
      const VitalSign = require('../models/VitalSign');
      const patients  = await Patient.find({ isActive: true, status: { $in: ['CRITIQUE','URGENT','STABLE','AMÉLIORATION'] } })
        .select('firstName lastName bedNumber urgencyLevel admissionReason age sex gravityScore mortalityRisk24h')
        .sort({ urgencyLevel: -1 }).limit(10).lean();

      criticalPatients = await Promise.all(patients.map(async p => {
        const v = await VitalSign.findOne({ patientId: p._id }).sort({ timestamp: -1 }).lean();
        return {
          _id:      p._id,
          name:     `${p.firstName} ${p.lastName}`,
          bed:      p.bedNumber,
          urgency:  p.urgencyLevel,
          age:      p.age,
          reason:   p.admissionReason,
          alarm:    v?.overallAlarm || 'NORMAL',
          hr:       v?.heartRate?.value,
          spo2:     v?.spo2?.value,
          sbp:      v?.systolicBP?.value,
          gcs:      v?.glasgow?.value,
        };
      }));
      criticalPatients = criticalPatients.filter(p => p.alarm === 'CRITICAL' || p.urgency === 'ROUGE' || p.urgency === 'ORANGE');
    } catch (e) { console.error('[Agent] Patients error:', e.message); }

    // ── 3. Médicaments stock faible ────────────────────────────────────────
    let lowStock = [];
    try {
      const Medicament = require('../models/Medicament');
      lowStock = await Medicament.find({ $expr: { $lt: ['$quantity', '$minQuantity'] } })
        .select('name quantity minQuantity unit category')
        .sort({ quantity: 1 }).limit(8).lean();
    } catch (e) { console.error('[Agent] Stock error:', e.message); }

    // ── 4. Alertes actives ─────────────────────────────────────────────────
    let activeAlerts = [];
    try {
      const Alert = require('../models/Alert');
      activeAlerts = await Alert.find({ resolved: false, severity: 'CRITICAL' })
        .sort({ createdAt: -1 }).limit(5)
        .populate('patientId', 'firstName lastName bedNumber').lean();
    } catch (e) { console.error('[Agent] Alerts error:', e.message); }

    res.json({
      predictions:      mlData?.predictions || mlData || {},
      criticalPatients,
      lowStock,
      activeAlerts: activeAlerts.map(a => ({
        id:       a._id,
        severity: a.severity,
        message:  a.message,
        patient:  a.patientId ? `${a.patientId.firstName} ${a.patientId.lastName}` : '—',
        bed:      a.patientId?.bedNumber || '?',
        time:     a.createdAt,
      })),
    });
  } catch (e) {
    console.error('[Agent] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════
   ROUTE STATUS — quel moteur IA est actif
═══════════════════════════════════ */
router.get('/ai-status', authenticate, (req, res) => {
  const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10
    && !process.env.GEMINI_API_KEY.includes('METS-TA-CLE');
  const hasClaude = process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('METS-TA-CLE');

  if (hasGemini)  return res.json({ model: 'gemini',  label: 'Gemini 1.5 Flash' });
  if (hasClaude)  return res.json({ model: 'claude',  label: 'Claude Sonnet' });
  return res.json({ model: 'local', label: 'REA-Medical Local' });
});

module.exports = router;
