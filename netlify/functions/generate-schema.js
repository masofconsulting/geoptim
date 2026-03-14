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

  const promptOrg = `Génère les blocs Schema.org entités pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

GÉNÈRE LES BLOCS SUIVANTS (uniquement ceux pour lesquels tu as des données réelles) :

<!-- ${name} — Schema.org JSON-LD | Geoptim.io | Coller dans <head> via RankMath, Yoast ou Insert Headers & Footers -->

<!-- 1. Organisation/LocalBusiness — TOUJOURS inclus -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["[TypeLePlusPrécis parmi: LocalBusiness, LegalService, MedicalBusiness, AccountingService, FinancialService, InsuranceAgency, RealEstateAgent, Restaurant, FoodEstablishment, Store, AutoRepair, Plumber, Electrician, HairSalon, SpaOrBeautySalon, ConstructionBusiness, HomeAndConstructionBusiness, MovingCompany, CleaningService, LandscapingBusiness, ITService, SoftwareApplication, EducationalOrganization, TutoringCenter, Dentist, Physician, Optician, Veterinary, HospitalDepartment, etc.]", "Organization"],
  "@id": "https://${domain}/#org",
  "name": "[nom officiel]",
  "description": "[description précise 2-3 phrases]",
  "url": "https://${domain}",
  [si trouvé: "telephone", "email", "address" avec PostalAddress complet, "geo" avec GeoCoordinates, "openingHours", "openingHoursSpecification", "priceRange", "currenciesAccepted", "paymentAccepted", "areaServed", "serviceArea", "sameAs" avec tous les profils sociaux trouvés, "hasOfferCatalog" avec tous les services]
}
</script>

<!-- 2. WebSite — TOUJOURS inclus -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","@id":"https://${domain}/#website","url":"https://${domain}","name":"[nom du site]","description":"[description courte]","publisher":{"@id":"https://${domain}/#org"}[si moteur de recherche interne: ,"potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"https://${domain}/?s={search_term_string}"},"query-input":"required name=search_term_string"}]}
</script>

<!-- 3. Personne(s) — une balise par personne identifiée, omettre si aucune -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","@id":"https://${domain}/#[slug-nom]","name":"[nom complet]","jobTitle":"[titre réel]","worksFor":{"@id":"https://${domain}/#org"}[si trouvé: ,"email","telephone","description","image","knowsAbout":["spécialité1","spécialité2"],"hasCredential":[{"@type":"EducationalOccupationalCredential","name":"[diplôme/certification]"}],"sameAs":["linkedin","twitter","autres profils"]]}
</script>

<!-- 4. Service(s) — un bloc par service/prestation identifié(e), omettre si aucun -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Service","name":"[nom du service]","description":"[description]","provider":{"@id":"https://${domain}/#org"}[si trouvé: ,"areaServed","serviceType","offers":{"@type":"Offer","price":"...","priceCurrency":"EUR"}]}
</script>

RÈGLES : JSON valide et minifié, @type le plus précis possible, valeurs réelles uniquement, omets tout champ sans données.`;

  const promptFaq = `Génère les blocs Schema.org contenu pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU :
${content}

GÉNÈRE LES BLOCS SUIVANTS (uniquement ceux pour lesquels tu as des données réelles) :

<!-- 1. FAQPage — questions/réponses adaptées au secteur d'activité -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
[Génère autant de Q&A que pertinent pour ce secteur (entre 6 et 12). Chaque entrée :
{"@type":"Question","name":"[question précise qu'un client poserait]","acceptedAnswer":{"@type":"Answer","text":"[réponse factuelle complète, 40-60 mots]"}}]
]}
</script>

<!-- 2. AggregateRating — uniquement si des avis/notes sont mentionnés dans le contenu -->
[Si avis trouvés, ajouter dans le bloc Organisation existant, ou créer un bloc séparé :
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"[même @type que l'Organisation]","@id":"https://${domain}/#org","aggregateRating":{"@type":"AggregateRating","ratingValue":"[note]","reviewCount":"[nombre]","bestRating":"5"}}
</script>]

<!-- 3. BreadcrumbList — pour les sites avec structure de navigation claire -->
[Si structure de navigation claire, générer :
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Accueil","item":"https://${domain}"}[, autres niveaux si pertinents]]}
</script>]

<!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->

RÈGLES : JSON valide et minifié, questions FAQPage réelles et pertinentes pour le secteur, omets les blocs 2 et 3 si pas de données, données réelles uniquement.`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        const system = "Tu es un expert Schema.org et structured data. Tu génères des balises JSON-LD complètes, précises et valides, en utilisant uniquement les données réelles fournies.";
        const [orgText, faqText] = await Promise.all([
          collectStream(KEY, { model: "claude-sonnet-4-6", max_tokens: 2500, system, messages: [{ role: "user", content: promptOrg }] }),
          collectStream(KEY, { model: "claude-sonnet-4-6", max_tokens: 2000, system, messages: [{ role: "user", content: promptFaq }] })
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
