const fields = {
  model: document.getElementById("model"),
  temperature: document.getElementById("temperature"),
  maxNewTokens: document.getElementById("maxNewTokens"),
  ragTopK: document.getElementById("ragTopK"),
  systemPrompt: document.getElementById("systemPrompt"),
  personality: document.getElementById("personality"),
  narrativeObjective: document.getElementById("narrativeObjective"),
  narrativeStyle: document.getElementById("narrativeStyle"),
  proactive: document.getElementById("proactive"),
  narrativeEnabled: document.getElementById("narrativeEnabled"),
  speakResponses: document.getElementById("speakResponses"),
  loggingEnabled: document.getElementById("loggingEnabled"),
  safetyMode: document.getElementById("safetyMode"),
  humanOversight: document.getElementById("humanOversight"),
  lookSensitivity: document.getElementById("lookSensitivity"),
  lookSensitivityValue: document.getElementById("lookSensitivityValue"),
  moveSpeed: document.getElementById("moveSpeed"),
  moveSpeedValue: document.getElementById("moveSpeedValue"),
  invertY: document.getElementById("invertY"),
  ambientIntensity: document.getElementById("ambientIntensity"),
  keyIntensity: document.getElementById("keyIntensity"),
  rimIntensity: document.getElementById("rimIntensity"),
  accentIntensity: document.getElementById("accentIntensity"),
  keyColor: document.getElementById("keyColor"),
  rimColor: document.getElementById("rimColor"),
  accentColor: document.getElementById("accentColor"),
  fogNear: document.getElementById("fogNear"),
  fogFar: document.getElementById("fogFar"),
  monolithGlow: document.getElementById("monolithGlow"),
  ragDocs: document.getElementById("ragDocs")
};

const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");

wireDualRange(fields.lookSensitivity, fields.lookSensitivityValue);
wireDualRange(fields.moveSpeed, fields.moveSpeedValue);

await loadAll();
reloadBtn.addEventListener("click", () => loadAll());
saveBtn.addEventListener("click", () => saveAll());

async function loadAll() {
  setStatus("Caricamento...", false);
  try {
    const [cfgRes, kbRes] = await Promise.all([fetch("/api/config"), fetch("/api/knowledge")]);
    const config = await cfgRes.json();
    const knowledge = await kbRes.json();

    fields.model.value = config.model || "";
    fields.temperature.value = String(config.temperature ?? 0.6);
    fields.maxNewTokens.value = String(config.maxNewTokens ?? 220);
    fields.ragTopK.value = String(config.ragTopK ?? 3);
    fields.systemPrompt.value = config.systemPrompt || "";
    fields.personality.value = config.personality || "";
    fields.narrativeObjective.value = config.narrativeDesign?.objective || "";
    fields.narrativeStyle.value = config.narrativeDesign?.style || "";

    fields.proactive.checked = !!config.proactive;
    fields.narrativeEnabled.checked = !!config.narrativeDesign?.enabled;
    fields.speakResponses.checked = !!config.speakResponses;
    fields.loggingEnabled.checked = !!config.aiAct?.loggingEnabled;
    fields.safetyMode.checked = !!config.aiAct?.safetyMode;
    fields.humanOversight.checked = !!config.aiAct?.humanOversight;

    const cam = config.cameraRig || {};
    fields.lookSensitivity.value = String(cam.lookSensitivity ?? 0.0025);
    fields.lookSensitivityValue.value = String(cam.lookSensitivity ?? 0.0025);
    fields.moveSpeed.value = String(cam.moveSpeed ?? 5.2);
    fields.moveSpeedValue.value = String(cam.moveSpeed ?? 5.2);
    fields.invertY.checked = !!cam.invertY;

    const light = config.sceneLighting || {};
    fields.ambientIntensity.value = String(light.ambientIntensity ?? 1);
    fields.keyIntensity.value = String(light.keyIntensity ?? 1.25);
    fields.rimIntensity.value = String(light.rimIntensity ?? 0.9);
    fields.accentIntensity.value = String(light.accentIntensity ?? 0.7);
    fields.keyColor.value = normalizeColor(light.keyColor, "#ffffff");
    fields.rimColor.value = normalizeColor(light.rimColor, "#57b2ff");
    fields.accentColor.value = normalizeColor(light.accentColor, "#ff7a45");
    fields.fogNear.value = String(light.fogNear ?? 10);
    fields.fogFar.value = String(light.fogFar ?? 82);
    fields.monolithGlow.value = String(light.monolithGlow ?? 0.22);

    const docs = Array.isArray(knowledge.documents) ? knowledge.documents : [];
    fields.ragDocs.value = docs.map((d) => `Titolo: ${d.title}\n${d.content}`).join("\n---\n");

    setStatus("Configurazione caricata.", false);
  } catch (err) {
    setStatus(`Errore caricamento: ${err.message}`, true);
  }
}

