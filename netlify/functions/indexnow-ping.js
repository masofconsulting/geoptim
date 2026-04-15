// Ping IndexNow (Bing, Yandex, Seznam, Naver) with all URLs from sitemap.xml.
// Designed to be called:
//   - automatically after each Netlify deploy via an outgoing deploy-succeeded webhook
//     pointing at /.netlify/functions/indexnow-ping
//   - manually by visiting /indexnow-ping in a browser for a one-off push
//
// Optional protection: set INDEXNOW_TRIGGER_SECRET env var, then call with
//   ?secret=... or header x-webhook-secret: ...
// If the env var is unset the endpoint is open (safe: IndexNow itself validates
// ownership via the keyLocation file).

const INDEXNOW_KEY = 'c8f2a9e4b7d1e5a3f6b8c9d2e4f7a1b5';
const HOST = 'geoptim.io';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;

exports.handler = async (event) => {
  // Optional shared-secret check
  const expectedSecret = process.env.INDEXNOW_TRIGGER_SECRET;
  if (expectedSecret) {
    const headerSecret = event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret'];
    const querySecret = event.queryStringParameters?.secret;
    if (headerSecret !== expectedSecret && querySecret !== expectedSecret) {
      return { statusCode: 401, body: 'unauthorized' };
    }
  }

  try {
    // 1. Fetch current sitemap
    const sitemapRes = await fetch(SITEMAP_URL, {
      signal: AbortSignal.timeout(10000)
    });
    if (!sitemapRes.ok) {
      return {
        statusCode: 502,
        body: `sitemap fetch failed: ${sitemapRes.status}`
      };
    }
    const xml = await sitemapRes.text();

    // 2. Extract <loc> URLs (ignore <xhtml:link> alternates)
    const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map(m => m[1].trim())
      .filter(u => u.startsWith(`https://${HOST}`));

    if (urls.length === 0) {
      return { statusCode: 200, body: 'no urls found in sitemap' };
    }

    // 3. POST to IndexNow (Bing endpoint accepts on behalf of the IndexNow network)
    const payload = {
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls
    };

    const indexRes = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    const responseText = await indexRes.text().catch(() => '');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        ok: indexRes.ok,
        indexnow_status: indexRes.status,
        indexnow_response: responseText.slice(0, 500),
        urls_pinged: urls.length,
        urls_sample: urls.slice(0, 3)
      }, null, 2)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `error: ${err.message || err}`
    };
  }
};
