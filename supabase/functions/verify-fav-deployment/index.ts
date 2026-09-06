import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Contract, JsonRpcProvider, getAddress } from "npm:ethers@6.17.0";

const CHAIN_ID = 84532;
const EXPECTED_CAP = 10_000_000_000_000n;
const abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function CAP_MANAGER_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
];

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function requireAddress(value: unknown, label: string) {
  try {
    return getAddress(String(value || ""));
  } catch {
    throw new Error(`${label} is not a valid EVM address`);
  }
}

function requireTxHash(value: unknown) {
  const hash = String(value || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("deployment transaction hash is invalid");
  return hash;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const bridgeSecret = Deno.env.get("FAV_BRIDGE_SECRET");
  if (!bridgeSecret) return json(503, { error: "FAV deployment verifier is not configured" });
  if (req.headers.get("x-favourit-bridge-secret") !== bridgeSecret) return json(401, { error: "Unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpcUrl = Deno.env.get("BASE_SEPOLIA_RPC_URL") || "https://sepolia.base.org";
  if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "Verifier service credentials are incomplete" });

  try {
    const body = await req.json().catch(() => ({}));
    const tokenAddress = requireAddress(body?.tokenAddress, "token address");
    const adminAddress = requireAddress(body?.adminAddress, "admin address");
    const minterAddress = requireAddress(body?.minterAddress, "minter address");
    const deploymentTxHash = requireTxHash(body?.deploymentTxHash);

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: policy, error: policyError } = await service
      .from("crypto_chain_config")
      .select("chain_id,initial_cap_micro_fav,admin_address,unlock_enabled")
      .eq("id", true)
      .single();
    if (policyError) throw policyError;
    if (Number(policy?.chain_id) !== CHAIN_ID) throw new Error("database crypto policy is not Base Sepolia");
    if (BigInt(String(policy?.initial_cap_micro_fav || 0)) !== EXPECTED_CAP) throw new Error("database FAV cap does not match the locked 10M policy");
    if (String(policy?.admin_address || "").toLowerCase() !== adminAddress.toLowerCase()) throw new Error("admin address does not match the locked FAV testnet policy");
    if (policy?.unlock_enabled) throw new Error("crypto unlock must remain disabled while verifying a deployment");

    const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) throw new Error(`RPC is on chain ${network.chainId}; expected ${CHAIN_ID}`);

    const code = await provider.getCode(tokenAddress);
    if (!code || code === "0x") throw new Error("token address has no deployed contract code");

    const receipt = await provider.getTransactionReceipt(deploymentTxHash);
    if (!receipt) throw new Error("deployment transaction is not confirmed yet");
    if (Number(receipt.status) !== 1) throw new Error("deployment transaction reverted");
    if (receipt.contractAddress && receipt.contractAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
      throw new Error("deployment transaction created a different contract address");
    }

    const token = new Contract(tokenAddress, abi, provider);
    const [
      name,
      symbol,
      decimals,
      maxSupply,
      totalSupply,
      defaultAdminRole,
      pauserRole,
      capManagerRole,
      minterRole,
    ] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
      token.maxSupply(),
      token.totalSupply(),
      token.DEFAULT_ADMIN_ROLE(),
      token.PAUSER_ROLE(),
      token.CAP_MANAGER_ROLE(),
      token.MINTER_ROLE(),
    ]);

    if (name !== "Favourit") throw new Error(`unexpected token name: ${name}`);
    if (symbol !== "FAV") throw new Error(`unexpected token symbol: ${symbol}`);
    if (Number(decimals) !== 6) throw new Error(`unexpected token decimals: ${decimals}`);
    if (BigInt(maxSupply) !== EXPECTED_CAP) throw new Error(`unexpected max supply: ${maxSupply}`);
    if (BigInt(totalSupply) !== 0n) throw new Error(`initial total supply must be zero; got ${totalSupply}`);

    const [isAdmin, isPauser, isCapManager, isMinter] = await Promise.all([
      token.hasRole(defaultAdminRole, adminAddress),
      token.hasRole(pauserRole, adminAddress),
      token.hasRole(capManagerRole, adminAddress),
      token.hasRole(minterRole, minterAddress),
    ]);
    if (!isAdmin) throw new Error("configured admin does not hold DEFAULT_ADMIN_ROLE");
    if (!isPauser) throw new Error("configured admin does not hold PAUSER_ROLE");
    if (!isCapManager) throw new Error("configured admin does not hold CAP_MANAGER_ROLE");
    if (!isMinter) throw new Error("configured minter does not hold MINTER_ROLE");

    const { error: deploymentError } = await service.rpc("record_fav_token_deployment", {
      p_token_address: tokenAddress,
      p_deployment_tx_hash: deploymentTxHash,
      p_enable_unlock: false,
    });
    if (deploymentError) throw deploymentError;

    const { error: rolesError } = await service.rpc("record_fav_testnet_role_addresses", {
      p_admin_address: adminAddress,
      p_minter_address: minterAddress,
    });
    if (rolesError) throw rolesError;

    const { data: verified, error: verifyError } = await service.rpc("mark_fav_token_deployment_verified", {
      p_token_address: tokenAddress,
      p_admin_address: adminAddress,
      p_minter_address: minterAddress,
    });
    if (verifyError) throw verifyError;

    return json(200, {
      verified: true,
      chainId: CHAIN_ID,
      tokenAddress,
      deploymentTxHash,
      adminAddress,
      minterAddress,
      name,
      symbol,
      decimals: Number(decimals),
      maxSupplyMicroFav: String(maxSupply),
      totalSupplyMicroFav: String(totalSupply),
      database: verified,
      unlockEnabled: false,
    });
  } catch (error) {
    console.error("verify-fav-deployment failed", error);
    return json(400, { error: error instanceof Error ? error.message : "FAV deployment verification failed" });
  }
});
