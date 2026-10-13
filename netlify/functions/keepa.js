// Netlify Function: server-side proxy to the Keepa API so the key never reaches the browser.
// Env vars (Netlify → Site settings → Environment variables):
//   KEEPA_API_KEY  – your Keepa key
//   APP_PASSWORD   – shared password coaches type into the page (stops strangers using your tokens)

const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const key = process.env.KEEPA_API_KEY, pass = process.env.APP_PASSWORD;
  if (!key) return json(500, { error: 'KEEPA_API_KEY is not set on this site' });
  if (!pass) return json(500, { error: 'APP_PASSWORD is not set on this site' });
  if ((event.headers['x-app-password'] || '') !== pass) return json(401, { error: 'Wrong password' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const asins = (Array.isArray(body.asins) ? body.asins : []).map((a) => String(a).toUpperCase().trim()).filter((a) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 10);
  if (!asins.length) return json(400, { error: 'No valid ASINs' });

  const q = new URLSearchParams({ key, domain: '2', asin: asins.join(','), stats: '90', history: '1', buybox: '1' }); // domain 2 = amazon.co.uk
  if (body.deep) { q.set('offers', '20'); q.set('only-live-offers', '1'); }

  try {
    const res = await fetch('https://api.keepa.com/product?' + q.toString());
    const text = await res.text();
    return { statusCode: res.status, headers: { 'content-type': 'application/json' }, body: text };
  } catch (e) {
    return json(502, { error: 'Could not reach Keepa: ' + e.message });
  }
};
