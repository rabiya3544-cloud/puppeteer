const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT   = process.env.PORT || 3000;
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';

// Chrome on 512 MB can't run multiple pages — serialize requests
let active = 0;
const MAX_ACTIVE = 1;
const queue = [];

async function withSlot(fn) {
  if (active >= MAX_ACTIVE) {
    await new Promise(resolve => queue.push(resolve));
  }
  active++;
  try { return await fn(); }
  finally {
    active--;
    const next = queue.shift();
    if (next) { next(); }
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function scrape({ url, mobile = false, colorScheme, screenshot = true }) {
  const viewport = mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1280, height: 800, deviceScaleFactor: 1 };

  const ua = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
    ],
    executablePath: CHROME,
    headless: 'shell',
    defaultViewport: viewport,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(ua);
    if (colorScheme) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);
    }

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    } catch {}

    await new Promise(r => setTimeout(r, 2000));

    let html = '';
    try { html = await page.content(); } catch {}

    let shot = '';
    if (screenshot) {
      try {
        shot = await page.screenshot({ type: 'jpeg', quality: 80, encoding: 'base64' });
      } catch {}
    }

    return { html, screenshot: shot };
  } finally {
    try { await browser.close(); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('index.html not found');
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'POST' || !req.url.startsWith('/api/scrape')) {
    return json(res, 404, { error: 'Not found' });
  }

  let body = '';
  for await (const chunk of req) { body += chunk; }

  let data;
  try { data = JSON.parse(body); }
  catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { url, mobile = false, colorScheme, screenshot = true } = data || {};
  if (!url) { return json(res, 400, { error: 'url is required' }); }

  let parsed;
  try { parsed = new URL(url); }
  catch { return json(res, 400, { error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return json(res, 400, { error: 'Only http(s) URLs allowed' });
  }

  try {
    const result = await withSlot(() =>
      scrape({ url: parsed.href, mobile, colorScheme, screenshot })
    );
    return json(res, 200, result);
  } catch (err) {
    return json(res, 502, { error: 'Scrape failed', message: err.message });
  }
});

server.listen(PORT, () => console.log(`Listening on :${PORT}`));
