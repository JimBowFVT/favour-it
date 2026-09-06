import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { JsonRpcProvider } from "npm:ethers@6.17.0";

const CHAIN_ID = 84532;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const bridgeSecret = Deno.env.get("FAV_BRIDGE_SECRET");
  if (!bridgeSecret) return json(503, { error: "Bridge reconciler is not configured" });
  if (req.headers.get("x-favourit-bridge-secret") !== bridgeSecret) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpcUrl = Deno.env.get("BASE_SEPOLIA_RPC_URL") || "https://sepolia.base.org";
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "Bridge reconciler secrets are incomplete" });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) return json(503, { error: `Bridge RPC is on chain ${network.chainId}; expected ${CHAIN_ID}` });

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit || 25), 100));
    const { data: requests, error: listError } = await service.rpc("get_crypto_unlocks_for_reconciliation", {
      p_limit: limit,
    });
    if (listError) throw listError;

    const latestBlock = await provider.getBlockNumber();
    const results: Record<string, unknown>[] = [];

    for (const unlock of requests || []) {
      const requestId = String(unlock.id);
      const txHash = String(unlock.tx_hash || "");
      const required = Math.max(1, Number(unlock.confirmations_required || 1));

      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
          results.push({ requestId, txHash, state: "pending" });
          continue;
        }

        if (Number(receipt.status) !== 1) {
          const { error: failError } = await service.rpc("finalize_crypto_unlock_failure", {
            p_request_id: requestId,
            p_reason: "On-chain FAV mint transaction reverted",
            p_tx_hash: txHash,
          });
          if (failError) throw failError;
          results.push({ requestId, txHash, state: "failed" });
          continue;
        }

        const confirmations = latestBlock - Number(receipt.blockNumber) + 1;
        if (confirmations < required) {
          results.push({ requestId, txHash, state: "confirming", confirmations, required });
          continue;
        }

        const { error: successError } = await service.rpc("finalize_crypto_unlock_success", {
          p_request_id: requestId,
          p_tx_hash: txHash,
        });
        if (successError) throw successError;
        results.push({ requestId, txHash, state: "confirmed", confirmations });
      } catch (requestError) {
        console.error("crypto unlock reconciliation item failed", { requestId, txHash, requestError });
        results.push({
          requestId,
          txHash,
          state: "error",
          error: requestError instanceof Error ? requestError.message : "reconciliation failed",
        });
      }
    }

    return json(200, { checked: results.length, latestBlock, results });
  } catch (error) {
    console.error("reconcile-crypto-unlocks failed", error);
    return json(500, { error: error instanceof Error ? error.message : "Crypto unlock reconciliation failed" });
  }
});
