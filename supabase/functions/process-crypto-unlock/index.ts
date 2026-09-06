import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Contract, JsonRpcProvider, Wallet } from "npm:ethers@6.17.0";

const CHAIN_ID = 84532;
const abi = [
  "function mintWithReference(bytes32 reference,address to,uint256 amount)",
  "function processedMintReferences(bytes32 reference) view returns (bool)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
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
  if (!bridgeSecret) return json(503, { error: "Bridge worker is not configured" });
  if (req.headers.get("x-favourit-bridge-secret") !== bridgeSecret) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpcUrl = Deno.env.get("BASE_SEPOLIA_RPC_URL") || "https://sepolia.base.org";
  const minterPrivateKey = Deno.env.get("FAV_MINTER_PRIVATE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !minterPrivateKey) return json(503, { error: "Bridge worker secrets are incomplete" });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let requestId: string | null = null;
  let txHash: string | null = null;

  try {
    const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) return json(503, { error: `Bridge RPC is on chain ${network.chainId}; expected ${CHAIN_ID}` });

    const { data: unlock, error: claimError } = await service.rpc("claim_next_crypto_unlock");
    if (claimError) throw claimError;
    if (!unlock) return json(200, { processed: false, reason: "queue-empty-or-disabled" });

    requestId = String(unlock.id);
    if (Number(unlock.chain_id) !== CHAIN_ID) throw new Error("Unlock request is not for Base Sepolia");

    const signer = new Wallet(minterPrivateKey, provider);
    const contract = new Contract(String(unlock.token_address), abi, signer);
    const code = await provider.getCode(String(unlock.token_address));
    if (!code || code === "0x") throw new Error("Configured FAV token address has no contract code");

    const minterRole = await contract.MINTER_ROLE();
    const hasMinterRole = await contract.hasRole(minterRole, signer.address);
    if (!hasMinterRole) throw new Error(`Configured signer ${signer.address} does not have FAV MINTER_ROLE`);

    const alreadyProcessed = await contract.processedMintReferences(String(unlock.mint_reference));
    if (alreadyProcessed) {
      const { error: finalizeError } = await service.rpc("finalize_crypto_unlock_success", {
        p_request_id: requestId,
        p_tx_hash: null,
      });
      if (finalizeError) throw finalizeError;
      return json(200, {
        processed: true,
        recovered: true,
        requestId,
        mintReference: unlock.mint_reference,
      });
    }

    const tx = await contract.mintWithReference(
      String(unlock.mint_reference),
      String(unlock.destination_address),
      BigInt(String(unlock.net_fav)),
    );
    txHash = String(tx.hash).toLowerCase();

    const { error: broadcastError } = await service.rpc("mark_crypto_unlock_broadcast", {
      p_request_id: requestId,
      p_tx_hash: txHash,
    });
    if (broadcastError) throw broadcastError;

    return json(200, {
      processed: true,
      requestId,
      txHash,
      mintReference: unlock.mint_reference,
      destination: unlock.destination_address,
      netFav: String(unlock.net_fav),
    });
  } catch (error) {
    console.error("process-crypto-unlock failed", { requestId, txHash, error });

    // If no transaction hash was obtained, keep the FAV reserved and retry later. A network error
    // can happen after a transaction was accepted, so the next attempt first checks the on-chain
    // mint reference before sending anything else.
    if (requestId && !txHash) {
      await service.rpc("requeue_crypto_unlock", {
        p_request_id: requestId,
        p_reason: error instanceof Error ? error.message : "bridge worker failed before broadcast",
      });
    }

    return json(500, {
      error: error instanceof Error ? error.message : "Crypto unlock processing failed",
      requestId,
      txHash,
    });
  }
});
