const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const CLIENT_TIMEOUT = 55000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') { return res.status(204).end(); }
  if (req.method !== 'POST')    { return res.status(405).json({ error: 'POST only' }); }

  const { url, mobile = false, colorScheme, screenshot = true } = req.body || {};
  if (!url) { return res.status(400).json({ error: 'url is required' }); }

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http(s) URLs allowed' });
  }

  const viewport = mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1280, height: 800, deviceScaleFactor: 1 };

  const ua = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: viewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(ua);

    if (colorScheme) {
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: colorScheme }
      ]);
    }

    await page.goto(parsed.href, {
      waitUntil: 'networkidle2',
      timeout: 35000,
    });

    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();

    let shot = null;
    if (screenshot) {
      shot = await page.screenshot({
        type: 'jpeg',
        quality: 80,
        encoding: 'base64',
      });
    }

    return res.status(200).json({ html, screenshot: shot });
  } catch (err) {
    return res.status(502).json({ error: 'Scrape failed', message: err.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
};
