const ALLOWED_ORIGIN = "https://velora-ebon-beta.vercel.app";
const UPSTREAM = "http://shanoto.space/";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
  "Cache-Control": "no-store"
};

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (origin !== ALLOWED_ORIGIN) {
      return Response.json({ error: "Origine non autorisée." }, { status: 403, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Utilisez POST." }, { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { server, username, password, action = "", extra = {} } = body || {};

      let parsedServer;
      try {
        parsedServer = new URL(server);
      } catch {
        return Response.json({ error: "Adresse serveur invalide." }, { status: 400, headers: corsHeaders });
      }

      if (parsedServer.hostname.toLowerCase() !== "shanoto.space" ||
          typeof username !== "string" || typeof password !== "string" ||
          !username || !password) {
        return Response.json({ error: "Paramètres de connexion invalides." }, { status: 400, headers: corsHeaders });
      }

      const allowedActions = [
        "", "get_live_categories", "get_live_streams",
        "get_vod_categories", "get_vod_streams",
        "get_series_categories", "get_series"
      ];

      if (!allowedActions.includes(action)) {
        return Response.json({ error: "Action non autorisée." }, { status: 400, headers: corsHeaders });
      }

      const url = new URL("player_api.php", UPSTREAM);
      url.searchParams.set("username", username);
      url.searchParams.set("password", password);
      if (action) url.searchParams.set("action", action);

      for (const key of ["category_id", "series_id", "vod_id"]) {
        if (extra && extra[key] != null) url.searchParams.set(key, String(extra[key]));
      }

      const upstream = await fetch(url.toString(), {
        headers: { "Accept": "application/json, text/plain, */*" },
        signal: AbortSignal.timeout(20000)
      });

      const data = await upstream.text();
      return new Response(data, {
        status: upstream.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
      });
    } catch (error) {
      return Response.json({
        error: "Erreur passerelle Cloudflare : " + String(error.message || error).slice(0, 200)
      }, { status: 502, headers: corsHeaders });
    }
  }
};
