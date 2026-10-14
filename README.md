# RepliQ

RepliQ is an AI-powered WhatsApp assistant for small businesses. It receives customer messages through the **WhatsApp Cloud API**, generates a reply with **Claude**, and sends it back automatically. There is no framework: the backend is a small set of serverless functions deployed on **Vercel**.

Live site: https://repli-q-three.vercel.app

> **Status:** early prototype / test webhook. See [Known limitations](#known-limitations) and [Roadmap](#roadmap).

---

## How it works

```
Customer (WhatsApp)
        │
        ▼
Meta WhatsApp Cloud API
        │  POST /api/webhook
        ▼
api/webhook.js ──► lib/ai.js ──► Claude (Anthropic API)
        │                              │
        ◄──────── generated reply ◄────┘
        │
        ▼
WhatsApp Cloud API ──► Customer
```

1. A customer sends a WhatsApp message to the business number.
2. Meta calls `POST /api/webhook` with the message payload.
3. The function asks Claude for a reply (the business context lives in `lib/ai.js`).
4. The reply is sent back through the WhatsApp Cloud API.

Meta also calls `GET /api/webhook` once, to verify the webhook using your `VERIFY_TOKEN`.

---

## Project structure

```
RepliQ/
├── api/              # Serverless functions (Vercel). Includes the WhatsApp webhook endpoint.
├── lib/              # Shared logic, including the Claude call (ai.js) and its system prompt.
├── index.html        # Landing page
├── formulaire.html   # Sign-up / contact form page
├── styles.css        # Shared styles for the HTML pages
├── package.json      # Dependencies and scripts
├── .gitignore
└── README.md
```

---

## Getting the code

```bash
# 1. Fork the repo on GitHub (top right), then clone your fork
git clone https://github.com/<your-username>/RepliQ.git
cd RepliQ

# 2. Add the original repo as "upstream" so you can stay in sync
git remote add upstream https://github.com/Hamza92Ra/RepliQ.git

# 3. Install dependencies
npm install
```

If you've been given direct write access, you can clone the main repo instead:

```bash
git clone https://github.com/Hamza92Ra/RepliQ.git
```

---

## Prerequisites

- **Node.js** 18 or newer
- **npm**
- **Vercel CLI**: `npm install -g vercel`
- A **Meta developer account** with a WhatsApp Business app (the free test number is enough)
- An **Anthropic API key** from https://console.anthropic.com

---

## Environment variables

Create a `.env` file in the project root for local development. It is git-ignored, so never commit it.

```env
WHATSAPP_TOKEN=your_meta_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
VERIFY_TOKEN=any_string_you_choose
ANTHROPIC_API_KEY=your_anthropic_api_key
```

| Variable | Where to find it |
| --- | --- |
| `WHATSAPP_TOKEN` | Meta App Dashboard → WhatsApp → API Setup (the temporary token lasts about 24h) |
| `WHATSAPP_PHONE_NUMBER_ID` | Same page, labeled "Phone number ID" |
| `VERIFY_TOKEN` | Any string you make up, e.g. `repliq-test-2026`. It must match what you enter in Meta |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

For deployed environments, add the same four variables in **Vercel → Project → Settings → Environment Variables**, then redeploy.

---

## Running locally

```bash
vercel dev
```

This serves the static pages and the `/api` functions at `http://localhost:3000`.

Meta can only reach a public HTTPS URL, so to test the webhook locally you need a tunnel (for example [ngrok](https://ngrok.com) or `cloudflared`):

```bash
ngrok http 3000
```

Use the generated `https://…/api/webhook` URL as the callback URL in Meta (see below).

---

## Deploying to Vercel

```bash
vercel          # preview deployment
vercel --prod   # production deployment
```

Your webhook URL will look like:

```
https://<your-project>.vercel.app/api/webhook
```

---

## Connecting WhatsApp (Meta)

In the Meta App Dashboard → **WhatsApp → Configuration**:

1. Click **Edit** next to *Webhook*.
2. **Callback URL**: your `/api/webhook` URL.
3. **Verify token**: the exact value of `VERIFY_TOKEN`.
4. Click **Verify and save**. Meta sends a `GET` request, and a correct response shows a success message.
5. Under **Webhook fields**, subscribe to `messages`.

### Testing

From a WhatsApp number you added as a test recipient in the Meta dashboard, send a message to the test number. You should get a Claude-generated reply within a couple of seconds.

If nothing comes back, check **Vercel → your project → Logs** for `console.log` / `console.error` output.

---

## Contributing

Contributions are welcome. A typical workflow:

```bash
# Sync with upstream
git checkout main
git pull upstream main

# Create a branch
git checkout -b feature/short-description

# ...make your changes, then commit
git add .
git commit -m "Add short description of the change"

# Push and open a Pull Request
git push origin feature/short-description
```

Then open a Pull Request against `main` on GitHub.

**Guidelines**

- Keep PRs small and focused on one change.
- Describe what changed and how you tested it in the PR description.
- Never commit secrets (tokens, API keys, `.env` files).
- Keep the project dependency-light. Avoid adding a framework unless it's discussed first.
- For larger changes, open an Issue first so we can agree on the approach.

---

## Known limitations

This is a testing setup, not production-ready:

- **No conversation memory.** Each message is answered independently.
- **One hardcoded business.** The system prompt in `lib/ai.js` describes a single fictional business.
- **Temporary access token.** The Meta token expires after ~24h. For longer use, create a permanent System User token in Meta Business Settings.
- **Text only.** Images, audio notes and buttons get a fallback reply.
- **No order or reminder logic yet.**

---

## Roadmap

Good places to start contributing:

1. **Persistent conversation storage** per customer and per business (e.g. Vercel KV or Postgres), passed as `history` to `generateReply()` in `lib/ai.js`.
2. **Per-business configuration**: load the system prompt / FAQ from a database, driven by a dashboard.
3. **Scheduled reminders** using a cron job (e.g. Vercel Cron) that sends WhatsApp template messages.
4. **Structured order / appointment confirmation flows** instead of free-form chat.
5. **Media handling** for images and voice notes.

---

## License

No license has been specified yet. Please contact the repository owner before reusing the code.
