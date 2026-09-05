import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedTargets = new Set([
  "af","sq","am","ar","hy","az","eu","be","bn","bs","bg","ca","zh","hr","cs","da","nl","en","et","fi","fr","gl","ka","de","el","gu","he","hi","hu","is","id","ga","it","ja","kn","kk","ko","lv","lt","mk","ms","ml","mt","mr","mn","ne","no","fa","pl","pt","pa","ro","ru","sr","sk","sl","es","sw","sv","ta","te","th","tr","uk","ur","vi","cy"
]);

function detectFallbackSource(text: string) {
  if (/[֐-׿]/u.test(text)) return "he";
  if (/[؀-ۿ]/u.test(text)) return "ar";
  if (/[Ѐ-ӿ]/u.test(text)) return "ru";
  if (/[Ͱ-Ͽ]/u.test(text)) return "el";
  if (/[぀-ヿ]/u.test(text)) return "ja";
  if (/[가-힯]/u.test(text)) return "ko";
  if (/[一-鿿]/u.test(text)) return "zh";
  return "en";
}

async function googleTranslate(text: string, target: string) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  const response = await fetch(url, { headers: { "User-Agent": "Favourit/1.0" } });
  if (!response.ok) throw new Error(`Google translate HTTP ${response.status}`);
  const data = await response.json();
  const translated = Array.isArray(data?.[0]) ? data[0].map((part: unknown[]) => String(part?.[0] || "")).join("").trim() : "";
  if (!translated) throw new Error("Google translate returned no text");
  return translated;
}

async function myMemoryTranslate(text: string, target: string) {
  const source = detectFallbackSource(text);
  if (source === target) return text;
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${source}|${target}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
  const data = await response.json();
  const translated = String(data?.responseData?.translatedText || "").trim();
  if (!translated || Number(data?.responseStatus || 200) >= 400) throw new Error("MyMemory returned no text");
  return translated;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const text = String(body?.text || "").trim();
    const target = String(body?.targetLanguage || "en").toLowerCase().split("-")[0];
    if (!text) return new Response(JSON.stringify({ error: "Text is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (text.length > 5000) return new Response(JSON.stringify({ error: "Text is too long" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!allowedTargets.has(target)) return new Response(JSON.stringify({ error: "Unsupported target language" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let translatedText = "";
    let provider = "google";
    try {
      translatedText = await googleTranslate(text, target);
    } catch (_) {
      provider = "mymemory";
      translatedText = await myMemoryTranslate(text, target);
    }

    return new Response(JSON.stringify({ translatedText, targetLanguage: target, provider }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Translation failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
