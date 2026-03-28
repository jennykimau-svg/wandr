# Wandr

Save Instagram reels and TikToks. Extract places automatically. Build your itinerary.

---

## How the share sheet works

When Wandr is installed as a PWA (Add to Home Screen), it registers itself
as a share target via the Web Share Target API. This means:

1. User opens a reel on Instagram or TikTok
2. Taps the native Share button
3. **Wandr appears in the share sheet** alongside iMessage, Notes, etc.
4. Tapping Wandr sends the URL to `/share-target` (handled by the service worker)
5. The service worker stores the URL in IndexedDB and redirects to `/?incoming=1`
6. The app detects the incoming share and shows the "Extract places" prompt
7. The URL is sent to `/api/extract` → scraped → run through Claude → places returned

---

## Project structure

```
wandr/
├── public/
│   ├── index.html      ← PWA shell + full app UI
│   ├── manifest.json   ← PWA manifest (declares share_target)
│   ├── sw.js           ← Service worker (intercepts shares, caches app)
│   └── icons/          ← App icons (add icon-192.png and icon-512.png)
├── api/
│   └── server.js       ← Express API (scraping + AI extraction)
├── package.json
└── README.md
```

---

## Deploy in 3 steps

### Step 1 — Add your API key

Create a `.env` file:
```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
```

### Step 2 — Deploy the API

The API server needs to run on a real HTTPS domain (required for PWAs).

**Recommended: Railway (free tier)**
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variable: `ANTHROPIC_API_KEY`
4. Railway gives you an HTTPS URL like `https://wandr-api.railway.app`

**Alternative: Render, Fly.io, or any Node host**

### Step 3 — Deploy the frontend

Update the `/api/extract` fetch URL in `public/index.html` to point to your API:

```js
// Line ~180 in index.html — change this:
const response = await fetch('/api/extract', { ... })

// To your deployed API URL:
const response = await fetch('https://wandr-api.railway.app/api/extract', { ... })
```

Then deploy the `public/` folder to any static host:
- **Netlify** (drag and drop the `public/` folder — done)
- **Vercel** (`vercel --prod` from the `public/` directory)
- **Cloudflare Pages**

Your site will be at `https://wandr.netlify.app` (or similar).

### Step 4 — Install on your phone

1. Open your deployed URL in **Safari on iPhone** (must be Safari for PWA install)
2. Tap the Share button → **Add to Home Screen**
3. Wandr now appears on your home screen AND in your share sheet

---

## iOS vs Android share sheet support

| Platform | Support | Notes |
|----------|---------|-------|
| iOS 16.4+ | ✅ Full | Must install via Safari "Add to Home Screen" |
| iOS < 16.4 | ⚠️ Partial | App installs but may not appear in share sheet |
| Android Chrome | ✅ Full | Install prompt appears automatically |
| Desktop Chrome | ✅ Full | Works as installed PWA |

---

## Note on Instagram/TikTok scraping

Instagram and TikTok block server-side scrapers. What the current scraper
retrieves: `og:title`, `og:description`, and meta tags — which usually
contain the post caption. This is enough for extraction in most cases.

For richer extraction in production (e.g. reading video transcripts):
- **Apify** has ready-made Instagram/TikTok scrapers
- **Playwright** (headless browser) can render JS and read the full DOM
- **OpenAI Whisper** can transcribe audio from video files

---

## Icons

Add two PNG files to `public/icons/`:
- `icon-192.png` — 192×192px
- `icon-512.png` — 512×512px

Use a simple map pin or compass on a dark background. 
Figma template: create a 512×512 frame, fill `#1A1A18`, add white icon.
