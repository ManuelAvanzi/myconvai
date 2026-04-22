const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json');
const LOG_PATH = path.join(DATA_DIR, 'conversations.log');

const DEFAULT_CONFIG = {
  model: 'Qwen/Qwen2.5-7B-Instruct',
  systemPrompt: 'Sei NEO, un robottino guida in una scena 3D. Rispondi in italiano in modo chiaro, utile e sicuro.',
  personality: 'Calmo, collaborativo, curioso, concreto.',
  proactive: true,
  narrativeDesign: {
    enabled: true,
    objective: "Guidare l'utente in una mini-esplorazione e far avanzare la conversazione con micro-obiettivi.",
    style: 'Narrativa interattiva a step (obiettivo corrente, breve proposta, attesa input).'
  },
  ragTopK: 3,
  temperature: 0.6,
  maxNewTokens: 220,
  speakResponses: true,
  cameraRig: {
    lookSensitivity: 0.0025,
    moveSpeed: 5.2,
    invertY: false
  },
  sceneLighting: {
    ambientIntensity: 1.0,
    keyIntensity: 1.25,
    rimIntensity: 0.9,
    accentIntensity: 0.7,
    keyColor: '#ffffff',
    rimColor: '#57b2ff',
    accentColor: '#ff7a45',
    fogNear: 10,
    fogFar: 82,
    monolithGlow: 0.22
  },
  aiAct: {
    transparencyNotice: true,
    loggingEnabled: true,
    humanOversight: true,
    safetyMode: true,
    riskTier: 'limited'
  }
};

const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || PORT),
  HF_TOKEN: process.env.HF_TOKEN || '',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || 'change-me',
  CHAT_RATE_LIMIT_PER_MIN: Number(process.env.CHAT_RATE_LIMIT_PER_MIN || 30),
  ADMIN_RATE_LIMIT_PER_MIN: Number(process.env.ADMIN_RATE_LIMIT_PER_MIN || 120)
};

const ADMIN_PATHS = new Set([
  '/dashboard.html',
  '/dashboard.js',
  '/api/config',
  '/api/knowledge'
]);

const rateState = new Map();

const DEFAULT_KNOWLEDGE = {
  documents: [
    {
      id: 'intro-1',
      title: 'Benvenuto',
      content: "Questo progetto mostra un NPC robottino in Three.js/WebXR. L'utente puo parlare via voce in visore o via chat su desktop e smartphone."
    },
    {
      id: 'intro-2',
      title: 'Narrative Design',
      content: 'Lo stile narrative design combina obiettivi conversazionali, decisioni e trigger invece di un dialog tree rigido.'
    }
  ]
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

ensureDataFiles();

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  if (!fs.existsSync(KNOWLEDGE_PATH)) fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(DEFAULT_KNOWLEDGE, null, 2));
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function isAdminPath(pathname) {
  return ADMIN_PATHS.has(pathname);
}

function parseBasicAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  try {
    const base64 = header.slice('Basic '.length);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return {
      username: decoded.slice(0, idx),
      password: decoded.slice(idx + 1)
    };
  } catch {
    return null;
  }
}

function requireBasicAuth(req, res) {
  const auth = parseBasicAuth(req);
  const ok = auth && auth.username === ENV.ADMIN_USER && auth.password === ENV.ADMIN_PASS;
  if (ok) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="MyConvai Dashboard"',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

function checkRateLimit(req, res, scope, maxPerMinute) {
  const now = Date.now();
  const key = `${scope}:${getClientIp(req)}`;
  const bucket = rateState.get(key) || [];
  const recent = bucket.filter((ts) => now - ts < 60_000);
  if (recent.length >= maxPerMinute) {
    sendJson(res, 429, { error: 'Rate limit exceeded. Riprova tra poco.' });
    return false;
  }
  recent.push(now);
  rateState.set(key, recent);
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length > 2);
}

function scoreByOverlap(queryTokens, docText) {
  const docTokens = new Set(tokenize(docText));
  let score = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) score += 1;
  }
  return score;
}

