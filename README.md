# RepliQ Bot — test webhook

Minimal WhatsApp Cloud API webhook that replies to incoming messages using Claude. No framework — just two serverless functions, ready for Vercel.

## What it does

1. A customer sends a WhatsApp message to your Meta test number.
2. Meta calls `POST /api/webhook` with the message.
3. The function calls Claude to generate a reply (business context is defined in `lib/ai.js`).
4. The function sends the reply back via the WhatsApp Cloud API.

## 1. Deploy to Vercel

```bash
npm install -g vercel   # if you don't have it
cd repliq-bot
vercel
```

Follow the prompts (link or create a project). Once deployed, Vercel gives you a URL like:

```
https://repliq-bot.vercel.app
```

Your webhook URL will be:

```
https://repliq-bot.vercel.app/api/webhook
```

## 2. Set environment variables

In the Vercel dashboard → your project → **Settings → Environment Variables**, add the four variables from `.env.example`:

| Variable | Where to find it |
|---|---|
| `WHATSAPP_TOKEN` | Meta App Dashboard → WhatsApp → API Setup (temporary token, ~24h) |
| `WHATSAPP_PHONE_NUMBER_ID` | Same page, labeled "Phone number ID" |
| `VERIFY_TOKEN` | Any string you make up yourself, e.g. `repliq-test-2026` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |

Redeploy after adding them (`vercel --prod`, or just push again) so they take effect.

## 3. Point Meta at your webhook

In the Meta App Dashboard → **WhatsApp → Configuration**:

1. Click **Edit** next to Webhook.
2. Callback URL: `https://repliq-bot.vercel.app/api/webhook`
3. Verify token: the exact same string you set as `VERIFY_TOKEN` in Vercel.
4. Click **Verify and save** — Meta will call your webhook with a `GET` request; if it responds correctly you'll see a success message.
5. Under **Webhook fields**, subscribe to `messages`.

## 4. Test it

From your own WhatsApp (the number you verified as a test recipient in the Meta dashboard), send a message to the test number. Within a couple seconds you should get a Claude-generated reply back.

Check **Vercel → your project → Logs** if something doesn't respond — that's where `console.log`/`console.error` output from the function shows up.

## Known limitations (fine for testing, not for production)

- **No conversation memory.** Each message is answered independently — the bot doesn't remember earlier turns. Fine for quick FAQ-style testing; for real conversations you'll want to store recent messages per customer (e.g. in Vercel KV or a small Postgres table) and pass them as `history` to `generateReply()` in `lib/ai.js`.
- **One hardcoded business.** The system prompt in `lib/ai.js` describes a single fictional business. In the real product this needs to be loaded per WhatsApp number from a database, driven by what each RepliQ customer configures in their dashboard.
- **Temporary access token.** The token from the Meta dashboard expires after ~24h. For anything beyond a single test session, generate a permanent token (System User token) in Meta Business Settings.
- **Text-only.** Images, audio notes, and buttons aren't handled yet — the bot just replies with a fallback message for those.
- **No order/reminder logic yet.** This is just the "AI answers a message" loop — order confirmation flows, scheduled reminders, and the status dashboard are separate pieces to build next.

## Next steps

Once this loop works end-to-end, the natural next additions are:
1. Persistent conversation storage (per customer, per business).
2. A way to configure each business's system prompt / FAQ from the RepliQ dashboard instead of hardcoding it.
3. Scheduled reminders (a cron job, e.g. Vercel Cron, that sends template messages at the right time).
4. Order/appointment confirmation as a structured flow rather than free-form chat.
