const DEFAULT_CONFIG = {
  model: "Qwen/Qwen2.5-7B-Instruct",
  systemPrompt: "Sei NEO, un robottino guida in una scena 3D. Rispondi in italiano in modo chiaro, utile e sicuro.",
  personality: "Calmo, collaborativo, curioso, concreto.",
  proactive: true,
  narrativeDesign: {
    enabled: true,
    objective: "Guidare l'utente in una mini-esplorazione e far avanzare la conversazione con micro-obiettivi.",
    style: "Narrativa interattiva a step (obiettivo corrente, breve proposta, attesa input)."
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
    keyColor: "#ffffff",
    rimColor: "#57b2ff",
    accentColor: "#ff7a45",
    fogNear: 10,
    fogFar: 82,
    monolithGlow: 0.22
  },
  aiAct: {
    transparencyNotice: true,
    loggingEnabled: true,
    humanOversight: true,
    safetyMode: true,
    riskTier: "limited"
  }
};

const DEFAULT_KNOWLEDGE = {
  documents: [
    {
      id: "intro-1",
      title: "Benvenuto",
      content: "Questo progetto mostra un NPC robottino in Three.js/WebXR. L'utente puo parlare via voce in visore o via chat su desktop e smartphone."
    },
    {
      id: "intro-2",
      title: "Narrative Design",
      content: "Lo stile narrative design combina obiettivi conversazionali, decisioni e trigger invece di un dialog tree rigido."
    }
  ]
};

