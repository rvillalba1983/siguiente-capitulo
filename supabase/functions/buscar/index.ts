// Función "buscar": revisa AnimeFLV y Cuevana y actualiza el último capítulo
// disponible de cada serie del usuario que la llama. Nunca toca lo visto.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Serie = {
  id: string; title: string; cuevana: boolean; season: number | null;
  watch_tpl: string; alts: string[] | null; check_url: string; latest: number; up_to: number;
  summary: string | null; cover: string | null;
};

// ¿Abre la página del capítulo n con esta plantilla? Cuenta como fallo si
// responde con error o redirige a una página que ya no es la del capítulo.
async function enlaceVivo(tpl: string, n: number) {
  const url = tpl.replace("{n}", String(n));
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    await r.body?.cancel();
    if (!r.ok) return null;
    const fin = r.url || url;
    if (!new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(new URL(fin).pathname)) return null;
    // Si el dominio cambió por redirección, devolvemos la plantilla con el dominio nuevo.
    const was = new URL(url).host, now = new URL(fin).host;
    return was === now ? tpl : tpl.replace(was, now);
  } catch (_) { return null; }
}

function decode(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
const strip = (h: string) => decode(h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function leer(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { html: await r.text(), finalUrl: r.url || url };
}

function analizar(s: Pick<Serie, "check_url" | "cuevana" | "season">, html: string) {
  let max = 0, m: RegExpExecArray | null;
  if (s.cuevana) {
    const slug = (s.check_url.match(/\/serie\/([^/]+)/) || [])[1] || "";
    const re = new RegExp(`/serie/${slug}/episodio-${s.season || 1}x(\\d+)`, "g");
    while ((m = re.exec(html))) max = Math.max(max, +m[1]);
  } else {
    const slug = (s.check_url.match(/\/anime\/([^/]+)/) || [])[1] || "";
    const re = new RegExp(`/${slug}-episodio-(\\d+)-sub-espanol`, "g");
    while ((m = re.exec(html))) max = Math.max(max, +m[1]);
  }
  const og = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/) || [])[1] || null;
  let syn: string | null = null;
  const ec = html.match(/class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/);
  if (ec) syn = strip(ec[1]);
  if (!syn || syn.length < 60) {
    const md = (html.match(/name=["']description["'][^>]*content=["']([^"']+)/) || [])[1];
    if (md && md.length > 80 && !/Ver todos los episodios|Gratis en HD/i.test(md)) syn = decode(md);
  }
  if (syn && syn.length > 320) syn = syn.slice(0, 317).replace(/\s+\S*$/, "") + "…";
  return { max, cover: og, summary: syn && syn.length >= 60 ? syn : null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { ids?: string[]; test?: boolean } = {};
  try { body = await req.json(); } catch (_) { /* sin cuerpo */ }

  // Modo prueba: comprueba que las webs responden, sin tocar datos.
  if (body.test) {
    const pruebas = [
      { check_url: "https://animeflv.ar/anime/one-piece/", cuevana: false, season: null },
      { check_url: "https://cuevana3c.pro/serie/overgeared/temporada-1", cuevana: true, season: 1 },
    ];
    const out = [];
    for (const p of pruebas) {
      try { const { html, finalUrl } = await leer(p.check_url); const a = analizar(p, html); out.push({ url: p.check_url, finalUrl, ...a, summary: a.summary?.slice(0, 60) }); }
      catch (e) { out.push({ url: p.check_url, error: String(e) }); }
    }
    const enlaces: Record<string, string | null> = {};
    for (const t of [
      "https://animeflv.ar/one-piece-episodio-{n}-sub-espanol/",
      "https://www4.animeflv.net/ver/one-piece-{n}",
      "https://cuevana3c.pro/serie/overgeared/episodio-1x{n}",
      "https://cuevana3k.pro/serie/overgeared/episodio-1x{n}",
      "https://cuevana3r.pro/serie/overgeared/episodio-1x{n}",
    ]) enlaces[t] = await enlaceVivo(t, 2);
    return json({ test: out, enlaces });
  }

  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "Inicia sesión para buscar capítulos." }, 401);

  let q = sb.from("series").select("id,title,cuevana,season,watch_tpl,alts,check_url,latest,up_to,summary,cover");
  if (body.ids?.length) q = q.in("id", body.ids);
  const { data: series, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const news: string[] = [], failed: string[] = [], fixed: string[] = [], broken: string[] = [];
  const cola = [...(series as Serie[])];
  const trabajador = async () => {
    for (let s = cola.shift(); s; s = cola.shift()) {
      try {
        const { html, finalUrl } = await leer(s.check_url);
        const a = analizar(s, html);
        if (!a.max) { failed.push(s.title); continue; }
        const patch: Record<string, unknown> = { latest_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        if (a.max > (s.latest || 0)) { patch.latest = a.max; news.push(`${s.title} (${a.max - (s.latest || 0)})`); }
        if (!s.cover && a.cover) patch.cover = a.cover;
        if (!s.summary && a.summary) patch.summary = a.summary;
        const was = new URL(s.check_url).host, now = new URL(finalUrl).host;
        let primary = s.watch_tpl;
        if (s.cuevana && was !== now) {
          patch.check_url = s.check_url.replace(was, now);
          primary = s.watch_tpl.replace(was, now);
        }
        // Comprobar que la opción principal abre el siguiente capítulo; si no, probar las alternativas.
        const latest = Math.max(a.max, s.latest || 0);
        const n = Math.min(Math.max(1, (s.up_to || 0) + 1), latest);
        const alts = (s.alts || []).filter((t) => t && t !== primary);
        let ok = await enlaceVivo(primary, n);
        if (ok) primary = ok;
        else {
          for (const alt of alts) {
            const vivo = await enlaceVivo(alt, n);
            if (vivo) {
              patch.alts = [primary, ...alts.filter((t) => t !== alt)];
              primary = vivo; ok = vivo; fixed.push(`${s.title} → ${new URL(vivo.replace("{n}", "1")).host}`);
              break;
            }
          }
        }
        patch.watch_ok = !!ok;
        if (primary !== s.watch_tpl) patch.watch_tpl = primary;
        if (!ok) broken.push(s.title);
        await sb.from("series").update(patch).eq("id", s.id);
      } catch (_) { failed.push(s.title); }
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);

  const summary = (news.length ? `Nuevos: ${news.join(", ")}.` : "Sin capítulos nuevos.") +
    (fixed.length ? ` Cambiado a otra web: ${fixed.join(", ")}.` : "") +
    (broken.length ? ` Sin enlace que funcione: ${broken.join(", ")}.` : "") +
    (failed.length ? ` No se pudo leer: ${failed.join(", ")}.` : "");
  if (!body.ids?.length) {
    await sb.from("settings").upsert({ user_id: u.user.id, last_check: new Date().toISOString(), last_summary: summary });
  }
  return json({ news, failed, fixed, broken, summary });
});
