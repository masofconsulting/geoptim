// netlify/functions/create-checkout.js
// Crée une session Stripe Checkout pour 29 €

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "STRIPE_SECRET_KEY manquante" }) };
  }

  try {
    const { siteName, siteUrl, billingName, billingAddress, billingType, billingVat } = JSON.parse(event.body);
    const host   = event.headers["x-forwarded-host"] || event.headers.host || "geoptim.io";
    const origin = `https://${host}`;
    const label  = siteName || siteUrl || "votre site";

    const params = new URLSearchParams();
    params.append("payment_method_types[]", "card");
    params.append("mode", "payment");
    params.append("customer_creation", "always");
    params.append("success_url", `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url",  `${origin}/?payment=cancelled`);
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][unit_amount]", "2900");
    params.append("line_items[0][price_data][product_data][name]", "Pack Optimisation GEO");
    params.append("line_items[0][price_data][product_data][description]",
      `4 fichiers GEO personnalisés pour ${label} — robots.txt, llms.txt, Schema.org JSON-LD, FAQ GEO`);
    params.append("payment_intent_data[description]", `Geoptim — Pack GEO pour ${label}`);
    params.append("metadata[site_url]",  siteUrl  || "");
    params.append("metadata[site_name]", siteName || "");
    // Coordonnées de facturation
    params.append("metadata[billing_name]",    billingName    || "");
    params.append("metadata[billing_address]", billingAddress || "");
    params.append("metadata[billing_type]",    billingType    || "particulier");
    params.append("metadata[billing_vat]",     billingVat     || "");

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