const ADMIN_PATHS = new Set(["/dashboard.html", "/dashboard.js", "/api/config", "/api/knowledge"]);
const rateState = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (isAdminPath(pathname) && !requireBasicAuth(request, env)) {
      return unauthorized();
    }

    if (pathname === "/healthz") {
      return json(200, { ok: true, ts: new Date().toISOString() });
    }

    if (pathname === "/api/config" && request.method === "GET") {
      if (!checkRateLimit(request, env, "admin", numberEnv(env.ADMIN_RATE_LIMIT_PER_MIN, 120))) {
        return json(429, { error: "Rate limit exceeded. Riprova tra poco." });
      }
      return json(200, await readConfig(env));
    }

    if (pathname === "/api/public-config" && request.method === "GET") {
      const cfg = await readConfig(env);
      return json(200, {
        model: cfg.model,
        speakResponses: !!cfg.speakResponses,
        cameraRig: cfg.cameraRig || DEFAULT_CONFIG.cameraRig,
        sceneLighting: cfg.sceneLighting || DEFAULT_CONFIG.sceneLighting,
        aiAct: { transparencyNotice: !!cfg.aiAct?.transparencyNotice }
      });
    }

    if (pathname === "/api/config" && request.method === "PUT") {
      if (!checkRateLimit(request, env, "admin", numberEnv(env.ADMIN_RATE_LIMIT_PER_MIN, 120))) {
        return json(429, { error: "Rate limit exceeded. Riprova tra poco." });
      }
      const body = await request.json().catch(() => ({}));
      const current = await readConfig(env);
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
      await putJson(env, "config_json", merged);
      return json(200, { ok: true, config: merged });
    }

    if (pathname === "/api/knowledge" && request.method === "GET") {
      if (!checkRateLimit(request, env, "admin", numberEnv(env.ADMIN_RATE_LIMIT_PER_MIN, 120))) {
        return json(429, { error: "Rate limit exceeded. Riprova tra poco." });
      }
      return json(200, await readKnowledge(env));
    }

    if (pathname === "/api/knowledge" && request.method === "PUT") {
      if (!checkRateLimit(request, env, "admin", numberEnv(env.ADMIN_RATE_LIMIT_PER_MIN, 120))) {
        return json(429, { error: "Rate limit exceeded. Riprova tra poco." });
      }
      const body = await request.json().catch(() => ({}));
      const docs = Array.isArray(body.documents) ? body.documents : [];
      const cleaned = docs
        .map((d, i) => ({
          id: String(d.id || `doc-${i + 1}`),
          title: String(d.title || `Documento ${i + 1}`),
          content: String(d.content || "").trim()
        }))
        .filter((d) => d.content.length > 0);
      const payload = { documents: cleaned };
      await putJson(env, "knowledge_json", payload);
      return json(200, { ok: true, knowledge: payload });
    }

    if (pathname === "/api/compliance" && request.method === "GET") {
      const cfg = await readConfig(env);
      return json(200, {
        notes: [
          "Trasparenza AI: l'utente viene informato che sta parlando con un agente AI.",
          "Log conversazioni opzionale per auditing.",
          "Human oversight: dashboard per modificare prompt, tono e conoscenza.",
          "Safety mode: prompt di sicurezza e filtraggio base output.",
          "Valuta con un legale la classificazione finale AI Act per il tuo caso d'uso."
        ],
        aiAct: cfg.aiAct
      });
    }

    if (pathname === "/api/chat" && request.method === "POST") {
      if (!checkRateLimit(request, env, "chat", numberEnv(env.CHAT_RATE_LIMIT_PER_MIN, 30))) {
        return json(429, { error: "Rate limit exceeded. Riprova tra poco." });
      }
      const body = await request.json().catch(() => ({}));
      const message = String(body.message || "").trim();
      const history = Array.isArray(body.history) ? body.history : [];
      const channel = String(body.channel || "chat");
      if (!message) return json(400, { error: "Messaggio vuoto" });

      const cfg = await readConfig(env);
      const kb = await readKnowledge(env);
      const retrieved = retrieveKnowledge(message, kb, Number(cfg.ragTopK || 3));
      const prompt = composePrompt(cfg, history, message, retrieved);

      let reply = "";
      try {
        const llm = await callHuggingFace(env, cfg, prompt);
        reply = llm.text || "Non ho trovato una risposta utile.";
      } catch (err) {
        reply = `Errore modello: ${err.message}. Verifica HF_TOKEN e model id in dashboard.`;
      }

      if (cfg.aiAct?.safetyMode) {
        reply = reply.replace(/\b(suicidio|autolesionismo|fabbricare arma)\b/gi, "[contenuto bloccato]");
      }

      if (cfg.aiAct?.loggingEnabled && env.MYCONVAI_STORE) {
        const log = {
          ts: new Date().toISOString(),
          channel,
          message,
          reply,
          model: cfg.model,
          retrieved: retrieved.map((d) => d.id)
        };
        await env.MYCONVAI_STORE.put(`log:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(log));
      }

      return json(200, {
        reply,
        retrieved,
        model: cfg.model,
        meta: {
          proactive: !!cfg.proactive,
          narrativeEnabled: !!cfg.narrativeDesign?.enabled,
          speakResponses: !!cfg.speakResponses
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};

function isAdminPath(pathname) {
  return ADMIN_PATHS.has(pathname);
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="MyConvai Dashboard"'
    }
  });
}

function requireBasicAuth(request, env) {
  const adminUser = env.ADMIN_USER || "admin";
  const adminPass = env.ADMIN_PASS || "change-me";
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const idx = decoded.indexOf(":");
    if (idx === -1) return false;
    const username = decoded.slice(0, idx);
    const password = decoded.slice(idx + 1);
    return username === adminUser && password === adminPass;
  } catch {
    return false;
  }
}

function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

function checkRateLimit(request, env, scope, maxPerMinute) {
  const now = Date.now();
  const key = `${scope}:${clientIp(request)}`;
  const bucket = rateState.get(key) || [];
  const recent = bucket.filter((ts) => now - ts < 60_000);
  if (recent.length >= maxPerMinute) return false;
  recent.push(now);
  rateState.set(key, recent);
  return true;
}

async function readConfig(env) {
  const stored = await readJson(env, "config_json");
  if (!stored) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    narrativeDesign: { ...DEFAULT_CONFIG.narrativeDesign, ...(stored.narrativeDesign || {}) },
    aiAct: { ...DEFAULT_CONFIG.aiAct, ...(stored.aiAct || {}) }
  };
}

async function readKnowledge(env) {
  const stored = await readJson(env, "knowledge_json");
  return stored || DEFAULT_KNOWLEDGE;
}

async function readJson(env, key) {
  if (!env.MYCONVAI_STORE) return null;
  const raw = await env.MYCONVAI_STORE.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putJson(env, key, value) {
  if (!env.MYCONVAI_STORE) return;
  await env.MYCONVAI_STORE.put(key, JSON.stringify(value));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 2);
}

function scoreByOverlap(queryTokens, docText) {
  const docTokens = new Set(tokenize(docText));
  let score = 0;
  for (const token of queryTokens) if (docTokens.has(token)) score += 1;
  return score;
}

function retrieveKnowledge(message, knowledge, topK) {
  const queryTokens = tokenize(message);
  const docs = Array.isArray(knowledge.documents) ? knowledge.documents : [];
  return docs
    .map((doc) => ({ doc, score: scoreByOverlap(queryTokens, `${doc.title || ""} ${doc.content || ""}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.doc);
}

function composePrompt(config, history, message, retrievedDocs) {
  const historyChunk = (history || [])
    .slice(-8)
    .map((turn) => `${turn.role === "assistant" ? "NPC" : "Utente"}: ${turn.content}`)
    .join("\n");

  const ragChunk = retrievedDocs.length
    ? retrievedDocs.map((d, idx) => `Fonte ${idx + 1} - ${d.title}: ${d.content}`).join("\n")
    : "Nessuna fonte RAG pertinente trovata.";

  const narrativeBlock = config.narrativeDesign?.enabled
    ? `Modalita narrative design attiva.\nObiettivo: ${config.narrativeDesign.objective}\nStile: ${config.narrativeDesign.style}\nAd ogni risposta: mantieni continuita narrativa, proponi una micro-azione o scelta.`
    : "Modalita narrativa libera, senza schema a obiettivi.";

  return [
    `System: ${config.systemPrompt}`,
    `Personalita: ${config.personality}`,
    `Proattivita: ${config.proactive ? "alta (fai piccole proposte concrete)" : "bassa (rispondi solo se richiesto)"}`,
    "Sicurezza: evita contenuti pericolosi, discriminatori, illegali o manipolativi. Dichiara sempre che sei un AI quando serve.",
    narrativeBlock,
    `Conoscenza recuperata (RAG):\n${ragChunk}`,
    historyChunk ? `Storico conversazione:\n${historyChunk}` : "Storico conversazione: vuoto",
    `Utente: ${message}`,
    "NPC:"
  ].join("\n\n");
}

async function callHuggingFace(env, config, prompt) {
  const token = env.HF_TOKEN || "";
  if (!token) {
    return {
      text: "Modalita demo attiva: manca HF_TOKEN. Posso comunque rispondere usando la knowledge base locale e guidarti nella scena."
    };
  }

  const response = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(config.model)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
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
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  if (Array.isArray(payload) && payload[0]?.generated_text) {
    return { text: String(payload[0].generated_text).trim() };
  }
  if (payload?.generated_text) {
    return { text: String(payload.generated_text).trim() };
  }
  throw new Error("Risposta Hugging Face non riconosciuta");
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
