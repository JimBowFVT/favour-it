import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getAddress, verifyMessage } from "npm:ethers@6.17.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return respond(503, { error: "Wallet verification is not configured" });

    const authorization = req.headers.get("Authorization") || "";
    const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return respond(401, { error: "Authentication required" });

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
    if (userError || !userData?.user) return respond(401, { error: "Invalid session" });

    const body = await req.json();
    const challengeId = String(body?.challengeId || "").trim();
    const signature = String(body?.signature || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return respond(400, { error: "Invalid challenge id" });
    if (!/^0x[0-9a-f]+$/i.test(signature) || signature.length < 130) return respond(400, { error: "Invalid wallet signature" });

    const { data: challenge, error: challengeError } = await userClient
      .from("crypto_wallet_link_challenges")
      .select("id, user_id, chain_id, wallet_address, message, expires_at, consumed_at")
      .eq("id", challengeId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (challengeError) throw challengeError;
    if (!challenge) return respond(404, { error: "Wallet verification challenge not found" });
    if (challenge.consumed_at) return respond(409, { error: "Wallet verification challenge was already used" });
    if (new Date(challenge.expires_at).getTime() <= Date.now()) return respond(410, { error: "Wallet verification challenge expired" });

    let recoveredAddress: string;
    try {
      recoveredAddress = getAddress(verifyMessage(challenge.message, signature)).toLowerCase();
    } catch (_) {
      return respond(400, { error: "Wallet signature could not be verified" });
    }

    if (recoveredAddress !== String(challenge.wallet_address).toLowerCase()) {
      return respond(400, { error: "Signature does not match the requested wallet" });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: wallet, error: completeError } = await serviceClient.rpc("complete_crypto_wallet_link", {
      p_user_id: userData.user.id,
      p_challenge_id: challenge.id,
      p_verified_address: recoveredAddress,
    });

    if (completeError) throw completeError;

    return respond(200, {
      wallet,
      verified: true,
      chainId: Number(challenge.chain_id),
    });
  } catch (error) {
    console.error("verify-wallet failed", error);
    return respond(500, { error: error instanceof Error ? error.message : "Wallet verification failed" });
  }
});
