const dns = require('node:dns/promises');
const net = require('node:net');

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const p = address.split('.').map(Number);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0) return false;
    return true;
  }
  if (version === 6) {
    const v = address.toLowerCase();
    return v.startsWith('2') || v.startsWith('3');
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const { server, username, password, action = '', extra = {} } = req.body || {};
    if (typeof server !== 'string' || typeof username !== 'string' || typeof password !== 'string' ||
        !server.trim() || !username.trim() || !password) {
      return res.status(400).json({ error: 'Informations de connexion manquantes.' });
    }
    if (username.length > 256 || password.length > 256 || server.length > 2048) {
      return res.status(400).json({ error: 'Informations trop longues.' });
    }

    const base = new URL(server.trim());
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.search || base.hash) {
      return res.status(400).json({ error: 'Adresse serveur invalide. Utilisez une adresse HTTP(S) sans identifiants intégrés.' });
    }
    if (base.hostname === 'localhost' || base.hostname.endsWith('.local') ||
        base.hostname.endsWith('.internal') || base.hostname.endsWith('.localhost')) {
      return res.status(400).json({ error: 'Cette adresse serveur n’est pas autorisée.' });
    }

    const literal = net.isIP(base.hostname);
    const addresses = literal
      ? [{ address: base.hostname }]
      : await dns.lookup(base.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(x => !isPublicAddress(x.address))) {
      return res.status(400).json({ error: 'Le serveur doit avoir une adresse IP publique.' });
    }

    const allowedActions = new Set([
      '', 'xmltv', 'get_live_categories', 'get_live_streams',
      'get_vod_categories', 'get_vod_streams',
      'get_series_categories', 'get_series'
    ]);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ error: 'Action IPTV non autorisée.' });
    }

    const isXmltv = action === 'xmltv';
    const target = new URL(isXmltv ? 'xmltv.php' : 'player_api.php', base.href.endsWith('/') ? base.href : base.href + '/');
    target.searchParams.set('username', username);
    target.searchParams.set('password', password);
    if (action && !isXmltv) target.searchParams.set('action', action);
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(extra)) {
        if (/^[a-zA-Z0-9_]{1,40}$/.test(key) && ['category_id', 'series_id', 'vod_id'].includes(key)) {
          target.searchParams.set(key, String(value));
        }
      }
    }

    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'IPTVSmartersPro/1.1.1',
        'Connection': 'keep-alive'
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    });
    if (!upstream.ok) {
      let detail = '';
      try { detail = (await upstream.text()).slice(0, 700).replace(/[\\r\\n\\t]+/g, ' ').replace(/https?:\\/\\/[^\\s"'<>]+/g, '[adresse masquée]'); } catch {}
      const serverHint = upstream.headers.get('server') || '';
      const requestHint = upstream.headers.get('via') || '';
      return res.status(502).json({
        error: 'Le fournisseur IPTV a répondu avec HTTP ' + upstream.status + '.',
        diagnostic: detail || 'Aucun détail fourni par le serveur.',
        server: serverHint,
        via: requestHint
      });
    }
    const body = await upstream.text();
    if (body.length > (isXmltv ? 30 : 12) * 1024 * 1024) {
      return res.status(502).json({ error: 'Réponse du fournisseur trop volumineuse.' });
    }
    if (isXmltv) {
      if (!body.includes('<tv') && !body.includes('<!DOCTYPE tv')) {
        return res.status(502).json({ error: 'Le fournisseur n’a pas renvoyé de guide XMLTV valide.' });
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(body);
    }
    let data;
    try { data = JSON.parse(body); }
    catch { return res.status(502).json({ error: 'Réponse non JSON du fournisseur IPTV.' }); }
    return res.status(200).json(data);
  } catch (error) {
    const message = error && error.name === 'TimeoutError'
      ? 'Le serveur IPTV met trop de temps à répondre.'
      : 'Connexion au serveur impossible. Vérifiez son adresse et sa disponibilité.';
    return res.status(502).json({ error: message });
  }
};
