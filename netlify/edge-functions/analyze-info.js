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
  if (!KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  function stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractLinks(html, base) {
    const links = new Set();
    const re = /href=["']([^"'#]+?)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      let href = m[1].split('#')[0].split('?')[0].trim();
      if (!href || href === '/') continue;
      try {
        const abs = new URL(href, base);
        if (abs.origin !== new URL(base).origin) continue;
        href = abs.pathname;
      } catch { continue; }
      if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|mp[34]|woff2?|ttf|eot)$/i.test(href)) continue;
      if (/\/(cdn-cgi|wp-content|wp-includes|wp-admin|assets|static|_next|\.well-known|feed|rss)\//i.test(href)) continue;
      // Skip alternate language versions and blog pages
      if (/^\/(en|es|de|it|pt|nl|ar|zh|ja|ko)(\/|$)/i.test(href)) continue;
      if (/\/blog(\/|$)/i.test(href)) continue;
      if (href === '/') continue;
      links.add(href);
    }
    return [...links];
  }

  async function fetchRaw(u, ms) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoptimBot/1.0; +https://geoptim.io)' },
        signal: AbortSignal.timeout(ms)
      });
      if (!r.ok) return '';
      return await r.text();
    } catch(e) { return ''; }
  }

  let url;
  try { ({ url } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const domain = url.replace(/https?:\/\//,'').replace(/\/.*$/,'');
  const base = 'https://' + domain;

  const homeHtml = await fetchRaw(base + '/', 5000);
  const homeText = stripHtml(homeHtml);

  // Depth-1: discover links from homepage
  const depth1Links = extractLinks(homeHtml, base);
  const allLinks = new Set(depth1Links);

  // Fetch depth-1 pages (up to 15) and collect their HTML for depth-2 discovery
  const depth1Pages = depth1Links.slice(0, 15);
  const depth1Results = await Promise.all(
    depth1Pages.map(async (path) => {
      const html = await fetchRaw(base + path, 3000);
      if (!html) return null;
      const text = stripHtml(html);
      if (!text || text.length < 50) return null;
      // Discover depth-2 links from this page
      for (const link of extractLinks(html, base)) allLinks.add(link);
      return { path, text };
    })
  );

  // Depth-2: fetch newly discovered pages not already fetched
  const fetchedPaths = new Set(depth1Pages);
  fetchedPaths.add('/');
  const depth2Links = [...allLinks].filter(p => !fetchedPaths.has(p)).slice(0, 10);
  const depth2Results = await Promise.all(
    depth2Links.map(async (path) => {
      const html = await fetchRaw(base + path, 3000);
      const text = stripHtml(html);
      if (!text || text.length < 50) return null;
      return { path, text };
    })
  );

  const sections = [
    homeText ? '=== ACCUEIL (/) ===\n' + homeText : ''
  ];

  for (const page of [...depth1Results, ...depth2Results]) {
    if (!page) continue;
    sections.push('=== PAGE ' + page.path + ' ===\n' + page.text);
  }

  const rawContent = sections.filter(Boolean).join('\n\n').slice(0, 50000);

  const prompt = `Tu es un expert en extraction d'information business. Extrais toutes les données réelles de ce site de façon exhaustive.

URL : ${url}

CONTENU RÉCUPÉRÉ (plusieurs pages) :
---
${rawContent.slice(0, 24000)}
---

RÈGLES STRICTES :
- N'utilise QUE ce qui est EXPLICITEMENT présent dans le contenu. Jamais de devinette.
- Téléphone / email : copie les valeurs EXACTES telles qu'affichées.
- Location : uniquement depuis adresse postale ou footer ou mentions légales.
- team : liste TOUS les noms et rôles trouvés (avocats, associés, collaborateurs, fondateurs, dirigeants).
- services : TOUS les domaines d'expertise mentionnés explicitement, sans limite de nombre.
- offers : TOUTES les offres et prestations identifiées, avec descriptions si disponibles.
- tone : "vouvoiement" si le site utilise vous/votre, "tutoiement" si tu/te/ton.
- lang : code ISO 639-1 de la langue principale du contenu du site (ex: "fr", "en", "es", "de", "it", "pt"). Détecte depuis le contenu réel, pas depuis l'URL.
- problemsSolved : 5 vraies douleurs clients déduites des services réels.
- sectorKeywords : 8 requêtes longue traîne réelles que les clients taperaient.
- useCases : 6 situations concrètes liées aux vrais services.
- Si un champ est introuvable → null (pas de valeur inventée).

Réponds UNIQUEMENT avec ce JSON sans markdown :
{
  "siteName": "...",
  "siteDescription": "une phrase précise sur ce que fait réellement ce site",
  "siteType": "type précis (ex: Cabinet d'avocats, Agence SEO, Startup SaaS...)",
  "lang": "fr",
  "siteInfo": {
    "mainActivity": "description complète de l'activité principale",
    "location": "ville + région depuis adresse ou null",
    "city": "ville ou null",
    "region": "région ou null",
    "services": ["domaine 1","domaine 2","domaine 3","domaine 4","domaine 5","domaine 6"],
    "contact": "téléphone et/ou email EXACTS ou null",
    "team": [{ "name": "Prénom Nom", "role": "titre exact", "specialties": ["spécialité 1","spécialité 2"] }],
    "socialLinks": ["url linkedin","url twitter","etc."],
    "clientTypes": ["type client 1","type client 2","type client 3"],
    "offers": ["offre 1","offre 2","offre 3"],
    "problemsSolved": ["douleur 1","douleur 2","douleur 3","douleur 4","douleur 5"],
    "sectorKeywords": ["requête 1","requête 2","requête 3","requête 4","requête 5","requête 6","requête 7","requête 8"],
    "useCases": ["situation 1","situation 2","situation 3","situation 4","situation 5","situation 6"],
    "entityType": "cabinet ou startup ou agence ou boutique ou clinique ou entreprise",
    "tone": "vouvoiement",
    "blogUrl": "url ou null",
    "extraUrls": { "clientSpace": "url ou null" }
  }
}`;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of streamAnthropic(KEY, {
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }]
        })) {
          ctrl.enqueue(enc.encode(chunk));
        }
        ctrl.enqueue(enc.encode('\n__RC__' + JSON.stringify(rawContent)));
        ctrl.close();
      } catch(err) {
        ctrl.enqueue(enc.encode(`\n__GEOPTIM_ERROR__${err.message}`));
        ctrl.close();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