async function saveAll() {
  setStatus("Salvataggio...", false);
  try {
    const configPayload = {
      model: fields.model.value.trim(),
      temperature: Number(fields.temperature.value || 0.6),
      maxNewTokens: Number(fields.maxNewTokens.value || 220),
      ragTopK: Number(fields.ragTopK.value || 3),
      systemPrompt: fields.systemPrompt.value.trim(),
      personality: fields.personality.value.trim(),
      proactive: fields.proactive.checked,
      speakResponses: fields.speakResponses.checked,
      narrativeDesign: {
        enabled: fields.narrativeEnabled.checked,
        objective: fields.narrativeObjective.value.trim(),
        style: fields.narrativeStyle.value.trim()
      },
      aiAct: {
        loggingEnabled: fields.loggingEnabled.checked,
        safetyMode: fields.safetyMode.checked,
        humanOversight: fields.humanOversight.checked
      },
      cameraRig: {
        lookSensitivity: Number(fields.lookSensitivityValue.value || 0.0025),
        moveSpeed: Number(fields.moveSpeedValue.value || 5.2),
        invertY: fields.invertY.checked
      },
      sceneLighting: {
        ambientIntensity: Number(fields.ambientIntensity.value || 1),
        keyIntensity: Number(fields.keyIntensity.value || 1.25),
        rimIntensity: Number(fields.rimIntensity.value || 0.9),
        accentIntensity: Number(fields.accentIntensity.value || 0.7),
        keyColor: fields.keyColor.value || "#ffffff",
        rimColor: fields.rimColor.value || "#57b2ff",
        accentColor: fields.accentColor.value || "#ff7a45",
        fogNear: Number(fields.fogNear.value || 10),
        fogFar: Number(fields.fogFar.value || 82),
        monolithGlow: Number(fields.monolithGlow.value || 0.22)
      }
    };

    const docs = parseDocuments(fields.ragDocs.value);
    const knowledgePayload = { documents: docs };

    const [cfgRes, kbRes] = await Promise.all([
      fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configPayload)
      }),
      fetch("/api/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(knowledgePayload)
      })
    ]);

    if (!cfgRes.ok || !kbRes.ok) throw new Error("Errore durante il salvataggio");
    setStatus("Salvato con successo. Ricarica la scena 3D per applicare tutte le modifiche.", false);
  } catch (err) {
    setStatus(`Errore salvataggio: ${err.message}`, true);
  }
}

function parseDocuments(text) {
  const chunks = text
    .split("\n---\n")
    .map((c) => c.trim())
    .filter(Boolean);

  return chunks
    .map((chunk, i) => {
      const lines = chunk.split("\n");
      let title = `Documento ${i + 1}`;
      if (lines[0] && lines[0].toLowerCase().startsWith("titolo:")) {
        title = lines.shift().slice(7).trim() || title;
      }
      return {
        id: `doc-${i + 1}`,
        title,
        content: lines.join("\n").trim()
      };
    })
    .filter((d) => d.content.length > 0);
}

function wireDualRange(rangeInput, numberInput) {
  rangeInput.addEventListener("input", () => {
    numberInput.value = rangeInput.value;
  });
  numberInput.addEventListener("input", () => {
    rangeInput.value = numberInput.value;
  });
}

function normalizeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return fallback;
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "#9ceccf";
}
