// netlify/functions/create-checkout.js
// Crée une session Stripe Checkout — 19 € (fichier unique) ou 49 € (pack 4 fichiers)

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "STRIPE_SECRET_KEY manquante" }) };
  }

  try {
    const {
      siteName, siteUrl,
      billingName, billingAddress, billingType, billingVat,
      purchaseType, // 'single' | 'pack' (défaut: 'pack')
      fileKey,      // 'robots' | 'llms' | 'schema' | 'faq' | null (pour pack)
      promoCode     // code promo optionnel
    } = JSON.parse(event.body);

    const host   = event.headers["x-forwarded-host"] || event.headers.host || "geoptim.io";
    const origin = `https://${host}`;
    const label  = siteName || siteUrl || "votre site";
    const type   = purchaseType || "pack";

    // Tarification — validation promo côté serveur (ne jamais faire confiance au client)
    const base = type === "pack" ? 4900 : 1900;
    let amount = base;
    let promoPercent = 0;
    if (promoCode) {
      let codes = {};
      try { codes = JSON.parse(process.env.PROMO_CODES || '{}'); } catch {}
      const pct = codes[(promoCode || '').trim().toUpperCase()];
      if (pct && pct > 0 && pct < 100) {
        promoPercent = pct;
        amount = Math.round(base * (1 - pct / 100));
      }
      // 100% : doit passer par apply-free-promo, pas create-checkout
    }

    // Libellé produit
    const FILE_LABELS = {
      robots: "robots.txt optimisé",
      llms:   "llms.txt personnalisé",
      schema: "Schema.org JSON-LD",
      faq:    "Page FAQ GEO-optimisée"
    };
    const productName = type === "pack"
      ? "Pack Optimisation GEO — 4 fichiers"
      : `Fichier GEO — ${FILE_LABELS[fileKey] || fileKey || "fichier"}`;
    const productDesc = type === "pack"
      ? `4 fichiers GEO personnalisés pour ${label} — robots.txt, llms.txt, Schema.org JSON-LD, FAQ GEO`
      : `${FILE_LABELS[fileKey] || fileKey || "Fichier GEO"} personnalisé pour ${label}`;

    const params = new URLSearchParams();
    params.append("payment_method_types[]", "card");
    params.append("mode", "payment");
    params.append("customer_creation", "always");
    params.append("success_url", `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url",  `${origin}/?payment=cancelled`);
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][unit_amount]", String(amount));
    params.append("line_items[0][price_data][product_data][name]", productName);
    params.append("line_items[0][price_data][product_data][description]", productDesc);
    params.append("payment_intent_data[description]", `Geoptim — ${productName} pour ${label}`);
    params.append("metadata[site_url]",       siteUrl       || "");
    params.append("metadata[site_name]",      siteName      || "");
    params.append("metadata[billing_name]",   billingName   || "");
    params.append("metadata[billing_address]",billingAddress|| "");
    params.append("metadata[billing_type]",   billingType   || "particulier");
    params.append("metadata[billing_vat]",    billingVat    || "");
    params.append("metadata[purchase_type]",  type);
    params.append("metadata[file_key]",       fileKey       || "");
    params.append("metadata[promo_code]",     promoPercent ? (promoCode || "") : "");
    params.append("metadata[promo_percent]",  promoPercent ? String(promoPercent) : "");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || `Stripe ${res.status}`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: data.url }),
    };

  } catch (err) {
    console.error("Stripe error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
