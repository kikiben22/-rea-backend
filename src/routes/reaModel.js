/**
 * REA-Medical LLM — Route Ollama (modèle fine-tuné local)
 * Fallback si pas de clé Anthropic, ou pour usage hors-ligne
 *
 * POST /api/rea-model/chat      — réponse complète
 * POST /api/rea-model/stream    — streaming SSE
 * GET  /api/rea-model/status    — état du modèle
 */

const express = require('express');
const axios   = require('axios');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const MODEL_NAME   = process.env.REA_MODEL   || 'rea-medical';   // modèle fine-tuné
const MODEL_BASE   = process.env.OLLAMA_MODEL || 'llama3.2:1b';   // fallback

/* ── Système prompt de base ─────────────────────────── */
const SYSTEM_PROMPT = `Tu es REA-Medical, un assistant IA spécialisé en réanimation et médecine d'urgence.

Tes domaines d'expertise :
- Triage et évaluation des patients (NEWS2, SOFA, APACHE)
- Interprétation des signes vitaux en temps réel
- Orientation vers le bon service hospitalier
- Analyse des risques cliniques
- Dictionnaire des variables ICU (WiDS)

Règles :
- Réponds toujours en français
- Signale IMMÉDIATEMENT les valeurs critiques avec ⚠️
- Ne pose jamais de diagnostic définitif seul
- Recommande toujours l'avis médical senior pour les cas urgents`;


/* ── Vérifier si le modèle fine-tuné est disponible ── */
async function getAvailableModel() {
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    const models = res.data?.models?.map(m => m.name) || [];
    if (models.some(m => m.startsWith(MODEL_NAME))) return MODEL_NAME;
    if (models.some(m => m.startsWith(MODEL_BASE.split(':')[0]))) return MODEL_BASE;
    return null;
  } catch {
    return null;
  }
}


/* ══════════════════════════════════════
   GET /api/rea-model/status
══════════════════════════════════════ */
router.get('/status', authenticate, async (req, res) => {
  const model = await getAvailableModel();
  if (!model) {
    return res.json({
      available: false,
      message: 'Ollama non disponible. Installez Ollama et lancez le modèle rea-medical.',
      install: 'https://ollama.com',
      setup: [
        'ollama pull llama3.2:1b',
        'cd C:\\Users\\DELL\\rea\\training',
        'python generate_training_data.py',
        'python finetune_ollama.py'
      ]
    });
  }

  const isFinetuned = model === MODEL_NAME;
  res.json({
    available:  true,
    model,
    finetuned:  isFinetuned,
    ollama_url: OLLAMA_URL,
    message:    isFinetuned
      ? `Modèle REA-Medical fine-tuné actif (${MODEL_NAME})`
      : `Modèle de base actif (${model}) — fine-tuning recommandé`
  });
});


/* ══════════════════════════════════════
   POST /api/rea-model/chat
   Réponse complète (non-streaming)
══════════════════════════════════════ */
router.post('/chat', authenticate, async (req, res) => {
  const { message, history = [], patientContext = null } = req.body;

  const model = await getAvailableModel();
  if (!model) {
    return res.status(503).json({
      error: 'Modèle REA-Medical non disponible. Lancez Ollama et installez le modèle.'
    });
  }

  // Construire les messages
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  // Ajouter contexte patient si fourni
  if (patientContext) {
    messages.push({
      role: 'user',
      content: `Contexte patient :\n${JSON.stringify(patientContext, null, 2)}`
    });
    messages.push({
      role: 'assistant',
      content: 'Compris. J\'ai pris en compte les données du patient. Comment puis-je vous aider ?'
    });
  }

  // Historique de conversation
  messages.push(...history.slice(-8).map(h => ({
    role:    h.role === 'user' ? 'user' : 'assistant',
    content: h.content
  })));

  messages.push({ role: 'user', content: message });

  try {
    const start = Date.now();
    const response = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      {
        model,
        messages,
        stream: false,
        options: {
          temperature:    0.3,
          top_p:          0.85,
          repeat_penalty: 1.1,
          num_ctx:        4096
        }
      },
      { timeout: 60000 }
    );

    const answer = response.data?.message?.content || 'Aucune réponse générée.';
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    res.json({
      answer,
      model,
      finetuned: model === MODEL_NAME,
      duration_sec: parseFloat(duration),
      tokens: response.data?.eval_count || null
    });

  } catch (err) {
    console.error('[REA-Model] Erreur Ollama:', err.message);
    res.status(500).json({ error: `Erreur modèle : ${err.message}` });
  }
});


