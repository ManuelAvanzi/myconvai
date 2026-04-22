const CDN = {
  jsdelivr: "https://cdn.jsdelivr.net/npm/three@0.165.0",
  unpkg: "https://unpkg.com/three@0.165.0"
};

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const voiceBtn = document.getElementById("voiceBtn");
const modelInfo = document.getElementById("modelInfo");
const padEl = document.getElementById("mobilePad");
const resetCameraBtn = document.getElementById("resetCameraBtn");
const fxAmbient = document.getElementById("fxAmbient");
const fxKey = document.getElementById("fxKey");
const fxRim = document.getElementById("fxRim");
const fxFogFar = document.getElementById("fxFogFar");
const fxSky = document.getElementById("fxSky");

const history = [];
let listening = false;
let recognition = null;
let config = null;

const moveState = { forward: false, backward: false, left: false, right: false, sprint: false };
const cameraState = {
  yaw: 0,
  pitch: -0.05,
  moveSpeed: 5.2,
  lookSensitivity: 0.0025,
  invertY: false,
  velocity: { x: 0, z: 0 },
  accel: 28,
  drag: 10,
  sprintMult: 1.75
};

addMessage("npc", "Avvio scena 3D...");
start().catch((err) => {
  addMessage("npc", `Errore avvio frontend: ${err.message}`);
  modelInfo.textContent = "Modello: frontend non inizializzato";
});

async function start() {
  const THREE = await importWithFallback([
    `${CDN.jsdelivr}/build/three.module.js`,
    `${CDN.unpkg}/build/three.module.js?module`
  ]);

  let VRButton = null;
  let XRControllerModelFactory = null;
  let GLTFLoader = null;
  try {
    const [vrMod, xrMod] = await Promise.all([
      importWithFallback([
        `${CDN.jsdelivr}/examples/jsm/webxr/VRButton.js`,
        `${CDN.unpkg}/examples/jsm/webxr/VRButton.js?module`
      ]),
      importWithFallback([
        `${CDN.jsdelivr}/examples/jsm/webxr/XRControllerModelFactory.js`,
        `${CDN.unpkg}/examples/jsm/webxr/XRControllerModelFactory.js?module`
      ])
    ]);
    VRButton = vrMod.VRButton;
    XRControllerModelFactory = xrMod.XRControllerModelFactory;
  } catch {
    addMessage("npc", "Modulo VR opzionale non disponibile in questo browser/rete.");
  }

  try {
    const gltfMod = await importWithFallback([
      `${CDN.jsdelivr}/examples/jsm/loaders/GLTFLoader.js`,
      `${CDN.unpkg}/examples/jsm/loaders/GLTFLoader.js?module`
    ]);
    GLTFLoader = gltfMod.GLTFLoader;
  } catch {
    addMessage("npc", "GLTFLoader non disponibile: uso solo geometrie procedurali.");
  }

  const canvas = document.getElementById("scene");
  const clock = new THREE.Clock();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x081428);
  scene.fog = new THREE.Fog(0x081428, 10, 82);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 220);
  resetCameraPose(THREE, camera);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  if (VRButton) document.body.appendChild(VRButton.createButton(renderer));

  const environment = buildEnvironment(THREE, scene);
  const lights = setupLights(THREE, scene);
  loadMainGlbModel(THREE, scene, GLTFLoader);
  const npc = createRobot(THREE);
  npc.position.set(-2.8, 0, 2.5);
  scene.add(npc);

  setupChat();
  setupMobilePad();
  setupMouseLook(canvas);
  setupXRControllerVoice(scene, renderer, XRControllerModelFactory);
  setupMoveKeys();

  resetCameraBtn?.addEventListener("click", () => {
    resetCameraPose(THREE, camera);
    addMessage("npc", "Camera resettata.");
  });

  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    updateMovement(THREE, camera, dt);
    animateRobot(clock.elapsedTime, npc);
    animateLights(clock.elapsedTime, lights, environment);
    renderer.render(scene, camera);
  });

  addMessage("npc", "Scena pronta. Clicca sulla scena per attivare look fluido, WASD per muoverti.");

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  loadConfig()
    .then(() => {
      applySceneConfig(THREE, scene, lights, environment);
      applyCameraConfig();
      setupSceneFxControls(THREE, scene, lights);
    })
    .catch(() => {
      applySceneConfig(THREE, scene, lights, environment);
      applyCameraConfig();
      setupSceneFxControls(THREE, scene, lights);
      addMessage("npc", "Config non raggiungibile: uso preset visuale locale.");
    });

  function applyCameraConfig() {
    const cfg = config?.cameraRig || {};
    cameraState.lookSensitivity = clamp(Number(cfg.lookSensitivity ?? 0.0025), 0.001, 0.01);
    cameraState.moveSpeed = clamp(Number(cfg.moveSpeed ?? 5.2), 2, 16);
    cameraState.invertY = !!cfg.invertY;
  }
}

