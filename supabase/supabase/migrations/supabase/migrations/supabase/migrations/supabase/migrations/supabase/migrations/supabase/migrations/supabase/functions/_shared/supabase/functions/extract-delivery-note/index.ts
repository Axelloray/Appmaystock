// Reçoit la photo d'un bon de livraison, demande à Claude d'en extraire les
// lignes produit/quantité/unité, et renvoie un JSON prêt pour l'écran de
// relecture côté client. La clé Anthropic reste côté serveur (secret Supabase).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BASE64_LENGTH = 8_000_000; // ~6MB decoded, well under Anthropic's limit

const EXTRACTION_PROMPT = `Voici une photo d'un bon de livraison (BL) pour une boulangerie. Extrait la liste des produits/articles livrés avec leur quantité et leur unité si visible. Réponds UNIQUEMENT avec un tableau JSON valide, sans aucun texte avant ou après, sans balises markdown, au format exact : [{"produit":"nom","quantite":number,"unite":"kg|g|L|mL|unité|sac|carton|botte|caisse|boîte|pièce|plaque"}]. Si l'unité n'est pas claire, utilise "unité". Ignore les lignes de totaux, TVA, ou informations qui ne sont pas des produits.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not configured");
    return json({ error: "Service indisponible" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "Session invalide" }, 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", userData.user.id)
    .single();

  if (
    profileError || !profile ||
    !["trialing", "active"].includes(profile.subscription_status)
  ) {
    return json({ error: "Abonnement inactif" }, 403);
  }

  let payload: { image?: string; mediaType?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corps de requête invalide" }, 400);
  }

  const { image, mediaType } = payload;
  if (!image || typeof image !== "string") {
    return json({ error: "Le champ image (base64) est requis" }, 400);
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return json({ error: "Image trop volumineuse" }, 413);
  }

  const resolvedMediaType = ALLOWED_MEDIA_TYPES.includes(mediaType ?? "")
    ? mediaType!
    : "image/jpeg";
  const base64 = image.includes(",") ? image.split(",")[1] : image;

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: resolvedMediaType, data: base64 },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        }],
      }),
    });
  } catch (err) {
    console.error("Anthropic API request failed", err);
    return json({ error: "Échec de l'analyse du bon de livraison" }, 502);
  }

  if (!anthropicRes.ok) {
    console.error("Anthropic API error", anthropicRes.status, await anthropicRes.text());
    return json({ error: "Échec de l'analyse du bon de livraison" }, 502);
  }

  const anthropicJson = await anthropicRes.json();
  const rawText: string = anthropicJson?.content?.[0]?.text ?? "";
  const cleaned = rawText.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");

  let items: unknown;
  try {
    items = JSON.parse(cleaned);
  } catch {
    console.error("Could not parse Anthropic response as JSON", rawText);
    return json({ error: "Réponse IA illisible, réessayez avec une photo plus nette" }, 502);
  }

  if (!Array.isArray(items)) {
    return json({ error: "Format de réponse inattendu" }, 502);
  }

  const sanitized = items
    .filter((it): it is Record<string, unknown> =>
      !!it && typeof it === "object" && typeof (it as Record<string, unknown>).produit === "string"
    )
    .map((it) => ({
      produit: String(it.produit).slice(0, 200),
      quantite: Number(it.quantite) || 0,
      unite: typeof it.unite === "string" ? it.unite.slice(0, 50) : "unité",
    }));

  return json({ items: sanitized });
});