function retrieveKnowledge(message, knowledge, topK) {
  const queryTokens = tokenize(message);
  const docs = Array.isArray(knowledge.documents) ? knowledge.documents : [];
  return docs
    .map((doc) => ({
      doc,
      score: scoreByOverlap(queryTokens, `${doc.title || ''} ${doc.content || ''}`)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.doc);
}

function composePrompt(config, history, message, retrievedDocs) {
  const historyChunk = (history || [])
    .slice(-8)
    .map((turn) => `${turn.role === 'assistant' ? 'NPC' : 'Utente'}: ${turn.content}`)
    .join('\n');

  const ragChunk = retrievedDocs.length
    ? retrievedDocs.map((d, idx) => `Fonte ${idx + 1} - ${d.title}: ${d.content}`).join('\n')
    : 'Nessuna fonte RAG pertinente trovata.';

  const narrativeBlock = config.narrativeDesign?.enabled
    ? `Modalita narrative design attiva.\nObiettivo: ${config.narrativeDesign.objective}\nStile: ${config.narrativeDesign.style}\nAd ogni risposta: mantieni continuita narrativa, proponi una micro-azione o scelta.`
    : 'Modalita narrativa libera, senza schema a obiettivi.';

  return [
    `System: ${config.systemPrompt}`,
    `Personalita: ${config.personality}`,
    `Proattivita: ${config.proactive ? 'alta (fai piccole proposte concrete)' : 'bassa (rispondi solo se richiesto)'}`,
    'Sicurezza: evita contenuti pericolosi, discriminatori, illegali o manipolativi. Dichiara sempre che sei un AI quando serve.',
    narrativeBlock,
    `Conoscenza recuperata (RAG):\n${ragChunk}`,
    historyChunk ? `Storico conversazione:\n${historyChunk}` : 'Storico conversazione: vuoto',
    `Utente: ${message}`,
    'NPC:'
  ].join('\n\n');
}

async function callHuggingFace(config, prompt) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return {
      text: 'Modalita demo attiva: manca HF_TOKEN. Posso comunque rispondere usando la knowledge base locale e guidarti nella scena.'
    };
  }

  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(config.model)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: Number(config.maxNewTokens || 220),
        temperature: Number(config.temperature || 0.6),
        return_full_text: false
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const details = payload?.error || `HTTP ${response.status}`;
    throw new Error(`Hugging Face error: ${details}`);
  }

  if (Array.isArray(payload) && payload[0]?.generated_text) {
    return { text: payload[0].generated_text.trim() };
  }

  if (payload?.generated_text) {
    return { text: String(payload.generated_text).trim() };
  }

  throw new Error('Risposta Hugging Face non riconosciuta');
}

