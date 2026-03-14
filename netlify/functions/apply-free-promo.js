// Bypass Stripe pour les codes 100% gratuits.
// Retourne la même structure que verify-payment pour que le frontend
// puisse traiter le résultat de façon identique.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON invalide" }) };
  }

  const code = (body.code || '').trim().toUpperCase();

  let codes;
  try { codes = JSON.parse(process.env.PROMO_CODES || '{}'); } catch { codes = {}; }

  const percent = codes[code];
  if (!percent || percent < 100) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: "Code invalide ou non gratuit" })
    };
  }

  // ID unique basé sur le code + timestamp pour dédupliquer côté frontend
  const sessionId = 'PROMO-' + code + '-' + Date.now();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paid:         true,
      purchaseType: body.purchaseType || 'pack',
      fileKey:      body.fileKey      || '',
      sessionId,
      amount:       0,
      siteName:     body.siteName     || '',
      siteUrl:      body.siteUrl      || ''
    })
  };
};
