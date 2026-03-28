// Wandr API Server
// Node.js + Express
// Handles: incoming shares, URL metadata scraping, Anthropic AI extraction
//
// Deploy to: Railway, Render, Fly.io, or any Node host
// Required env vars: ANTHROPIC_API_KEY

import express from 'express';
import cors from 'cors';
import { load } from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── POST /api/extract ──────────────────────────────────────────────────────
// Main extraction endpoint.
// Body: { url, text, title, tripId }
// Returns: { places: [...] }
//
// Flow:
//   1. If URL provided → scrape metadata (title, description, og:description)
//   2. Combine all available text
//   3. Send to Claude for structured place extraction
//   4. Return structured place array

app.post('/api/extract', async (req, res) => {
  const { url, text, title, tripId } = req.body;

  if (!url && !text) {
    return res.status(400).json({ error: 'Provide either a URL or text content.' });
  }

  try {
    // Step 1: Scrape content from URL if provided
    let scrapedContent = '';
    let pageTitle = title || '';

    if (url) {
      const scraped = await scrapeUrl(url);
      scrapedContent = scraped.content;
      pageTitle = scraped.title || pageTitle;
    }

    // Step 2: Combine all available text signals
    const combinedText = [
      pageTitle,
      text || '',
      scrapedContent,
    ].filter(Boolean).join('\n\n');

    if (!combinedText.trim()) {
      return res.status(422).json({ error: 'Could not extract any readable content from this URL.' });
    }

    // Step 3: Run AI extraction
    const places = await extractPlacesWithAI(combinedText, url);

    res.json({
      places,
      source: { url, title: pageTitle },
      extractedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[extract]', err);
    res.status(500).json({ error: 'Extraction failed. Please try again.' });
  }
});

// ─── URL Scraper ────────────────────────────────────────────────────────────
// Fetches a URL and pulls out all useful text signals:
// page title, meta description, og:description, and visible body text.
//
// Note on Instagram/TikTok:
//   These platforms render content client-side and block server scrapers.
//   What we CAN get: og:title, og:description (which often contains the caption).
//   For richer extraction in production, use a headless browser (Playwright)
//   or a social media scraping API (Apify, ScrapingBee).

async function scrapeUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Spoof a real browser user agent — many platforms block default Node fetch
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = await response.text();
    const $ = load(html);

    // Pull every useful text signal
    const title       = $('title').first().text().trim();
    const ogTitle     = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc      = $('meta[property="og:description"]').attr('content') || '';
    const metaDesc    = $('meta[name="description"]').attr('content') || '';
    const twitterDesc = $('meta[name="twitter:description"]').attr('content') || '';

    // Body text — strip scripts/styles, collapse whitespace
    $('script, style, nav, footer, header').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

    const content = [ogTitle, ogDesc, metaDesc, twitterDesc, bodyText]
      .filter(Boolean)
      .join('\n');

    return { title: ogTitle || title, content };

  } catch (err) {
    if (err.name === 'AbortError') throw new Error('URL fetch timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── AI Extraction ──────────────────────────────────────────────────────────
// Sends combined text to Claude and returns structured place data.

async function extractPlacesWithAI(text, sourceUrl = '') {

  const platform = detectPlatform(sourceUrl);

  const systemPrompt = `You are a travel assistant that extracts named places from social media content.
Extract every restaurant, cafe, bar, shop, gallery, market, or landmark mentioned.
Return ONLY a valid JSON array. No markdown. No explanation. No preamble.`;

  const userPrompt = `Platform: ${platform}
Source URL: ${sourceUrl || 'not provided'}

Content:
${text.slice(0, 4000)}

Extract all named places. For each return:
{
  "name": "exact place name as mentioned",
  "emoji": "single relevant emoji",
  "category": "food | cafe | bar | shop | art | market | landmark | other",
  "neighbourhood": "neighbourhood or area if mentioned, else empty string",
  "address": "full address if mentioned, else empty string",
  "hours": "opening hours if mentioned, else null",
  "priceRange": "$ | $$ | $$$ | $$$$ | null",
  "tags": ["2-3 short descriptive tags"],
  "mentionedAs": "brief quote or description of how it was mentioned",
  "city": "city name if determinable"
}

If no places are found, return [].`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  const data = await response.json();

  if (data.error) throw new Error(data.error.message);

  const raw = data.content.map((c) => c.text || '').join('');
  const clean = raw.replace(/```json|```/g, '').trim();

  let places;
  try {
    places = JSON.parse(clean);
  } catch {
    throw new Error('AI returned malformed JSON');
  }

  if (!Array.isArray(places)) throw new Error('AI did not return an array');

  // Stamp each place with a unique ID and the source URL
  return places.map((p, i) => ({
    ...p,
    id: `${Date.now()}-${i}`,
    sourceUrl,
    savedAt: new Date().toISOString(),
    addedToItinerary: false,
  }));
}

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'X / Twitter';
  return 'web';
}

// ─── GET /api/health ────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Wandr API] Listening on port ${PORT}`);
});
