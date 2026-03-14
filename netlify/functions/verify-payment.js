// netlify/functions/verify-payment.js
// Vérifie qu'un paiement Stripe est bien complété et envoie le reçu par email

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "STRIPE_SECRET_KEY manquante" }) };
  }

  let stripeSessionId;
  try {
    ({ stripeSessionId } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body invalide" }) };
  }

  if (!stripeSessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "stripeSessionId manquant" }) };
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripeSessionId}`, {
      headers: { "Authorization": `Bearer ${key}` },
      signal: AbortSignal.timeout(8000)
    });
    const session = await res.json();

    if (!res.ok || session.error) {
      throw new Error(session.error?.message || `Stripe ${res.status}`);
    }

    const isPaid        = session.payment_status === "paid";
    const email         = (session.customer_details && session.customer_details.email) || "";
    const amount        = session.amount_total || 2900;
    const created       = session.created || Math.floor(Date.now() / 1000);
    const siteName      = (session.metadata && session.metadata.site_name)      || "";
    const siteUrl       = (session.metadata && session.metadata.site_url)       || "";
    const sessionId     = session.id || "";
    const billingName   = (session.metadata && session.metadata.billing_name)    || "";
    const billingAddress= (session.metadata && session.metadata.billing_address) || "";
    const billingType   = (session.metadata && session.metadata.billing_type)    || "particulier";
    const billingVat    = (session.metadata && session.metadata.billing_vat)     || "";

    // ── Envoi du reçu par email (non-bloquant) ─────────────────────────────
    // Requiert la variable d'environnement RESEND_API_KEY sur Netlify.
    // Créer un compte gratuit sur https://resend.com et vérifier le domaine geoptim.io.
    if (isPaid && email && process.env.RESEND_API_KEY) {
      try {
        const ttc  = amount / 100;
        const ht   = Math.round(ttc / 1.20 * 100) / 100;
        const tva  = Math.round((ttc - ht) * 100) / 100;
        const date = new Date(created * 1000);
        const fmt  = (n) => n.toFixed(2).replace('.', ',') + ' €';
        const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
        const sid  = sessionId.slice(-8).toUpperCase();
        const num  = 'GEO-' + date.getFullYear()
                   + String(date.getMonth() + 1).padStart(2, '0')
                   + String(date.getDate()).padStart(2, '0')
                   + (sid ? '-' + sid : '');

        const emailHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Reçu ${num}</title>
<style>body{font-family:system-ui,sans-serif;color:#1f2937;max-width:600px;margin:0 auto;padding:0}
.head{background:#0a2540;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0}
.head h1{margin:0 0 4px;font-size:20px}.head p{margin:0;font-size:13px;color:#7eb3d4}
.body{padding:28px 32px;background:#fff;border:1px solid #e5e7eb;border-top:0}
.cols{display:flex;gap:24px;margin-bottom:24px}
.col{flex:1}.col h4{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin:0 0 6px}
.col p{margin:0;font-size:13px;line-height:1.7}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#6b7280;padding:10px 14px;text-align:left}
td{padding:12px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top}
.totals{display:flex;flex-direction:column;align-items:flex-end;gap:4px;padding:8px 14px 0}
.tr{display:flex;justify-content:space-between;width:200px;font-size:13px;color:#4b5563}
.ttc{display:flex;justify-content:space-between;width:200px;font-size:15px;font-weight:700;color:#0a2540;border-top:2px solid #0a2540;padding-top:8px;margin-top:6px}
.note{font-size:11px;color:#9ca3af;margin:16px 0 0;line-height:1.6}
.foot{text-align:center;padding:20px;font-size:12px;color:#9ca3af;border-top:1px solid #f1f5f9;margin-top:24px}
</style></head><body>
<div class="head"><h1>Reçu de paiement</h1><p>${num} &mdash; ${dateStr}</p></div>
<div class="body">
<div class="cols">
<div class="col"><h4>Émetteur</h4><p><strong>HM CAPITAL</strong><br>SARL unipersonnelle<br>55 Rue du Bois d'Amour, 86280 Saint-Benoît<br>SIREN : 843 444 464 &mdash; TVA : FR37843444464</p></div>
<div class="col"><h4>Client</h4><p>${billingName ? '<strong>' + billingName + '</strong><br>' : ''}${billingAddress ? billingAddress + '<br>' : ''}${billingVat ? 'TVA : ' + billingVat + '<br>' : ''}${email}${siteName && siteName !== billingName ? '<br>' + siteName : ''}${siteUrl && siteUrl !== siteName ? '<br><span style="color:#6b7280;font-size:12px">' + siteUrl + '</span>' : ''}</p></div>
</div>
<table>
<thead><tr><th>Description</th><th style="text-align:right">Montant HT</th></tr></thead>
<tbody><tr>
<td>Pack Optimisation GEO<br><span style="color:#6b7280;font-size:12px">4 fichiers GEO personnalisés — robots.txt, llms.txt, Schema.org JSON-LD, FAQ GEO${siteName ? '<br>Site : ' + siteName : ''}</span></td>
<td style="text-align:right;white-space:nowrap">${fmt(ht)}</td>
</tr></tbody></table>
<div class="totals">
<div class="tr"><span>Total HT</span><span>${fmt(ht)}</span></div>
<div class="tr"><span>TVA 20 %</span><span>${fmt(tva)}</span></div>
<div class="ttc"><span>Total TTC</span><span>${fmt(ttc)}</span></div>
</div>
<p class="note">Paiement par carte bancaire via Stripe. Service numérique livré immédiatement &mdash; droit de rétractation non applicable (art. L221-28 Code de la consommation).</p>
<div class="foot">Geoptim est un service de HM CAPITAL &mdash; contact@geoptim.io &mdash; geoptim.io</div>
</div></body></html>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "Geoptim <receipts@geoptim.io>",
            to:   [email],
            bcc:  ["contact@geoptim.io"],
            subject: `Votre reçu Geoptim — ${num}`,
            html: emailHtml
          }),
          signal: AbortSignal.timeout(5000)
        });
      } catch (emailErr) {
        // Non-bloquant : l'échec d'envoi d'email ne doit pas affecter la confirmation de paiement
        console.error("Receipt email failed:", emailErr.message);
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid: isPaid, email, amount, created, siteName, siteUrl, sessionId,
        billingName, billingAddress, billingType, billingVat }),
    };

  } catch (err) {
    console.error("verify-payment error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
