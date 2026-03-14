// Valide un code promo. PROMO_CODES = JSON {"CODE": percent, ...}
// Ex: {"LAUNCH50": 50, "MASOF": 100, "FRIEND20": 20}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON invalide" }) };
  }

  const code = (body.code || '').trim().toUpperCase();
  const purchaseType = body.purchaseType || 'pack';

  if (!code) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: false }) };

  let codes;
  try { codes = JSON.parse(process.env.PROMO_CODES || '{}'); } catch { codes = {}; }

  const percent = codes[code];
  if (!percent || typeof percent !== 'number' || percent <= 0) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valid: false }) };
  }

  const baseAmount = purchaseType === 'pack' ? 4900 : 1900;
  const finalAmount = percent >= 100 ? 0 : Math.round(baseAmount * (1 - percent / 100));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valid: true, percent, finalAmount, isFree: percent >= 100 })
  };
};
