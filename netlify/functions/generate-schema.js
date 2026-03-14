// Retry helper — jusqu'à 3 tentatives si Anthropic renvoie overloaded_error
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

    const prompt = `Tu es un expert Schema.org et GEO senior. Génère un fichier HTML avec des blocs JSON-LD Schema.org complets et professionnels pour ce site.

━━━ DONNÉES EXTRAITES (structurées) ━━━
${ctx}

━━━ CONTENU BRUT RÉCUPÉRÉ DU SITE ━━━
${(rawContent || '').slice(0, 5000)}

━━━ RÈGLES ABSOLUES ━━━
1. Utilise le contenu brut pour compléter les données manquantes dans les données extraites.
2. @type : choisis le type Schema.org LE PLUS PRÉCIS possible pour le secteur réel.
   Exemples : LegalService, Attorney, MedicalBusiness, LocalBusiness, ProfessionalService, SoftwareApplication, Store, Restaurant...
3. Toutes les valeurs doivent être RÉELLES — jamais de placeholder.
4. Si une donnée est vraiment absente → omets le champ (ne pas l'inclure du tout).
5. sameAs : uniquement les vrais URLs de réseaux sociaux trouvés.
6. hasOfferCatalog : uniquement les vraies offres/services réels avec descriptions précises.
7. FAQPage : questions formulées comme de VRAIES requêtes clients, réponses de 3-4 phrases denses avec vraies données.

━━━ STRUCTURE À GÉNÉRER ━━━

BLOC 1 — Organisation principale :
Type : @type adapté + Organization en tableau
Champs obligatoires : @context, @type, @id, name, description (phrase précise), url
Champs si disponibles : telephone, email, address (PostalAddress), geo, openingHours, areaServed, priceRange, serviceType, knowsAbout, sameAs, hasOfferCatalog

BLOC 2 — Person (un bloc par personne réelle trouvée) :
@context, @type, @id, name, jobTitle, description, worksFor, knowsAbout, sameAs

BLOC 3 — FAQPage :
8 questions sectorielles précises avec réponses de 3-4 phrases utilisant les VRAIES données du site.
Questions formulées comme des recherches Google/ChatGPT réelles de clients.

FORMAT DE SORTIE OBLIGATOIRE :
<!--
  ════════════════════════════════════════
  [NOM DU SITE EN MAJUSCULES] — Schema.org JSON-LD
  À insérer dans le <head> de chaque page via RankMath / Yoast / Insert Headers & Footers
  Généré par Geoptim.io — https://geoptim.io
  ════════════════════════════════════════
-->

<!-- ① ORGANISATION (toutes les pages) -->
<script type="application/ld+json">
{ ... }
</script>

<!-- ② PERSONNE (une par membre d'équipe trouvé) -->
<script type="application/ld+json">
{ ... }
</script>

<!-- ③ FAQ PAGE (uniquement sur la page FAQ) -->
<script type="application/ld+json">
{ ... }
</script>

<!--
  INSTRUCTIONS D'INTÉGRATION :
  Option A — Extension SEO (RankMath / Yoast) : coller chaque bloc dans "Schema personnalisé"
  Option B — functions.php WordPress :
    add_action('wp_head', function() {
      echo '[bloc organisation]'; // toutes les pages
      if (is_page('faq')) echo '[bloc FAQ]'; // page FAQ uniquement
    });
  Option C — Insert Headers & Footers plugin : coller dans "Scripts in Header"
-->
<!-- Optimisation GEO par Geoptim.io — https://geoptim.io -->

Réponds UNIQUEMENT avec le HTML brut, sans markdown ni backtick.`;

    const data = await callAnthropic(KEY, {
      model: "claude-opus-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }]
    }, 25000);

    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(b => b.text || "").join("").trim()
      .replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: text })
    };

  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
