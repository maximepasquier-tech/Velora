const http = require('node:http');
const https = require('node:https');

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: 'GET',
      agent: false,
      headers: {
        'Host': url.host,
        'User-Agent': 'IPTVSmartersPro/1.1.1',
        'Accept': 'application/json, text/plain, */*',
        'Connection': 'close'
      }
    }, (response) => {
      const status = response.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 3) return reject(new Error('Trop de redirections du serveur IPTV.'));
        const next = new URL(response.headers.location, url);
        if (next.hostname !== url.hostname || !['http:', 'https:'].includes(next.protocol)) {
          return reject(new Error('Le serveur IPTV redirige vers un autre domaine.'));
        }
        return resolve(requestText(next, redirects + 1));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 30 * 1024 * 1024) {
          req.destroy(new Error('Réponse du fournisseur trop volumineuse.'));
        }
      });
      response.on('end', () => resolve({ status, headers: response.headers, body }));
    });
    req.setTimeout(18000, () => req.destroy(new Error('Délai de connexion dépassé.')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  try {
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { server, username, password, action = '', extra = {} } = input;
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
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host === '127.0.0.1' || host === '::1' ||
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

    const upstream = await requestText(target);
    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(502).json({
        error: 'Le fournisseur IPTV a répondu avec HTTP ' + upstream.status + '.',
        diagnostic: upstream.body.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 450),
        upstreamServer: String(upstream.headers.server || '').slice(0, 100)
      });
    }

    if (upstream.body.length > (isXmltv ? 30 : 12) * 1024 * 1024) {
      return res.status(502).json({ error: 'Réponse du fournisseur trop volumineuse.' });
    }
    if (isXmltv) {
      if (!upstream.body.includes('<tv') && !upstream.body.includes('<!DOCTYPE tv')) {
        return res.status(502).json({ error: 'Réponse XMLTV invalide.' });
      }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(upstream.body);
    }

    let data;
    try {
      data = JSON.parse(upstream.body);
    } catch {
      return res.status(502).json({
        error: 'Le fournisseur a renvoyé une réponse non JSON.',
        diagnostic: upstream.body.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 300)
      });
    }
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({
      error: error && error.message ? String(error.message).slice(0, 300) : 'Erreur interne du relais VELORA.'
    });
  }
};
