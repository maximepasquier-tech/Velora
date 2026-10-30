const ALLOWED_ORIGIN = "https://velora-ebon-beta.vercel.app";
const UPSTREAM = "http://shanoto.space/";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
  "Cache-Control": "no-store"
};

function jsonError(message, status = 502, details = {}) {
  return Response.json({ error: message, ...details }, {
    status,
    headers: corsHeaders
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (origin !== ALLOWED_ORIGIN) {
      return jsonError("Origine non autorisée.", 403);
    }

    if (request.method !== "POST") {
      return jsonError("Utilisez POST.", 405);
    }

    let username = "";
    let password = "";

    try {
      const body = await request.json();
      const { server, action = "", extra = {} } = body || {};
      username = typeof body?.username === "string" ? body.username : "";
      password = typeof body?.password === "string" ? body.password : "";

      let parsedServer;
      try {
        parsedServer = new URL(server);
      } catch {
        return jsonError("Adresse serveur invalide.", 400);
      }

      if (
        parsedServer.hostname.toLowerCase() !== "shanoto.space" ||
        !username ||
        !password
      ) {
        return jsonError("Paramètres de connexion invalides.", 400);
      }

      const allowedActions = [
        "",
        "get_live_categories",
        "get_live_streams",
        "get_vod_categories",
        "get_vod_streams",
        "get_series_categories",
        "get_series"
      ];

      if (!allowedActions.includes(action)) {
        return jsonError("Action non autorisée.", 400);
      }

      const url = new URL("player_api.php", UPSTREAM);
      url.searchParams.set("username", username);
      url.searchParams.set("password", password);
      if (action) url.searchParams.set("action", action);

      for (const key of ["category_id", "series_id", "vod_id"]) {
        if (extra && extra[key] != null) {
          url.searchParams.set(key, String(extra[key]));
        }
      }

      const upstream = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json, text/plain, */*"
        },
        signal: AbortSignal.timeout(20000)
      });

      const data = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "inconnu";

      if (!upstream.ok) {
        const preview = data
          .slice(0, 300)
          .replaceAll(username, "[identifiant masqué]")
          .replaceAll(password, "[mot de passe masqué]");

        return jsonError(
          "Le serveur IPTV a répondu avec une erreur HTTP " +
            upstream.status + ".",
          502,
          {
            upstreamStatus: upstream.status,
            upstreamContentType: contentType,
            upstreamPreview: preview
          }
        );
      }

      try {
        JSON.parse(data);
      } catch {
        const preview = data
          .slice(0, 300)
          .replaceAll(username, "[identifiant masqué]")
          .replaceAll(password, "[mot de passe masqué]");

        return jsonError(
          "Le serveur IPTV a répondu, mais sa réponse n'est pas du JSON valide.",
          502,
          {
            upstreamStatus: upstream.status,
            upstreamContentType: contentType,
            upstreamPreview: preview
          }
        );
      }

      return new Response(data, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    } catch (error) {
      return jsonError(
        "Erreur de communication avec le serveur IPTV : " +
          String(error?.message || error).slice(0, 200),
        502
      );
    }
  }
};
