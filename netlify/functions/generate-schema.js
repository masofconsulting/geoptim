// Netlify v2 — 2 appels Anthropic en parallèle (streaming interne)
// Org+Person en parallèle avec FAQPage → temps total = max(t1, t2)
async function collectStream(KEY, body) {
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error?.type === 'overloaded_error' && attempt < MAX - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw new Error(errData.error?.message || `Erreur Anthropic ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
        if (ev.type === 'error') throw new Error(ev.error?.message || 'Erreur stream Anthropic');
      }
    }
    return text;
  }
  return '';
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return new Response(JSON.stringify({ error: "clé manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let domain, name, ctx, rawContent;
  try { ({ domain, name, ctx, rawContent } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const content = (rawContent || '').slice(0, 3000);

  const promptOrg = `Génère les blocs Schema.org Organisation et Personne pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

FORMAT EXACT :
<!-- ${name} — Schema.org JSON-LD | Geoptim.io | Coller dans <head> via RankMath, Yoast ou Insert Headers & Footers -->

<!-- Organisation (toutes les pages) -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":["[TypeLePlusPrécis]","Organization"],"@id":"https://${domain}/#org","name":"[nom officiel]","description":"[description 1-2 phrases]","url":"https://${domain}"[ajouter si trouvé: ,"telephone":"...","email":"...","address":{"@type":"PostalAddress","streetAddress":"...","postalCode":"...","addressLocality":"...","addressCountry":"FR"},"geo":{"@type":"GeoCoordinates","latitude":...,"longitude":...},"openingHours":["..."],"areaServed":["..."],"sameAs":["url_facebook","url_linkedin","url_instagram","..."],"hasOfferCatalog":{"@type":"OfferCatalog","name":"[nom catalogue]","itemListElement":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"[service]"}},{"@type":"Offer","itemOffered":{"@type":"Service","name":"[service]"}}]}]}
</script>

<!-- Personne (une balise par personne identifiée) -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","name":"[nom]","jobTitle":"[titre]","worksFor":{"@id":"https://${domain}/#org"}[ajouter si trouvé: ,"email":"...","telephone":"...","knowsAbout":["domaine1","domaine2"],"sameAs":["url_linkedin","url_twitter"]]}
</script>

RÈGLES : @type le plus précis possible (LegalService, MedicalBusiness, AccountingService, Restaurant, ConstructionBusiness...), valeurs réelles uniquement, omets les champs sans données, omets le bloc Personne si aucune personne identifiée.`;

  const promptFaq = `Génère le bloc FAQPage Schema.org pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

FORMAT EXACT :
<!-- FAQPage — questions fréquentes du secteur -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{"@type":"Question","name":"[question longue traîne précise]","acceptedAnswer":{"@type":"Answer","text":"[réponse factuelle 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots]"}},
{"@type":"Question","name":"[question sur contact ou zone]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-50 mots avec coordonnées si dispo]"}}
]}
</script>

<!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->

RÈGLES : 8 questions réelles liées à l'activité du site, réponses factuelles et concises en 40-50 mots, données réelles uniquement, pas de valeurs inventées.`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        const system = "Tu es un expert Schema.org et structured data. Tu génères des balises JSON-LD complètes, précises et valides, en utilisant uniquement les données réelles fournies.";
        const [orgText, faqText] = await Promise.all([
          collectStream(KEY, { model: "claude-sonnet-4-6", max_tokens: 2000, system, messages: [{ role: "user", content: promptOrg }] }),
          collectStream(KEY, { model: "claude-sonnet-4-6", max_tokens: 1500, system, messages: [{ role: "user", content: promptFaq }] })
        ]);
        const clean = t => t.trim().replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const combined = clean(orgText) + "\n\n" + clean(faqText);
        ctrl.enqueue(enc.encode(combined));
        ctrl.close();
      } catch (err) {
        ctrl.enqueue(enc.encode(`\n__GEOPTIM_ERROR__${err.message}`));
        ctrl.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
