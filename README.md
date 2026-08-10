# RELAY — Intelligent Clinical Handoff Assistant

RELAY is a voice-first clinical handoff prototype designed to make shift-to-shift communication safer, faster, and more consistent.

Instead of requiring a clinician to manually type and review every handoff, RELAY listens to a spoken patient handoff, transcribes it in real time, analyzes the handoff after the speaker pauses, checks unresolved patient memories, and asks for confirmation when an important previously active item is missing.

> **Prototype disclaimer:** RELAY is a hackathon/research prototype built with synthetic/demo patient data. It is not intended for real clinical decision-making or production medical use.

---

## Problem

Clinical handoffs can fail when important information is forgotten, omitted, or assumed to be known by the next person.

A normal handoff may sound complete while still missing an unresolved item from an earlier shift, such as a fall-risk precaution, monitoring requirement, or other active concern.

RELAY is designed around one question:

**What if a handoff assistant could remember what was still unresolved and actively check that it was not forgotten?**

---

## Solution

RELAY combines continuous voice input, automatic handoff analysis, persistent patient memory, and spoken confirmation.

A typical flow is:

1. Enter a patient ID.
2. Start RELAY once.
3. Speak the handoff naturally.
4. RELAY detects the end of speech and analyzes automatically.
5. It checks for unresolved memories associated with that patient.
6. If an unresolved item is missing from the new handoff, RELAY asks whether it is still active.
7. The user can answer verbally with **Yes** or **No**.
8. Active items are carried forward; resolved items are removed from future unresolved-memory checks.
9. RELAY finalizes the handoff and remains ready for the next one.

---

## Key Features

### Hands-free voice workflow
RELAY captures microphone audio continuously after being started and streams audio through a WebSocket transcription pipeline.

The user does not need to press an Analyze button after every sentence.

### Automatic pause detection
The frontend detects a period of silence after speech and automatically starts handoff analysis.

This allows natural speech with short pauses without prematurely ending the handoff.

### Real-time transcription
Interim and finalized transcript text are shown in the interface while the user speaks.

### Patient-specific persistent memory
RELAY stores unresolved patient information in a Qdrant collection and retrieves relevant unresolved memories during later handoffs.

This memory persists across browser refreshes because it is stored outside the frontend session.

### Missing-item detection
When a previous unresolved item is not mentioned in the new handoff, RELAY flags it instead of silently dropping it.

### Voice confirmation
RELAY can ask the user whether a missing unresolved item is still active.

Supported confirmation behavior includes spoken responses such as:

- **Yes / still active** → carry the item forward
- **No / resolved** → mark the item resolved so it is no longer raised in later handoffs

### Spoken RELAY responses
RELAY can play returned audio and can fall back to browser speech synthesis for spoken feedback.

### Continuous handoffs
After a handoff is completed, RELAY can remain listening so another handoff can begin without refreshing the page.

### Basic microphone noise handling
The browser microphone configuration uses echo cancellation, noise suppression, and automatic gain control where supported.

---

## Demo Memory Scenario

A synthetic demo memory can be created for:

```text
Patient ID: 204
Category: fall_risk
Risk level: high
Status: active
Resolved: false
Memory: Fall-risk precaution remains active
```

For the demo, a new handoff can intentionally omit the fall-risk information.

RELAY should then detect that an unresolved item was missing and ask whether the precaution is still active.

If the user answers:

```text
Yes, it is still active.
```

the item remains active.

If the user answers:

```text
No, it is resolved.
```

the item is resolved and should no longer be raised on the next handoff.

---

## Architecture

```text
┌──────────────────────────────┐
│        React / Vite UI       │
│                              │
│  Patient ID                  │
│  Microphone                  │
│  Live transcript             │
│  Handoff analysis            │
└──────────────┬───────────────┘
               │
               │ WebSocket audio
               │ HTTP API
               ▼
┌──────────────────────────────┐
│       Node.js Backend        │
│                              │
│  /ws/transcribe              │
│  /api/handoff/analyze        │
│  /api/handoff/confirm        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│            Qdrant            │
│                              │
│ Patient-specific unresolved  │
│ memory + resolution state    │
└──────────────────────────────┘
```

---

## Core API Flow

### Analyze a handoff

```http
POST /api/handoff/analyze
```

Example request:

```json
{
  "patient_id": "204",
  "transcript": "Patient is stable. Vitals are normal. No fever. Continue routine monitoring."
}
```

The response can include:

```text
patient_id
final_handoff
requires_confirmation
confirmation_text
missing_items
memory_check
audio_url
```