/* ══════════════════════════════════════
   POST /api/rea-model/stream
   Streaming SSE (comme ChatGPT)
══════════════════════════════════════ */
router.post('/stream', authenticate, async (req, res) => {
  const { message, history = [], patientContext = null } = req.body;

  // Headers SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const model = await getAvailableModel();
  if (!model) {
    send({ type: 'error', text: 'Modèle REA-Medical non disponible. Installez Ollama.' });
    res.end();
    return;
  }

  send({ type: 'status', text: `Modèle ${model} en cours...` });

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (patientContext) {
    messages.push({ role: 'user',      content: `Contexte patient :\n${JSON.stringify(patientContext, null, 2)}` });
    messages.push({ role: 'assistant', content: 'Compris. Comment puis-je vous aider ?' });
  }

  messages.push(...history.slice(-8).map(h => ({
    role: h.role === 'user' ? 'user' : 'assistant', content: h.content
  })));
  messages.push({ role: 'user', content: message });

  try {
    const ollamaRes = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      {
        model,
        messages,
        stream: true,
        options: { temperature: 0.3, top_p: 0.85, repeat_penalty: 1.1, num_ctx: 4096 }
      },
      { responseType: 'stream', timeout: 90000 }
    );

    send({ type: 'start' });

    let buffer = '';
    ollamaRes.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            send({ type: 'delta', text: json.message.content });
          }
          if (json.done) {
            send({ type: 'done', model, tokens: json.eval_count });
          }
        } catch {}
      }
    });

    ollamaRes.data.on('end', () => {
      send({ type: 'done', model, finetuned: model === MODEL_NAME });
      res.end();
    });

    ollamaRes.data.on('error', (err) => {
      send({ type: 'error', text: err.message });
      res.end();
    });

  } catch (err) {
    console.error('[REA-Model Stream] Erreur:', err.message);
    send({ type: 'error', text: 'Erreur connexion Ollama : ' + err.message });
    res.end();
  }
});


/* ══════════════════════════════════════
   POST /api/rea-model/triage
   Triage rapide structuré
══════════════════════════════════════ */
router.post('/triage', authenticate, async (req, res) => {
  const { age, gender, chief_complaint, symptoms, systolic_bp, heart_rate,
          temperature, resp_rate, spo2, duration, allergies, medications, conditions } = req.body;

  const model = await getAvailableModel();
  if (!model) {
    return res.status(503).json({ error: 'Modèle non disponible' });
  }

  // Calcul NEWS2 côté serveur
  let news = 0;
  if (resp_rate) {
    const rr = parseFloat(resp_rate);
    if (rr <= 8 || rr >= 25) news += 3;
    else if (rr >= 21) news += 2;
    else if (rr <= 11) news += 1;
  }
  if (spo2) {
    const s = parseFloat(spo2);
    if (s <= 91) news += 3;
    else if (s <= 93) news += 2;
    else if (s <= 95) news += 1;
  }
  if (systolic_bp) {
    const bp = parseFloat(systolic_bp);
    if (bp <= 90) news += 3;
    else if (bp <= 100) news += 2;
    else if (bp <= 110) news += 1;
    else if (bp >= 220) news += 3;
  }
  if (heart_rate) {
    const hr = parseFloat(heart_rate);
    if (hr <= 40 || hr >= 131) news += 3;
    else if (hr >= 111) news += 2;
    else if (hr <= 50 || hr >= 91) news += 1;
  }
  if (temperature) {
    const t = parseFloat(temperature);
    if (t <= 35.0) news += 3;
    else if (t <= 36.0) news += 1;
    else if (t >= 39.1) news += 2;
    else if (t >= 38.1) news += 1;
  }

  const prompt = `Effectuez le triage complet de ce patient :

Patient : ${gender === 'M' ? 'Homme' : 'Femme'}, ${age} ans
Motif : ${chief_complaint}
Symptômes : ${symptoms || 'Non précisés'}
Signes vitaux :
  PA systolique : ${systolic_bp || '?'} mmHg
  Fréquence cardiaque : ${heart_rate || '?'} bpm
  Température : ${temperature || '?'} °C
  Fréquence respiratoire : ${resp_rate || '?'} /min
  SpO2 : ${spo2 || '?'} %
Durée : ${duration || 'Inconnue'}
Allergies : ${allergies || 'Aucune'}
Médicaments : ${medications || 'Aucun'}
Antécédents : ${conditions || 'Aucun'}
NEWS2 pré-calculé : ${news}

Donnez : niveau de risque, service recommandé, analyse des vitaux, actions prioritaires.`;

  try {
    const response = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: prompt }
        ],
        stream: false,
        options: { temperature: 0.2, top_p: 0.85, num_ctx: 4096 }
      },
      { timeout: 60000 }
    );

    const answer = response.data?.message?.content || '';

    // Détecter le niveau de risque dans la réponse
    let detectedRisk = 'LOW';
    if (/HIGH|ÉLEVÉ|CRITIQUE|URGENT/i.test(answer)) detectedRisk = 'HIGH';
    else if (/MEDIUM|MOYEN|MODÉRÉ/i.test(answer))   detectedRisk = 'MEDIUM';

    res.json({
      analysis: answer,
      news2_score: news,
      risk_detected: detectedRisk,
      model,
      finetuned: model === MODEL_NAME
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
