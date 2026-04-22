# MyConvai (WebXR + Three.js + Hugging Face OSS)

Applicazione WebXR con:
- scena 3D navigabile (desktop, mobile, visore VR)
- NPC robottino
- chat testuale e input vocale
- backend Node.js con modello open-source da Hugging Face
- dashboard per system prompt, personality, proattivita, stile narrativo e RAG

## Avvio rapido

1. Apri terminale in `C:\Users\manue\Desktop\Nuova cartella\MyConvai`
2. (Opzionale) imposta token Hugging Face:
   - PowerShell: `$env:HF_TOKEN=\"hf_xxx\"`
3. (Consigliato) imposta credenziali dashboard:
   - `$env:ADMIN_USER=\"admin\"`
   - `$env:ADMIN_PASS=\"password-forte\"`
3. Avvia:
   - `npm start`
4. Apri:
   - scena: `http://localhost:8787/`
   - dashboard: `http://localhost:8787/dashboard.html`

## Sicurezza base inclusa

- Dashboard protetta via Basic Auth (`ADMIN_USER` + `ADMIN_PASS`)
- Rate limit su `/api/chat` e endpoint admin
- Endpoint pubblico separato `/api/public-config` per il frontend scena

## Deploy

### Render

- Repository pronto con `render.yaml`
- In Render imposta variabili:
  - `HF_TOKEN`
  - `ADMIN_USER`
  - `ADMIN_PASS`

### Railway

- Repository pronto con `railway.json`
- In Railway imposta le stesse variabili ambiente.

## Note WebXR

- In locale puoi testare da desktop.
- Per smartphone/visore sullo stesso Wi-Fi usa l'IP LAN del PC (es. `http://192.168.x.x:8787`).
- Alcuni browser richiedono HTTPS per funzioni XR/voce avanzate.

## Configurazioni AI

La dashboard permette di cambiare:
- model id Hugging Face
- system prompt
- personality
- tono proattivo
- narrative design (objective + style)
- knowledge base RAG (documenti testuali)

## Compliance AI Act (supporto tecnico, non consulenza legale)

Il progetto include:
- trasparenza (avviso AI)
- logging locale opzionale
- human oversight (dashboard)
- safety mode base

Per conformita finale AI Act serve validazione legale/policy sul tuo caso d'uso reale.

## Fonti usate per Narrative Design di Convai

- https://docs.convai.com/api-docs/convai-playground/character-creator-tool/narrative-design
- https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/narrative-design-guide
