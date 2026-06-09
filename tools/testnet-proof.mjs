import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

const RPC = "https://fullnode.testnet.sui.io:443";
const ADDRESS = "0xb9e2805d6531802348e36954ad113ba4f2bce2c14e09fd578e5c8fa876082232";
const PACKAGE_ID = "0x7e20acf1c946ad58cd3633ddd1fc37c323c063dc92de138fead88c5dcb42c71d";
const POOL_ID = "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5";
const CLOCK_ID = "0x6";
const DEEP_TYPE = "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP";
const KEEP_POLICY_ACTIVE = process.argv.includes("--keep-policy-active");

const client = new SuiJsonRpcClient({ network: "testnet", url: RPC });
const deepbook = new DeepBookClient({ client, address: ADDRESS, network: "testnet" });

async function loadSigner() {
  const entries = JSON.parse(await readFile(join(homedir(), ".sui", "sui_config", "sui.keystore"), "utf8"));
  for (const entry of entries) {
    const bytes = Buffer.from(entry, "base64");
    if (bytes[0] !== 0) continue;
    const signer = Ed25519Keypair.fromSecretKey(bytes.subarray(1));
    if (signer.toSuiAddress() === ADDRESS) return signer;
  }
  throw new Error(`No Ed25519 key found for ${ADDRESS}`);
}

async function dryRun(tx) {
  tx.setSender(ADDRESS);
  const result = await client.dryRunTransactionBlock({ transactionBlock: await tx.build({ client }) });
  if (result.effects.status.status !== "success") throw new Error(result.effects.status.error ?? "Dry run failed");
  return result;
}

async function execute(signer, tx) {
  await dryRun(tx);
  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showEvents: true, showObjectChanges: true, showBalanceChanges: true },
  });
  if (result.effects?.status.status !== "success") throw new Error(result.effects?.status.error ?? "Execution failed");
  await client.waitForTransaction({ digest: result.digest });
  return result;
}

function bootstrapTransaction(minDeepOut) {
  const tx = new Transaction();
  // DEEP_SUI base is DEEP and quote is SUI. This swaps exact quote (SUI)
  // for base (DEEP); amount is SUI and minOut is DEEP.
  const [deepOut, suiOut, feeOut] = deepbook.deepBook.swapExactQuoteForBase({
    poolKey: "DEEP_SUI",
    amount: 0.3,
    deepAmount: 0,
    minOut: minDeepOut,
  })(tx);
  tx.transferObjects([deepOut, suiOut, feeOut], ADDRESS);
  return tx;
}

function createPolicyTransaction() {
  const tx = new Transaction();
  const policy = tx.moveCall({
    target: `${PACKAGE_ID}::guardian::create_policy`,
    arguments: [
      tx.pure.u64(5_000_000_000),
      tx.pure.u64(10_000_000),
      tx.pure.u64(200),
      tx.pure.id(POOL_ID),
      tx.pure.u64(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ],
  });
  tx.transferObjects([policy], ADDRESS);
  return tx;
}

function executionTransaction(quote, policyId) {
  const minOut = quote.quoteOut * 0.99;
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::guardian::assert_compliant`,
    arguments: [tx.object(policyId), tx.pure.u8(0), tx.pure.u64(1_000_000_000), tx.pure.u64(100), tx.pure.id(POOL_ID), tx.object(CLOCK_ID)],
  });
  const [baseOut, quoteOut, deepOut] = deepbook.deepBook.swapExactBaseForQuote({
    poolKey: "SUI_DBUSDC",
    amount: 1,
    deepAmount: Math.max(quote.deepRequired * 1.15, 0.001),
    minOut,
  })(tx);
  tx.transferObjects([baseOut, quoteOut, deepOut], ADDRESS);
  const receipt = tx.moveCall({
    target: `${PACKAGE_ID}::guardian::mint_receipt`,
    arguments: [
      tx.object(policyId),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode('{"kind":"swap","inputAsset":"SUI","outputAsset":"DBUSDC","amount":1,"maxSlippageBps":100,"riskTolerance":"low"}'))),
      tx.pure.id(POOL_ID),
      tx.pure.u8(0),
      tx.pure.u64(1_000_000_000),
      tx.pure.u64(Math.floor(minOut * 1_000_000)),
      tx.pure.u8(12),
      tx.pure.string("clear"),
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([receipt], ADDRESS);
  return tx;
}

function updateTransaction(policyId) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::guardian::update_policy`,
    arguments: [tx.object(policyId), tx.pure.u64(5_000_000_000), tx.pure.u64(10_000_000), tx.pure.u64(200), tx.pure.u64(Date.now() + 7 * 24 * 60 * 60 * 1000)],
  });
  return tx;
}

function revokeTransaction(policyId) {
  const tx = new Transaction();
  tx.moveCall({ target: `${PACKAGE_ID}::guardian::revoke_policy`, arguments: [tx.object(policyId), tx.object(CLOCK_ID)] });
  return tx;
}

const signer = await loadSigner();
const proof = {};
const deepBalance = await client.getBalance({ owner: ADDRESS, coinType: DEEP_TYPE });
if (Number(deepBalance.totalBalance) < 50_000) {
  const bootstrapQuote = await deepbook.getBaseQuantityOut("DEEP_SUI", 0.3);
  proof.deepBootstrap = (await execute(signer, bootstrapTransaction(bootstrapQuote.baseOut * 0.98))).digest;
}
const policyCreate = await execute(signer, createPolicyTransaction());
proof.policyCreate = policyCreate.digest;
proof.policyId = policyCreate.objectChanges?.find((change) => change.type === "created" && change.objectType?.endsWith("::guardian::GuardianPolicy"))?.objectId;
if (!proof.policyId) throw new Error("GuardianPolicy object was not found in policy creation object changes.");
const quote = await deepbook.getQuoteQuantityOut("SUI_DBUSDC", 1);
proof.quote = { quoteOut: quote.quoteOut, deepRequired: quote.deepRequired };
const execution = await execute(signer, executionTransaction(quote, proof.policyId));
proof.execution = execution.digest;
proof.receiptId = execution.objectChanges?.find((change) => change.type === "created" && change.objectType?.endsWith("::guardian::IntentReceipt"))?.objectId;
proof.update = (await execute(signer, updateTransaction(proof.policyId))).digest;
if (KEEP_POLICY_ACTIVE) {
  proof.policyKeptActive = true;
} else {
  proof.revoke = (await execute(signer, revokeTransaction(proof.policyId))).digest;
  proof.policyKeptActive = false;
}
console.log(JSON.stringify(proof, null, 2));
