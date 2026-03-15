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
  const KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!KEY) return new Response(JSON.stringify({ error: "clé manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let domain, name, ctx, rawContent, lang;
  try { ({ domain, name, ctx, rawContent, lang } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const content = (rawContent || '').slice(0, 30000);
  const isEn = lang && lang !== 'fr';

  const systemPrompt = isEn
    ? "You are a Schema.org and structured data expert. You generate complete, valid and coherent JSON-LD files with @id references between blocks. You use only real data provided."
    : "Tu es un expert Schema.org et structured data. Tu génères des fichiers JSON-LD complets, valides et cohérents, avec des @id qui se référencent entre les blocs. Tu utilises uniquement les données réelles fournies.";

  const breadcrumbLabel = isEn ? 'Home' : 'Accueil';
  const commentGeo = isEn
    ? `<!-- GEO optimization by Geoptim.io - https://geoptim.io -->`
    : `<!-- Optimisation GEO par Geoptim.io - https://geoptim.io -->`;

  const langNote = isEn
    ? `Write all text values (name, description, question texts, answer texts) in English.`
    : `Écris toutes les valeurs textuelles (name, description, questions, réponses) dans la langue du site.`;

  const prompt = `${isEn ? 'Generate' : 'Génère'} un fichier schema-jsonld.html complet et optimal pour ce site. HTML brut uniquement, sans backtick.

${isEn ? 'DATA' : 'DONNÉES'} :
${ctx}

${isEn ? 'SITE CONTENT' : 'CONTENU DU SITE'} :
${content}

${isEn ? 'GENERATE ALL RELEVANT BLOCKS' : 'GÉNÈRE TOUS LES BLOCS PERTINENTS'} ci-dessous. ${isEn ? 'Use' : 'Utilise'} le même @id "https://${domain}/#org" ${isEn ? 'so blocks reference each other' : 'pour que les blocs se référencent entre eux'}.

${langNote}

<!-- ${name} - Schema.org JSON-LD | Geoptim.io | ${isEn ? 'Paste in <head> via RankMath, Yoast or Insert Headers & Footers' : 'Coller dans <head> via RankMath, Yoast ou Insert Headers & Footers'} -->

<!-- ═══ 1. ${isEn ? 'ORGANIZATION / LOCAL BUSINESS - always included' : 'ORGANISATION / LOCAL BUSINESS - toujours inclus'} ═══ -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["[${isEn ? 'PreciseType' : 'TypePrécis'}]", "Organization"],
  "@id": "https://${domain}/#org",
  "name": "...",
  "description": "...",
  "url": "https://${domain}"
  [+ ${isEn ? 'all fields found' : 'tous les champs trouvés'} : telephone, email, address (PostalAddress ${isEn ? 'full' : 'complet'}), geo (GeoCoordinates), openingHours, openingHoursSpecification, priceRange, areaServed, sameAs (${isEn ? 'all social profiles' : 'tous profils sociaux'}), hasOfferCatalog (${isEn ? 'all services' : 'tous services'})]
}
</script>
${isEn ? 'Available precise types' : 'Types précis disponibles'} : LocalBusiness, LegalService, Notary, Attorney, MedicalBusiness, Physician, Dentist, Optician, Veterinary, AccountingService, FinancialService, InsuranceAgency, RealEstateAgent, Restaurant, CafeOrCoffeeShop, Bakery, FoodEstablishment, Store, ClothingStore, BookStore, AutoRepair, AutoDealer, Plumber, Electrician, HVACBusiness, Locksmith, Painter, Roofer, ConstructionBusiness, MovingCompany, CleaningService, LandscapingBusiness, HairSalon, SpaOrBeautySalon, NailSalon, GymOrHealthClub, SportsActivityLocation, ITService, SoftwareCompany, EducationalOrganization, TutoringCenter, DayCare, etc.

<!-- ═══ 2. WEBSITE - ${isEn ? 'always included' : 'toujours inclus'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","@id":"https://${domain}/#website","url":"https://${domain}","name":"[${isEn ? 'name' : 'nom'}]","description":"[description]","publisher":{"@id":"https://${domain}/#org"}}
</script>

<!-- ═══ 3. ${isEn ? 'PERSON(S) - one tag per identified person, omit if none' : 'PERSONNE(S) - une balise par personne identifiée, omettre si aucune'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","@id":"https://${domain}/#[slug]","name":"...","jobTitle":"...","worksFor":{"@id":"https://${domain}/#org"}[+ email, telephone, description, knowsAbout, hasCredential, sameAs ${isEn ? 'if found' : 'si trouvés'}]}
</script>

<!-- ═══ 4. ${isEn ? 'SERVICE(S) - one block per identified service, omit if none' : 'SERVICE(S) - un bloc par prestation identifiée, omettre si aucune'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Service","name":"...","description":"...","provider":{"@id":"https://${domain}/#org"}[+ serviceType, areaServed, offers ${isEn ? 'with price/priceCurrency if found' : 'avec price/priceCurrency si trouvés'}]}
</script>

<!-- ═══ 5. FAQPAGE - ${isEn ? 'sector-adapted questions, omit if insufficient content' : 'questions adaptées au secteur, omettre si contenu insuffisant'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
[${isEn ? 'Between 6 and 12 Q&A depending on site richness. Each entry' : 'Entre 6 et 12 Q&A selon la richesse du site. Chaque entrée'} :
{"@type":"Question","name":"[${isEn ? 'long-tail question' : 'question longue traîne'}]","acceptedAnswer":{"@type":"Answer","text":"[${isEn ? 'answer 40-60 words' : 'réponse 40-60 mots'}]"}}]
]}
</script>

<!-- ═══ 6. AGGREGATERATING - ${isEn ? 'only if reviews/ratings found in content' : 'uniquement si avis/notes trouvés dans le contenu'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"[${isEn ? 'same type as Organization' : 'même type que l\'Organisation'}]","@id":"https://${domain}/#org","aggregateRating":{"@type":"AggregateRating","ratingValue":"...","reviewCount":"...","bestRating":"5"}}
</script>

<!-- ═══ 7. BREADCRUMBLIST - ${isEn ? 'if multi-level navigation identified' : 'si navigation multi-niveaux identifiée'} ═══ -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"${breadcrumbLabel}","item":"https://${domain}"}[, ${isEn ? 'other levels if relevant' : 'autres niveaux si pertinents'}]]}
</script>

${commentGeo}

${isEn ? 'RULES' : 'RÈGLES'} :
- ${isEn ? 'Valid and minified JSON (except Organization block which can be indented)' : 'JSON valide et minifié (sauf le bloc Organisation qui peut être indenté pour lisibilité)'}
- ${isEn ? 'Most precise @type possible' : '@type le plus précis possible'}
- ${isEn ? 'Real values only, no invention' : 'Valeurs réelles uniquement, aucune invention'}
- ${isEn ? 'Omit fields without data and entire blocks without data' : 'Omets les champs sans données et les blocs entiers sans données'}
- ${isEn ? '@ids reference each other for maximum coherence' : 'Les @id se référencent entre eux pour une cohérence maximale'}`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system: systemPrompt,
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
