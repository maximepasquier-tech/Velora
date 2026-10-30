module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const server = body.server;
    const username = body.username;
    const password = body.password;
    const action = body.action || '';
    const extra = body.extra || {};

    if (typeof server !== 'string' || typeof username !== 'string' ||
        typeof password !== 'string' || !server.trim() || !username.trim() || !password) {
      return res.status(400).json({ error: 'Informations de connexion manquantes.' });
    }
    if (server.length > 2048 || username.length > 256 || password.length > 256) {
      return res.status(400).json({ error: 'Informations trop longues.' });
    }

    const base = new URL(server.trim());
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash) {
      return res.status(400).json({ error: 'Adresse serveur HTTP(S) invalide.' });
    }
    const host = base.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal') ||
        host === '127.0.0.1' || host === '::1' ||
        /^10\\./.test(host) || /^192\\.168\\./.test(host) ||
        /^172\\.(1[6-9]|2[0-9]|3[01])\\./.test(host)) {
      return res.status(400).json({ error: 'Adresse serveur non autorisée.' });
    }

    const allowed = ['', 'get_live_categories', 'get_live_streams',
      'get_vod_categories', 'get_vod_streams', 'get_series_categories',
      'get_series', 'xmltv'];
    if (!allowed.includes(action)) {
      return res.status(400).json({ error: 'Action IPTV non autorisée.' });
    }

    const isXmltv = action === 'xmltv';
    const root = base.href.endsWith('/') ? base.href : base.href + '/';
    const target = new URL(isXmltv ? 'xmltv.php' : 'player_api.php', root);
    target.searchParams.set('username', username);
    target.searchParams.set('password', password);
    if (action && !isXmltv) target.searchParams.set('action', action);

    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const key of ['category_id', 'series_id', 'vod_id']) {
        if (extra[key] !== undefined && extra[key] !== null) {
          target.searchParams.set(key, String(extra[key]));
        }
      }
    }

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'IPTVSmartersPro/1.1.1'
      },
      redirect: 'follow'
    });

    const responseText = await upstream.text();
    if (!upstream.ok) {
      const detail = responseText.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 500);
      return res.status(502).json({
        error: 'Le fournisseur IPTV a répondu avec HTTP ' + upstream.status + '.',
        diagnostic: detail || 'Le fournisseur n’a fourni aucun détail.'
      });
    }

    if (responseText.length > (isXmltv ? 30 : 12) * 1024 * 1024) {
      return res.status(502).json({ error: 'Réponse du fournisseur trop volumineuse.' });
    }

    if (isXmltv) {
      if (!responseText.includes('<tv') && !responseText.includes('<!DOCTYPE tv')) {
        return res.status(502).json({ error: 'Réponse XMLTV invalide.' });
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(responseText);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        error: 'Le fournisseur a renvoyé une réponse non JSON.',
        diagnostic: responseText.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 300)
      });
    }
    return res.status(200).json(data);
  } catch (error) {
    const message = error && error.name === 'TimeoutError'
      ? 'Le serveur IPTV met trop de temps à répondre.'
      : (error && error.message ? String(error.message).slice(0, 300) : 'Erreur interne du relais VELORA.');
    return res.status(502).json({ error: message });
  }
};
