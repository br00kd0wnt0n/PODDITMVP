# Poddit — Setup Guide

## Architecture Overview

```
Capture Layer          Processing           Output
─────────────         ──────────           ──────
SMS (Twilio)    →                          
Email (SendGrid)→     Signal Queue  →      Claude API    →  ElevenLabs TTS  →  Audio (S3/R2)
Extension       →     (Postgres)          (synthesis)       (voice gen)         ↓
Share Sheet     →                                                            Web Player
                                                                             SMS Notification
```

**Stack:** Next.js 15 · Prisma · PostgreSQL · Claude API · ElevenLabs · Twilio · Cloudflare R2

---

## 1. Railway Setup

### Create the project

1. Go to [railway.app](https://railway.app) and create a new project
2. Add a **PostgreSQL** database service (click "New" → "Database" → "PostgreSQL")
3. Add a new service from your GitHub repo (connect your repo)
4. Railway will auto-detect Next.js

### Configure environment

In your web service's **Variables** tab, add all variables from `.env.example`. Railway auto-provides `DATABASE_URL` from the Postgres service — just reference it:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
```

### Deploy settings

- **Build command:** `npm run build`
- **Start command:** `npm start`
- **Root directory:** `/` (or wherever your repo root is)

### Set up cron

In Railway, add a **Cron Service**:
- **Schedule:** `0 17 * * 5` (Fridays at 5pm UTC — adjust to your timezone)
- **Command:** `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.railway.app/api/cron`

---

## 2. Twilio Setup (SMS Capture)

### Create account & number

1. Sign up at [twilio.com](https://www.twilio.com)
2. Go to **Phone Numbers** → **Buy a Number**
3. Choose a US number with SMS capability (~$1.15/month)
4. Note your **Account SID** and **Auth Token** from the dashboard

### Configure webhook

1. Go to your phone number's configuration page
2. Under **Messaging** → **A message comes in**:
   - **Webhook URL:** `https://your-app.railway.app/api/capture/sms`
   - **HTTP Method:** POST
3. Save

### Test it

Text a URL to your Twilio number. You should get a confirmation reply and see the signal in your database.

### Costs

- Phone number: ~$1.15/month
- Inbound SMS: Free
- Outbound SMS (confirmations): ~$0.0079/message
- Monthly cost for personal use: ~$2-3/month

---

## 3. Email Capture (SendGrid Inbound Parse)

### Setup

1. Sign up for [SendGrid](https://sendgrid.com) (free tier works)
2. Go to **Settings** → **Inbound Parse**
3. Add a new host/URL:
   - **Domain:** Your domain (e.g., `poddit.com`) — requires MX record setup
   - **URL:** `https://your-app.railway.app/api/capture/email`
4. Add MX record to your domain's DNS:
   ```
   MX  mx.sendgrid.net  priority: 10
   ```

### Alternative: Simpler email setup

If you don't want to configure MX records yet, use a subdomain:
- Set up `pod.poddit.com` with MX pointing to SendGrid
- Forward emails to `anything@pod.poddit.com`

### Test it

Forward any email/newsletter to your configured address.

---

## 4. File Storage (Cloudflare R2)

R2 is cheapest for audio file hosting. S3-compatible API, generous free tier.

1. Sign up for [Cloudflare](https://dash.cloudflare.com)
2. Go to **R2** → **Create Bucket** → name it `poddit-audio`
3. Under bucket settings, enable **Public Access** (or set up a custom domain)
4. Create an **API Token** with R2 read/write permissions
5. Note the **Account ID**, **Access Key ID**, and **Secret Access Key**

Set in `.env`:
```
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=poddit-audio
S3_ACCESS_KEY=<your-access-key>
S3_SECRET_KEY=<your-secret-key>
S3_PUBLIC_URL=https://pub-<hash>.r2.dev  # or your custom domain
```

---

## 5. ElevenLabs Setup

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to **Profile** → copy your **API Key**
3. Browse **Voice Library** or use a default voice
4. Copy the **Voice ID** of your preferred voice

Set in `.env`:
```
ELEVENLABS_API_KEY=<your-key>
ELEVENLABS_VOICE_ID=<voice-id>
```

### Costs
- Free tier: 10,000 characters/month (~10 min audio)
- Starter ($5/mo): 30,000 characters (~30 min audio)
- Creator ($22/mo): 100,000 characters (~100 min audio)

For MVP (1 episode/week at ~20 min), Starter tier is sufficient.

---

## 6. Anthropic API Setup

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### Costs
- Claude Sonnet: ~$3/M input tokens, $15/M output tokens
- Typical episode generation: ~$0.05-0.15 per episode
- Monthly cost: < $1 for weekly episodes

---

## 7. Browser Extension

### Load in Chrome (development)

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `/extension` folder
4. Click the extension icon → configure:
   - **Server URL:** Your Railway app URL
   - **API Secret:** Your `API_SECRET` value

### Usage

- **Click the icon** → sends current page to Poddit
- **Right-click any link** → "Poddit this link"
- **Select text + right-click** → "Poddit: [selected text]" (captures as topic)
- **Type a topic** in the popup → "Capture topic"

---

## 8. PWA Share Sheet (Mobile)

### Install as PWA

1. Visit your app URL on your phone's browser
2. **iOS Safari:** Tap Share → "Add to Home Screen"
3. **Android Chrome:** Tap menu → "Add to Home Screen"

Once installed as a PWA, "Poddit" will appear in your device's native share sheet. Any time you share a link from any app, you can select Poddit to capture it.

---

## 9. First Run

```bash
# Clone and install
git clone <your-repo>
cd poddit
npm install

# Set up database
cp .env.example .env  # Fill in your values
npx prisma db push    # Create tables

# Run locally
npm run dev

# Test capture
curl -X POST http://localhost:3000/api/capture/extension \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "title": "Test Article"}'

# Check signals
curl http://localhost:3000/api/signals

# Manual generation
curl -X POST http://localhost:3000/api/generate \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"daysBack": 7}'
```

---

## Database Management

```bash
# View your data
npx prisma studio

# Run migrations after schema changes
npx prisma migrate dev --name description

# Reset database (destructive)
npx prisma db push --force-reset
```

---

## Estimated Monthly Costs (Personal Use)

| Service | Cost |
|---------|------|
| Railway (app + Postgres) | ~$5-7 |
| Twilio (number + SMS) | ~$2-3 |
| ElevenLabs (Starter) | $5 |
| Anthropic API | < $1 |
| Cloudflare R2 | Free tier |
| SendGrid | Free tier |
| **Total** | **~$13-16/month** |
