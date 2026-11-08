const http = require('http');
const puppeteer = require('puppeteer-core');

const CHROME = '/usr/bin/google-chrome-stable';

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function scrape(url, mobile, colorScheme, takeScreenshot) {
  const viewport = mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1280, height: 800, deviceScaleFactor: 1 };

  const ua = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: CHROME,
    headless: true,
    defaultViewport: viewport,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(ua);
    if (colorScheme) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);
    }
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    const screenshot = takeScreenshot
      ? await page.screenshot({ type: 'jpeg', quality: 80, encoding: 'base64' })
      : null;

    return { html, screenshot };
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/') {
    const fs = require('fs');
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    return res.end(html);
  }
  if (req.method !== 'POST' || !req.url.startsWith('/api/scrape')) {
    return json(res, 404, { error: 'Not found' });
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let data;
  try { data = JSON.parse(body); }
  catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { url, mobile = false, colorScheme, screenshot = true } = data || {};
  if (!url) return json(res, 400, { error: 'url is required' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return json(res, 400, { error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return json(res, 400, { error: 'Only http(s) URLs allowed' });
  }

  try {
    const result = await scrape(parsed.href, mobile, colorScheme, screenshot);
    return json(res, 200, result);
  } catch (err) {
    return json(res, 502, { error: 'Scrape failed', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on :${PORT}`));
