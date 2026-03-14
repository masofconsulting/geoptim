async function callAnthropic(KEY, body, timeoutMs) {
  const MAX = 3;
  for (let i = 0; i < MAX; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json();
    if (data.error && data.error.type === 'overloaded_error' && i < MAX - 1) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    return data;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: "clé manquante" }) };

  try {
    const { domain, name, ctx, rawContent } = JSON.parse(event.body);
    const content = (rawContent || '').slice(0, 800);

    // 2 appels en parallèle via Promise.all :
    // Appel 1 : Organisation + Personne  → max_tokens 700 = 7s max à 100 tok/s
    // Appel 2 : FAQPage                  → max_tokens 700 = 7s max à 100 tok/s
    // Total en parallèle : 7s max — impossible de timeout à 26s

    const promptOrg = `Génère les blocs Schema.org Organisation et Personne pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

FORMAT :
<!-- ${name} — Schema.org JSON-LD | Geoptim.io | head via RankMath/Yoast ou Insert Headers & Footers -->

<!-- Organisation (toutes les pages) -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":["[TypePrécis]","Organization"],"@id":"https://${domain}/#org","name":"...","description":"...","url":"https://${domain}"[,telephone,email,address,geo,openingHours,areaServed,sameAs,hasOfferCatalog si trouvés]}
</script>

<!-- Personne (répéter par personne trouvée) -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","name":"...","jobTitle":"...","worksFor":{"@id":"https://${domain}/#org"}[,knowsAbout,sameAs si trouvés]}
</script>

RÈGLES : @type le plus précis (LegalService, MedicalBusiness, Restaurant...), valeurs réelles uniquement, omets les champs sans données, omets le bloc Personne si aucune personne identifiée.`;

    const promptFaq = `Génère le bloc FAQPage Schema.org pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

FORMAT :
<!-- FAQPage -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[5 questions réelles du secteur, chaque acceptedAnswer 30 mots max]}
</script>

<!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->

RÈGLES : 5 questions réelles liées à l'activité, réponses factuelles et concises, données réelles uniquement.`;

    const [dataOrg, dataFaq] = await Promise.all([
      callAnthropic(KEY, { model: "claude-sonnet-4-6", max_tokens: 700, messages: [{ role: "user", content: promptOrg }] }, 22000),
      callAnthropic(KEY, { model: "claude-sonnet-4-6", max_tokens: 700, messages: [{ role: "user", content: promptFaq }] }, 22000)
    ]);

    if (dataOrg.error) throw new Error(dataOrg.error.message);
    if (dataFaq.error) throw new Error(dataFaq.error.message);

    const orgText = (dataOrg.content || []).map(b => b.text || "").join("").trim()
      .replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const faqText = (dataFaq.content || []).map(b => b.text || "").join("").trim()
      .replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: orgText + "\n\n" + faqText })
    };

  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