function appendConversationLog(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_PATH, `${line}\n`);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^([.][.][/\\])+/, '');
  const absPath = path.join(PUBLIC_DIR, filePath);

  if (!absPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (isAdminPath(pathname) && !requireBasicAuth(req, res)) return;

    if (req.method === 'GET' && pathname === '/api/config') {
      if (!checkRateLimit(req, res, 'admin', ENV.ADMIN_RATE_LIMIT_PER_MIN)) return;
      return sendJson(res, 200, readJson(CONFIG_PATH, DEFAULT_CONFIG));
    }

    if (req.method === 'GET' && pathname === '/api/public-config') {
      const cfg = readJson(CONFIG_PATH, DEFAULT_CONFIG);
      return sendJson(res, 200, {
        model: cfg.model,
        speakResponses: !!cfg.speakResponses,
        cameraRig: cfg.cameraRig || DEFAULT_CONFIG.cameraRig,
        sceneLighting: cfg.sceneLighting || DEFAULT_CONFIG.sceneLighting,
        aiAct: { transparencyNotice: !!cfg.aiAct?.transparencyNotice }
      });
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
    }

    if (req.method === 'PUT' && pathname === '/api/config') {
      if (!checkRateLimit(req, res, 'admin', ENV.ADMIN_RATE_LIMIT_PER_MIN)) return;
      const body = await parseBody(req);
      const current = readJson(CONFIG_PATH, DEFAULT_CONFIG);
      const merged = {
        ...current,
        ...body,
        narrativeDesign: {
          ...current.narrativeDesign,
          ...(body.narrativeDesign || {})
        },
        aiAct: {
          ...current.aiAct,
          ...(body.aiAct || {})
        }
      };
      writeJson(CONFIG_PATH, merged);
      return sendJson(res, 200, { ok: true, config: merged });
    }

    if (req.method === 'GET' && pathname === '/api/knowledge') {
      if (!checkRateLimit(req, res, 'admin', ENV.ADMIN_RATE_LIMIT_PER_MIN)) return;
      return sendJson(res, 200, readJson(KNOWLEDGE_PATH, DEFAULT_KNOWLEDGE));
    }

    if (req.method === 'PUT' && pathname === '/api/knowledge') {
      if (!checkRateLimit(req, res, 'admin', ENV.ADMIN_RATE_LIMIT_PER_MIN)) return;
      const body = await parseBody(req);
      const docs = Array.isArray(body.documents) ? body.documents : [];
      const cleaned = docs
        .map((d, i) => ({
          id: String(d.id || `doc-${i + 1}`),
          title: String(d.title || `Documento ${i + 1}`),
          content: String(d.content || '').trim()
        }))
        .filter((d) => d.content.length > 0);
      const payload = { documents: cleaned };
      writeJson(KNOWLEDGE_PATH, payload);
      return sendJson(res, 200, { ok: true, knowledge: payload });
    }

    if (req.method === 'GET' && pathname === '/api/compliance') {
      const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
      return sendJson(res, 200, {
        notes: [
          "Trasparenza AI: l'utente viene informato che sta parlando con un agente AI.",
          'Log conversazioni locale opzionale per auditing.',
          'Human oversight: dashboard per modificare prompt, tono e conoscenza.',
          'Safety mode: prompt di sicurezza e filtraggio base output.',
          "Valuta con un legale la classificazione finale AI Act per il tuo caso d'uso."
        ],
        aiAct: config.aiAct
      });
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      if (!checkRateLimit(req, res, 'chat', ENV.CHAT_RATE_LIMIT_PER_MIN)) return;
      const body = await parseBody(req);
      const message = String(body.message || '').trim();
      const history = Array.isArray(body.history) ? body.history : [];
      const channel = String(body.channel || 'chat');

      if (!message) {
        return sendJson(res, 400, { error: 'Messaggio vuoto' });
      }

      const config = readJson(CONFIG_PATH, DEFAULT_CONFIG);
      const knowledge = readJson(KNOWLEDGE_PATH, DEFAULT_KNOWLEDGE);
      const retrieved = retrieveKnowledge(message, knowledge, Number(config.ragTopK || 3));
      const prompt = composePrompt(config, history, message, retrieved);

      let reply = '';
      try {
        const llm = await callHuggingFace(config, prompt);
        reply = llm.text || 'Non ho trovato una risposta utile.';
      } catch (err) {
        reply = `Errore modello: ${err.message}. Verifica HF_TOKEN e model id in dashboard.`;
      }

      if (config.aiAct?.safetyMode) {
        reply = reply.replace(/\b(suicidio|autolesionismo|fabbricare arma)\b/gi, '[contenuto bloccato]');
      }

      if (config.aiAct?.loggingEnabled) {
        appendConversationLog({ channel, message, reply, model: config.model, retrieved: retrieved.map((d) => d.id) });
      }

      return sendJson(res, 200, {
        reply,
        retrieved,
        model: config.model,
        meta: {
          proactive: !!config.proactive,
          narrativeEnabled: !!config.narrativeDesign?.enabled,
          speakResponses: !!config.speakResponses
        }
      });
    }

    if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/'))) {
      return serveStatic(req, res, pathname);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal error' });
  }
});

server.listen(PORT, () => {
  const warnings = [];
  if (!ENV.HF_TOKEN) warnings.push('HF_TOKEN non impostato: chat in modalita demo.');
  if (ENV.NODE_ENV === 'production' && ENV.ADMIN_PASS === 'change-me') {
    warnings.push('ADMIN_PASS e default: imposta una password forte.');
  }
  console.log(`MyConvai server attivo su http://localhost:${PORT}`);
  warnings.forEach((w) => console.warn(`[WARN] ${w}`));
});