async function importWithFallback(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await promiseTimeout(import(url), 7000, `Timeout import: ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Import fallito");
}

function setupLights(THREE, scene) {
  const hemi = new THREE.HemisphereLight(0xbddfff, 0x1a1d24, 1.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(9, 15, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  scene.add(key);

  const rim = new THREE.PointLight(0x57b2ff, 0.9, 52);
  rim.position.set(-12, 8, -10);
  scene.add(rim);

  const accent = new THREE.PointLight(0xff7a45, 0.7, 24);
  accent.position.set(0, 4.5, 4.5);
  scene.add(accent);

  const moon = new THREE.SpotLight(0x9ed2ff, 0.6, 90, 0.48, 0.5, 1.1);
  moon.position.set(-18, 22, 14);
  moon.target.position.set(0, 0, 0);
  scene.add(moon);
  scene.add(moon.target);

  return { hemi, key, rim, accent, moon };
}

function buildEnvironment(THREE, scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x1f262e, roughness: 0.94, metalness: 0.08 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(100, 100, 0x4fa6ff, 0x2a3e58);
  grid.position.y = 0.02;
  scene.add(grid);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 10.5, 0.65, 56),
    new THREE.MeshStandardMaterial({ color: 0x111a25, roughness: 0.72, metalness: 0.35 })
  );
  platform.position.y = 0.33;
  platform.receiveShadow = true;
  platform.castShadow = true;
  scene.add(platform);

  const monolith = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 9, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.2, metalness: 0.4 })
  );
  monolith.position.set(0, 4.5, 0);
  monolith.castShadow = true;
  monolith.receiveShadow = true;
  scene.add(monolith);

  const monolithBase = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.85, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.55, metalness: 0.45 })
  );
  monolithBase.position.set(0, 0.42, 0);
  monolithBase.castShadow = true;
  monolithBase.receiveShadow = true;
  scene.add(monolithBase);

  const monolithGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 9.8),
    new THREE.MeshBasicMaterial({ color: 0x1a2e3f, transparent: true, opacity: 0.22 })
  );
  monolithGlow.position.set(0, 4.5, -0.3);
  scene.add(monolithGlow);

  const ringGroup = new THREE.Group();
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const h = 3.5 + Math.sin(i * 0.9);
    const col = new THREE.Color().setHSL(0.52 + (i % 3) * 0.08, 0.72, 0.56);
    const pylon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.32, h, 10),
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: col.clone().multiplyScalar(0.2),
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.52
      })
    );
    pylon.position.set(Math.cos(a) * 12, h / 2, Math.sin(a) * 12);
    pylon.castShadow = true;
    pylon.receiveShadow = true;
    ringGroup.add(pylon);
  }
  scene.add(ringGroup);

  const archGroup = new THREE.Group();
  for (let i = 0; i < 6; i += 1) {
    const c = new THREE.Color().setHSL(0.56 + i * 0.04, 0.75, 0.62);
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(16 + i * 2.8, 0.08 + i * 0.04, 14, 140),
      new THREE.MeshStandardMaterial({
        color: c,
        emissive: c.clone().multiplyScalar(0.2),
        emissiveIntensity: 0.44 - i * 0.045,
        roughness: 0.35,
        metalness: 0.5
      })
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 1.9 + i * 1.1;
    archGroup.add(torus);
  }
  scene.add(archGroup);

  const palette = [0xff6a3d, 0x47d1ff, 0x70e07a, 0xf7ce68, 0xda7cff, 0xffffff];
  for (let i = 0; i < 52; i += 1) {
    const h = 0.8 + Math.random() * 7.2;
    const w = 0.8 + Math.random() * 3.2;
    const d = 0.8 + Math.random() * 3.2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.45 + Math.random() * 0.35,
        metalness: 0.2 + Math.random() * 0.25
      })
    );
    const angle = (i / 52) * Math.PI * 2;
    const radius = 13 + Math.random() * 32;
    m.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius);
    m.rotation.y = Math.random() * Math.PI;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  const particleCount = 500;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const r = 24 + Math.random() * 55;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = 6 + Math.random() * 28;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xcde6ff, size: 0.12, transparent: true, opacity: 0.68 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  return { monolithGlow, ringGroup, archGroup, stars };
}

function applySceneConfig(THREE, scene, lights, env) {
  const defaults = {
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
  };
  const s = { ...defaults, ...(config?.sceneLighting || {}) };

  lights.hemi.intensity = clamp(Number(s.ambientIntensity), 0, 4);
  lights.key.intensity = clamp(Number(s.keyIntensity), 0, 4);
  lights.rim.intensity = clamp(Number(s.rimIntensity), 0, 4);
  lights.accent.intensity = clamp(Number(s.accentIntensity), 0, 4);
  lights.moon.intensity = clamp(Number(s.keyIntensity) * 0.45, 0, 2);

  lights.key.color = new THREE.Color(validHex(s.keyColor, defaults.keyColor));
  lights.rim.color = new THREE.Color(validHex(s.rimColor, defaults.rimColor));
  lights.accent.color = new THREE.Color(validHex(s.accentColor, defaults.accentColor));

  const near = clamp(Number(s.fogNear), 1, 160);
  const far = clamp(Number(s.fogFar), near + 5, 250);
  scene.fog = new THREE.Fog(0x081428, near, far);
  env.monolithGlow.material.opacity = clamp(Number(s.monolithGlow), 0, 1);
}

function createRobot(THREE) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.65, 4, 9),
    new THREE.MeshStandardMaterial({ color: 0x59b3ff, metalness: 0.28, roughness: 0.4 })
  );
  body.position.y = 1.1;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xd7ecff, metalness: 0.06, roughness: 0.25 })
  );
  head.position.y = 1.88;
  head.castShadow = true;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x4bd1a0, emissive: 0x1f8f6d, emissiveIntensity: 0.8 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), eyeMat);
  eyeL.position.set(-0.085, 1.9, 0.24);
  group.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.085;
  group.add(eyeR);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.025, 16, 52),
    new THREE.MeshStandardMaterial({ color: 0x57b2ff, emissive: 0x123654, emissiveIntensity: 0.65 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.05;
  group.add(ring);

  group.userData = { head, ring };
  return group;
}

function animateRobot(t, npc) {
  npc.position.y = 0.12 + 0.06 * Math.sin(t * 1.8);
  npc.userData.head.rotation.y = 0.25 * Math.sin(t * 0.8);
  npc.userData.ring.rotation.z += 0.01;
}

function animateLights(t, lights, env) {
  lights.rim.position.x = -12 + Math.sin(t * 0.45) * 7.5;
  lights.rim.position.z = -10 + Math.cos(t * 0.43) * 7.5;
  lights.accent.position.x = Math.cos(t * 0.9) * 5.4;
  lights.accent.position.z = Math.sin(t * 0.9) * 5.4;
  if (env.ringGroup) env.ringGroup.rotation.y += 0.0018;
  if (env.archGroup) env.archGroup.rotation.y -= 0.0009;
  if (env.stars) env.stars.rotation.y += 0.00035;
}

async function loadMainGlbModel(THREE, scene, GLTFLoader) {
  if (!GLTFLoader) return;
  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load("/sky_gallery_series_01.glb", resolve, undefined, reject);
    });
    const model = gltf.scene || gltf.scenes?.[0];
    if (!model) throw new Error("Modello GLB vuoto");

    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material.needsUpdate = true;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 18 / maxDim;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.position.y += 0.02;
    scene.add(model);
    addMessage("npc", "Caricato modello 3D: sky_gallery_series_01.glb");
  } catch (err) {
    addMessage("npc", `Errore caricamento GLB: ${err.message}`);
  }
}

function setupSceneFxControls(THREE, scene, lights) {
  const safe = (el, fallback) => (el ? Number(el.value) : fallback);

  const apply = () => {
    lights.hemi.intensity = clamp(safe(fxAmbient, lights.hemi.intensity), 0, 4);
    lights.key.intensity = clamp(safe(fxKey, lights.key.intensity), 0, 4);
    lights.rim.intensity = clamp(safe(fxRim, lights.rim.intensity), 0, 4);
    const far = clamp(safe(fxFogFar, scene.fog?.far || 82), 20, 240);
    const near = Math.min((scene.fog?.near || 10), far - 5);
    scene.fog = new THREE.Fog(scene.background.getHex(), near, far);
    if (fxSky?.value && /^#[0-9a-fA-F]{6}$/.test(fxSky.value)) {
      const c = new THREE.Color(fxSky.value);
      scene.background = c;
      scene.fog = new THREE.Fog(c, near, far);
    }
  };

  if (fxAmbient) fxAmbient.value = String(lights.hemi.intensity);
  if (fxKey) fxKey.value = String(lights.key.intensity);
  if (fxRim) fxRim.value = String(lights.rim.intensity);
  if (fxFogFar) fxFogFar.value = String(scene.fog?.far || 82);
  if (fxSky) fxSky.value = "#081428";

  [fxAmbient, fxKey, fxRim, fxFogFar, fxSky].forEach((el) => {
    if (el) el.addEventListener("input", apply);
  });
  apply();
}

function setupChat() {
  sendBtn.addEventListener("click", () => sendMessage());
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
  voiceBtn.addEventListener("click", () => toggleVoiceInput());
}

async function sendMessage(prefill = "") {
  const message = (prefill || inputEl.value).trim();
  if (!message) return;
  inputEl.value = "";
  addMessage("user", message);

  let reply = "";
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, channel: listening ? "voice" : "chat", history })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    reply = payload.reply || "Nessuna risposta disponibile.";
  } catch (err) {
    reply = `Backend non raggiungibile (${err.message}). Riavvia con: npm start`;
  }

  history.push({ role: "user", content: message });
  history.push({ role: "assistant", content: reply });
  if (history.length > 18) history.splice(0, history.length - 18);
  addMessage("npc", reply);

  if (config?.speakResponses && "speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "it-IT";
    utterance.rate = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function initSpeechRecognition() {
  const API = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!API) return null;
  const rec = new API();
  rec.lang = "it-IT";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onstart = () => {
    listening = true;
    voiceBtn.textContent = "Stop";
  };
  rec.onend = () => {
    listening = false;
    voiceBtn.textContent = "Voce";
  };
  rec.onresult = (event) => {
    sendMessage(event.results[0][0].transcript);
  };
  rec.onerror = (event) => addMessage("npc", `Voce non disponibile: ${event.error}`);
  return rec;
}

function toggleVoiceInput() {
  if (!recognition) recognition = initSpeechRecognition();
  if (!recognition) {
    addMessage("npc", "SpeechRecognition non supportata su questo browser/dispositivo.");
    return;
  }
  if (listening) recognition.stop();
  else recognition.start();
}

function setupMobilePad() {
  const map = { forward: "forward", backward: "backward", left: "left", right: "right" };
  for (const btn of padEl.querySelectorAll(".padBtn")) {
    const key = map[btn.dataset.move];
    if (!key) continue;
    const start = (e) => {
      e.preventDefault();
      moveState[key] = true;
    };
    const stop = (e) => {
      e.preventDefault();
      moveState[key] = false;
    };
    btn.addEventListener("touchstart", start, { passive: false });
    btn.addEventListener("touchend", stop, { passive: false });
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", stop);
    btn.addEventListener("mouseleave", stop);
  }
}

function setupMoveKeys() {
  window.addEventListener("keydown", (e) => setMoveKey(e.code, true));
  window.addEventListener("keyup", (e) => setMoveKey(e.code, false));
}

function setMoveKey(code, active) {
  if (code === "KeyW" || code === "ArrowUp") moveState.forward = active;
  if (code === "KeyS" || code === "ArrowDown") moveState.backward = active;
  if (code === "KeyA" || code === "ArrowLeft") moveState.left = active;
  if (code === "KeyD" || code === "ArrowRight") moveState.right = active;
  if (code === "ShiftLeft" || code === "ShiftRight") moveState.sprint = active;
}

function setupMouseLook(canvas) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock();
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });

  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
      updateLook(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    updateLook(dx, dy);
  });

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    dragging = true;
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  });
  canvas.addEventListener("touchend", () => {
    dragging = false;
  });
  canvas.addEventListener("touchmove", (e) => {
    if (!dragging || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    updateLook(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
  });
}

function updateLook(dx, dy) {
  cameraState.yaw -= dx * cameraState.lookSensitivity;
  const sign = cameraState.invertY ? -1 : 1;
  cameraState.pitch -= dy * cameraState.lookSensitivity * sign;
  cameraState.pitch = clamp(cameraState.pitch, -1.4, 1.4);
}

function updateMovement(THREE, camera, dt) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.000001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const desired = new THREE.Vector3();

  if (moveState.forward) desired.add(forward);
  if (moveState.backward) desired.sub(forward);
  if (moveState.left) desired.sub(right);
  if (moveState.right) desired.add(right);
  if (desired.lengthSq() > 0.0001) desired.normalize();

  const speed = cameraState.moveSpeed * (moveState.sprint ? cameraState.sprintMult : 1);
  const desiredVx = desired.x * speed;
  const desiredVz = desired.z * speed;

  cameraState.velocity.x += (desiredVx - cameraState.velocity.x) * cameraState.accel * dt;
  cameraState.velocity.z += (desiredVz - cameraState.velocity.z) * cameraState.accel * dt;

  if (desired.lengthSq() < 0.0001) {
    const drag = Math.exp(-cameraState.drag * dt);
    cameraState.velocity.x *= drag;
    cameraState.velocity.z *= drag;
  }

  camera.position.x += cameraState.velocity.x * dt;
  camera.position.z += cameraState.velocity.z * dt;
  camera.position.x = clamp(camera.position.x, -78, 78);
  camera.position.z = clamp(camera.position.z, -78, 78);
  camera.position.y = 1.8;
  applyCameraRotation(THREE, camera);
}

function applyCameraRotation(THREE, camera) {
  const euler = new THREE.Euler(cameraState.pitch, cameraState.yaw, 0, "YXZ");
  camera.quaternion.setFromEuler(euler);
}

function resetCameraPose(THREE, camera) {
  camera.position.set(0, 1.8, 13.5);
  cameraState.yaw = 0;
  cameraState.pitch = -0.05;
  cameraState.velocity.x = 0;
  cameraState.velocity.z = 0;
  applyCameraRotation(THREE, camera);
}

function setupXRControllerVoice(scene, renderer, XRControllerModelFactory) {
  try {
    const controller = renderer.xr.getController(0);
    controller.addEventListener("selectstart", () => {
      if (!listening) toggleVoiceInput();
    });
    scene.add(controller);

    if (XRControllerModelFactory) {
      const controllerGrip = renderer.xr.getControllerGrip(0);
      const factory = new XRControllerModelFactory();
      controllerGrip.add(factory.createControllerModel(controllerGrip));
      scene.add(controllerGrip);
    }
  } catch {
    addMessage("npc", "Controller VR non disponibile.");
  }
}

async function loadConfig() {
  try {
    const [cfgRes, compRes] = await Promise.all([
      fetchWithTimeout("/api/public-config", 5000),
      fetchWithTimeout("/api/compliance", 5000)
    ]);
    if (!cfgRes.ok) throw new Error(`config ${cfgRes.status}`);
    if (!compRes.ok) throw new Error(`compliance ${compRes.status}`);

    config = await cfgRes.json();
    const compliance = await compRes.json();
    modelInfo.textContent = `Modello: ${config.model || "non impostato"}`;

    if (config.aiAct?.transparencyNotice) {
      addMessage("npc", "Trasparenza: sono un agente AI open-source orchestrato via Hugging Face.");
    }
    if (Array.isArray(compliance.notes) && compliance.notes[0]) addMessage("npc", compliance.notes[0]);
  } catch (err) {
    modelInfo.textContent = "Modello: API non raggiungibile";
    addMessage("npc", `Config non caricata (${err.message}).`);
  }
}

function promiseTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message || "Timeout")), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validHex(value, fallback) {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return fallback;
}
