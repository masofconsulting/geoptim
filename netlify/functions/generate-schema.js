// Netlify v2 — streaming, appel unique (cohérence cross-schemas)
async function* streamAnthropic(KEY, body) {
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
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
        if (ev.type === 'error') throw new Error(ev.error?.message || 'Erreur stream Anthropic');
      }
    }
    return;
  }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return new Response(JSON.stringify({ error: "clé manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let domain, name, ctx, rawContent;
  try { ({ domain, name, ctx, rawContent } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const content = (rawContent || '').slice(0, 3000);

  const prompt = `Génère un fichier schema-jsonld.html complet et optimal pour ce site. HTML brut uniquement, sans backtick.

DONNÉES :
${ctx}

CONTENU DU SITE :
${content}

GÉNÈRE TOUS LES BLOCS PERTINENTS ci-dessous. Utilise le même @id "https://${domain}/#org" pour que les blocs se référencent entre eux.

<!-- ${name} — Schema.org JSON-LD | Geoptim.io | Coller dans <head> via RankMath, Yoast ou Insert Headers & Footers -->

<!-- ═══ 1. ORGANISATION / LOCAL BUSINESS — toujours inclus ═══ -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["[TypePrécis]", "Organization"],
  "@id": "https://${domain}/#org",
  "name": "...",
  "description": "...",
  "url": "https://${domain}"
  [+ tous les champs trouvés : telephone, email, address (PostalAddress complet), geo (GeoCoordinates), openingHours, openingHoursSpecification, priceRange, areaServed, sameAs (tous profils sociaux), hasOfferCatalog (tous services)]
}
</script>
Types précis disponibles : LocalBusiness, LegalService, Notary, Attorney, MedicalBusiness, Physician, Dentist, Optician, Veterinary, AccountingService, FinancialService, InsuranceAgency, RealEstateAgent, Restaurant, CafeOrCoffeeShop, Bakery, FoodEstablishment, Store, ClothingStore, BookStore, AutoRepair, AutoDealer, Plumber, Electrician, HVACBusiness, Locksmith, Painter, Roofer, ConstructionBusiness, MovingCompany, CleaningService, LandscapingBusiness, HairSalon, SpaOrBeautySalon, NailSalon, GymOrHealthClub, SportsActivityLocation, ITService, SoftwareCompany, EducationalOrganization, TutoringCenter, DayCare, etc.

<!-- ═══ 2. WEBSITE — toujours inclus ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","@id":"https://${domain}/#website","url":"https://${domain}","name":"[nom]","description":"[description]","publisher":{"@id":"https://${domain}/#org"}}
</script>

<!-- ═══ 3. PERSONNE(S) — une balise par personne identifiée, omettre si aucune ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","@id":"https://${domain}/#[slug]","name":"...","jobTitle":"...","worksFor":{"@id":"https://${domain}/#org"}[+ email, telephone, description, knowsAbout, hasCredential, sameAs si trouvés]}
</script>

<!-- ═══ 4. SERVICE(S) — un bloc par prestation identifiée, omettre si aucune ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Service","name":"...","description":"...","provider":{"@id":"https://${domain}/#org"}[+ serviceType, areaServed, offers avec price/priceCurrency si trouvés]}
</script>

<!-- ═══ 5. FAQPAGE — questions adaptées au secteur, omettre si contenu insuffisant ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
[Entre 6 et 12 Q&A selon la richesse du site. Chaque entrée :
{"@type":"Question","name":"[question longue traîne]","acceptedAnswer":{"@type":"Answer","text":"[réponse 40-60 mots]"}}]
]}
</script>

<!-- ═══ 6. AGGREGATERATING — uniquement si avis/notes trouvés dans le contenu ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"[même type que l'Organisation]","@id":"https://${domain}/#org","aggregateRating":{"@type":"AggregateRating","ratingValue":"...","reviewCount":"...","bestRating":"5"}}
</script>

<!-- ═══ 7. BREADCRUMBLIST — si navigation multi-niveaux identifiée ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Accueil","item":"https://${domain}"}[, autres niveaux si pertinents]]}
</script>

<!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->

RÈGLES :
- JSON valide et minifié (sauf le bloc Organisation qui peut être indenté pour lisibilité)
- @type le plus précis possible
- Valeurs réelles uniquement, aucune invention
- Omets les champs sans données et les blocs entiers sans données
- Les @id se référencent entre eux pour une cohérence maximale`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: "Tu es un expert Schema.org et structured data. Tu génères des fichiers JSON-LD complets, valides et cohérents, avec des @id qui se référencent entre les blocs. Tu utilises uniquement les données réelles fournies.",
          messages: [{ role: "user", content: prompt }]
        })) {
          ctrl.enqueue(enc.encode(chunk));
        }
        ctrl.close();
      } catch (err) {
        ctrl.enqueue(enc.encode(`\n__GEOPTIM_ERROR__${err.message}`));
        ctrl.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
