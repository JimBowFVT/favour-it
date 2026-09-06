import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Contract, JsonRpcProvider } from "npm:ethers@6.17.0";

const CHAIN_ID = 84532;
const tokenReadAbi = [
  "function processedMintReferences(bytes32 mintRef) view returns (bool)",
];

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

    const { data: config, error: configError } = await service
      .from("crypto_chain_config")
      .select("chain_id,token_address,deployment_verified_at")
      .eq("id", true)
      .single();
    if (configError) throw configError;
    if (Number(config?.chain_id) !== CHAIN_ID) return json(503, { error: "Configured FAV chain is not Base Sepolia" });
    if (!config?.token_address || !config?.deployment_verified_at) return json(503, { error: "FAV testnet deployment is not verified" });

    const verifiedTokenAddress = String(config.token_address).toLowerCase();
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
      const tokenAddress = String(unlock.token_address || "").toLowerCase();
      const mintReference = String(unlock.mint_reference || "");
      const required = Math.max(1, Number(unlock.confirmations_required || 1));

      try {
        if (Number(unlock.chain_id) !== CHAIN_ID) {
          results.push({ requestId, txHash, state: "blocked", reason: "wrong-chain" });
          continue;
        }
        if (tokenAddress !== verifiedTokenAddress) {
          results.push({ requestId, txHash, state: "blocked", reason: "token-does-not-match-verified-deployment" });
          continue;
        }

        const code = await provider.getCode(tokenAddress);
        if (!code || code === "0x") {
          results.push({ requestId, txHash, state: "blocked", reason: "token-code-missing" });
          continue;
        }

        const token = new Contract(tokenAddress, tokenReadAbi, provider);
        const mintReferenceProcessed = Boolean(await token.processedMintReferences(mintReference));
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
          results.push({
            requestId,
            txHash,
            state: mintReferenceProcessed ? "manual-recovery-required" : "pending",
            mintReferenceProcessed,
          });
          continue;
        }

        if (Number(receipt.status) !== 1) {
          if (mintReferenceProcessed) {
            results.push({
              requestId,
              txHash,
              state: "manual-recovery-required",
              reason: "tracked-tx-reverted-but-reference-is-processed",
              mintReferenceProcessed: true,
            });
            continue;
          }

          const { error: failError } = await service.rpc("finalize_crypto_unlock_failure", {
            p_request_id: requestId,
            p_reason: "On-chain FAV mint transaction reverted and mint reference remains unused",
            p_tx_hash: txHash,
          });
          if (failError) throw failError;
          results.push({ requestId, txHash, state: "failed", mintReferenceProcessed: false });
          continue;
        }

        if (!mintReferenceProcessed) {
          results.push({
            requestId,
            txHash,
            state: "manual-recovery-required",
            reason: "successful-tx-without-processed-mint-reference",
            mintReferenceProcessed: false,
          });
          continue;
        }

        const confirmations = latestBlock - Number(receipt.blockNumber) + 1;
        if (confirmations < required) {
          results.push({ requestId, txHash, state: "confirming", confirmations, required, mintReferenceProcessed: true });
          continue;
        }

        const { error: successError } = await service.rpc("finalize_crypto_unlock_success", {
          p_request_id: requestId,
          p_tx_hash: txHash,
        });
        if (successError) throw successError;
        results.push({ requestId, txHash, state: "confirmed", confirmations, mintReferenceProcessed: true });
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