### Confirm a missing memory

```http
POST /api/handoff/confirm
```

Example request:

```json
{
  "patient_id": "204",
  "memory_id": 204001,
  "answer": "no",
  "transcript": "Patient is stable. Vitals are normal. No fever. Continue routine monitoring."
}
```

The confirmation flow updates the state of the selected memory and returns the finalized handoff response.

---

## Tech Stack

### Frontend
- React
- Vite
- JavaScript
- Browser MediaRecorder API
- WebSocket client
- Browser Speech Synthesis fallback

### Backend
- Node.js
- HTTP API
- WebSocket-based transcription route
- Qdrant client

### Memory Layer
- Qdrant

### Version Control / Deployment
- Git
- GitHub
- Hugging Face Spaces *(deployment in progress)*

---

## Project Structure

```text
Relay-Hackathon/
├── client/
│   ├── src/
│   │   └── App.jsx
│   ├── package.json
│   └── ...
│
├── server/
│   ├── .env
│   ├── memoryTest.js
│   ├── package.json
│   └── ...
│
├── .gitignore
└── README.md
```

> `server/.env` is intentionally excluded from Git and must never be committed.

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/takaxo25-cyber/Relay-Hackathon.git
cd Relay-Hackathon
```

### 2. Install frontend dependencies

```bash
cd client
npm install
```

### 3. Install backend dependencies

Open a second terminal:

```bash
cd Relay-Hackathon/server
npm install
```

### 4. Configure environment variables

Create:

```text
server/.env
```

At minimum, configure the Qdrant credentials used by the project:

```env
QDRANT_URL=your_qdrant_url
QDRANT_API_KEY=your_qdrant_api_key
```

Add any additional API credentials required by your local backend configuration.

**Never commit this file to GitHub.**

### 5. Start the backend

From the `server` directory:

```bash
node index.js
```

The frontend currently expects the backend at:

```text
http://localhost:5001
```

and the transcription WebSocket at:

```text
ws://localhost:5001/ws/transcribe
```

### 6. Start the frontend

From the `client` directory:

```bash
npm run dev
```

Open the Vite URL shown in the terminal, typically:

```text
http://localhost:5173
```

---

## Seed the Demo Memory

From the repository root:

```bash
node server/memoryTest.js
```

This creates or updates the demo Qdrant memory used for Patient `204`.

Use this command when you intentionally want to reset the demo memory to its unresolved state.

---

## Suggested Demo Flow

### Normal handoff

Enter a patient ID and say:

```text
Patient is stable. Vitals are normal. No fever. Continue routine monitoring.
```

RELAY waits for the pause, analyzes the handoff, and finalizes it when no unresolved information is missing.

### Memory-aware handoff

First seed Patient `204`:

```bash
node server/memoryTest.js
```

Then give the same handoff while intentionally omitting fall-risk information.

RELAY should detect the unresolved memory and ask whether the fall-risk precaution remains active.

Answer verbally:

```text
Yes, it is still active.
```

or:

```text
No, it is resolved.
```

A later handoff should only raise the memory again if it remains unresolved.

---

## Current Prototype Status

Working prototype functionality includes:

- Continuous microphone capture
- Real-time transcript display
- Automatic analysis after a pause
- Patient-specific memory lookup
- Missing unresolved-memory detection
- Spoken Yes/No confirmation
- Carry-forward of active items
- Resolution of completed items
- Memory persistence across page refreshes
- Finalized handoff output
- Continuous listening for subsequent handoffs

---

## Deployment

The project repository is hosted on GitHub:

**GitHub:** https://github.com/takaxo25-cyber/Relay-Hackathon

A public Hugging Face Space will be added here after deployment:

**Hugging Face:** `Coming soon`

---

## Future Improvements

- Higher-accuracy transcription in noisy environments
- Multiple unresolved-item confirmations in a single handoff
- Authentication and role-based access
- Audit logs and handoff history
- Stronger clinical information extraction
- Production-grade privacy and security controls
- Better accessibility and mobile layouts
- Structured handoff formats such as SBAR
- Hospital information-system integrations

---

## Safety and Privacy

RELAY is currently a prototype.

- Demo with synthetic or non-sensitive patient data only.
- Do not commit secrets or API keys.
- Do not use real protected health information in public deployments.
- Clinical use would require extensive security, privacy, validation, reliability, and regulatory work beyond the scope of this hackathon prototype.

---

## Author

Built for the RELAY hackathon project.

**GitHub:** [takaxo25-cyber](https://github.com/takaxo25-cyber)

---

## License

No license has been added yet.
