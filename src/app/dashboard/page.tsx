"use client";

import { useCurrentAccount, useCurrentWallet, useDisconnectWallet, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAegisChainData, type GuardianPolicyRecord, type ReceiptRecord } from "@/hooks/useAegisChainData";
import type { GuardianResult } from "@/lib/guardian";
import type { ParsedIntent } from "@/lib/intent";
import {
  buildCreatePolicyTransaction,
  buildDeepBootstrapTransaction,
  buildIntentTransaction,
  buildRevokePolicyTransaction,
  buildUpdatePolicyTransaction,
  createExecutionPlan,
  executionConfig,
  executionBlockReason,
  simulateTransaction,
  SUI_DBUSDC_POOL_ID,
  type ExecutionPlan,
  type PolicyInput,
} from "@/lib/transaction";
import "./dashboard.css";

type Page = "swap" | "history" | "analytics" | "policy" | "receipts" | "settings";
type Simulation = { success: boolean; error?: string; gasEstimate?: string };
type PendingAction = { title: string; detail: string; run: () => Promise<void> };

const samples = [
  "Swap 1 SUI to DBUSDC, max 1% slippage",
  "Convert 5 DBUSDC to SUI, risk-averse",
  "Trade 2 SUI for USDC, low risk, max 2% slippage",
  "Swap 10 SUI to DBUSDC, aggressive",
];

const nav: Array<[Page, string, string]> = [
  ["swap", "⚡", "New Swap"],
  ["history", "📋", "History"],
  ["analytics", "📊", "Analytics"],
  ["policy", "🛡️", "Guardian Policy"],
  ["receipts", "🗂️", "My Receipts"],
  ["settings", "⚙️", "Settings"],
];

const short = (value: string) => value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "—";
const explorerObject = (id: string) => `https://suiexplorer.com/object/${id}?network=testnet`;
const explorerTx = (digest: string) => `https://suiexplorer.com/txblock/${digest}?network=testnet`;
const defaultPolicy = (): PolicyInput => ({
  maxSuiInput: 5,
  maxDbusdcInput: 10,
  maxSlippageBps: 200,
  expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
});

function Logo() {
  return <Link className="sidebar-logo" href="/"><span className="logo-mark">A</span><span><b>Aegis</b><small>Intent Guardian</small></span></Link>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="parsed-field"><small>{label}</small><b>{value}</b></div>;
}

function RiskRows({ result }: { result: GuardianResult }) {
  return <div className="risk-rows">{result.findings.map((risk) => <div className="risk-row" key={risk.id}><span className="risk-name"><i className={risk.score > 70 ? "red" : risk.score >= 40 ? "amber" : "green"} />{risk.label}</span><span className="risk-mini"><i style={{ width: `${risk.score}%` }} /></span><code>{risk.score}/100</code></div>)}</div>;
}

function SetupPanel({ balances, activePolicy, busy, onFaucet, onDeep, onPolicy }: {
  balances: { sui: number; deep: number; dbusdc: number };
  activePolicy: GuardianPolicyRecord | null;
  busy: boolean;
  onFaucet: () => void;
  onDeep: () => void;
  onPolicy: () => void;
}) {
  const items = [
    ["Test SUI", `${balances.sui.toFixed(3)} SUI`, balances.sui > 0, onFaucet, "Request faucet"],
    ["DeepBook fees", `${balances.deep.toFixed(3)} DEEP`, balances.deep >= 0.05, onDeep, "Acquire DEEP"],
    ["GuardianPolicy", activePolicy ? short(activePolicy.objectId) : "Not created", Boolean(activePolicy), onPolicy, "Create policy"],
  ] as const;
  return <div className="card setup-card"><div className="card-header"><b>Testnet Setup</b><span className="pill warn">Required</span></div><div className="setup-list">{items.map(([label, value, ready, action, actionLabel]) => <div key={label}><span><b>{label}</b><small>{value}</small></span><span className={`pill ${ready ? "clear" : "warn"}`}>{ready ? "Ready" : "Needed"}</span>{!ready && <button disabled={busy} onClick={action}>{actionLabel}</button>}</div>)}</div></div>;
}

function ReceiptTable({ receipts, mode }: { receipts: ReceiptRecord[]; mode: "history" | "receipts" }) {
  if (!receipts.length) return <div className="card"><div className="card-body">No Explorer-verifiable Aegis executions were found for this wallet.</div></div>;
  return <div className="history-table"><div className="table-row table-head"><span>{mode === "history" ? "Transaction" : "Receipt"}</span><span>Direction</span><span>Input atomic</span><span>Score</span><span>Verdict</span><span>Time</span></div>{receipts.map((receipt) => <a className="table-row" href={mode === "history" ? explorerTx(receipt.digest) : explorerObject(receipt.receiptId)} target="_blank" rel="noreferrer" key={receipt.digest}><span><b>{mode === "history" ? short(receipt.digest) : short(receipt.receiptId)}</b><small>{short(receipt.policyId)}</small></span><code>{receipt.direction === 0 ? "SUI → DBUSDC" : "DBUSDC → SUI"}</code><code>{receipt.inputAmount}</code><span className={`pill ${receipt.guardianScore >= 70 ? "block" : receipt.guardianScore >= 40 ? "warn" : "clear"}`}>{receipt.guardianScore}</span><span className={`pill ${receipt.verdict || "clear"}`}>{receipt.verdict || "clear"}</span><code>{new Date(receipt.timestamp).toLocaleString()}</code></a>)}</div>;
}

function PolicyPage({ policies, activePolicy, busy, onCreate, onUpdate, onRevoke }: {
  policies: GuardianPolicyRecord[];
  activePolicy: GuardianPolicyRecord | null;
  busy: boolean;
  onCreate: () => void;
  onUpdate: (policy: GuardianPolicyRecord) => void;
  onRevoke: (policy: GuardianPolicyRecord) => void;
}) {
  return <><h1>Guardian Policy</h1><p className="page-sub">Connected-wallet Move policy objects. Limits are enforced by Sui, not by the interface.</p><div className="policy-stack">{!activePolicy && <button className="primary standalone" disabled={busy} onClick={onCreate}>Create default seven-day policy</button>}{policies.map((policy) => <div className="card" key={policy.objectId}><div className="card-header"><b>{short(policy.objectId)}</b><span className={`pill ${policy.revoked ? "block" : activePolicy?.objectId === policy.objectId ? "clear" : "warn"}`}>{policy.revoked ? "Revoked" : activePolicy?.objectId === policy.objectId ? "Active" : "Expired"}</span></div><div className="card-body"><div className="parsed-grid"><Field label="Max SUI input" value={`${policy.maxSuiInput} SUI`} /><Field label="Max DBUSDC input" value={`${policy.maxDbusdcInput} DBUSDC`} /><Field label="Max slippage" value={`${policy.maxSlippageBps} bps`} /><Field label="Expires" value={new Date(policy.expiresAtMs).toLocaleString()} /><Field label="Allowed pool" value={short(policy.allowedPool)} /><Field label="Owner" value={short(policy.owner)} /></div><div className="policy-actions"><a href={explorerObject(policy.objectId)} target="_blank" rel="noreferrer">View object ↗</a>{!policy.revoked && <><button disabled={busy} onClick={() => onUpdate(policy)}>Extend & update</button><button className="danger" disabled={busy} onClick={() => onRevoke(policy)}>Revoke</button></>}</div></div></div>)}</div></>;
}

function AnalyticsPage({ receipts }: { receipts: ReceiptRecord[] }) {
  const average = receipts.length ? receipts.reduce((sum, row) => sum + row.guardianScore, 0) / receipts.length : 0;
  const suiVolume = receipts.filter((row) => row.direction === 0).reduce((sum, row) => sum + Number(row.inputAmount) / 1e9, 0);
  const dbusdcVolume = receipts.filter((row) => row.direction === 1).reduce((sum, row) => sum + Number(row.inputAmount) / 1e6, 0);
  return <><h1>Analytics</h1><p className="page-sub">Derived only from this wallet&apos;s real IntentExecuted events.</p><div className="metrics">{[["Total swaps", String(receipts.length)], ["Average risk", average.toFixed(1)], ["SUI volume", suiVolume.toFixed(3)], ["DBUSDC volume", dbusdcVolume.toFixed(3)]].map(([label, value]) => <div className="metric" key={label}><small>{label}</small><strong>{value}</strong><em>testnet events</em></div>)}</div><div className="card chart"><div className="card-header"><b>Guardian Score History</b></div><div className="bars">{receipts.length ? receipts.slice().reverse().map((row) => <i key={row.digest} title={`${row.guardianScore}/100`} style={{ height: `${Math.max(8, row.guardianScore * 2)}px` }} className={row.guardianScore >= 70 ? "red" : row.guardianScore >= 40 ? "amber" : "green"} />) : <p>No execution scores yet.</p>}</div></div></>;
}

function SettingsPage({ configured, activePolicy }: { configured: boolean; activePolicy: GuardianPolicyRecord | null }) {
  const rows = [
    ["Network", "Sui testnet", true],
    ["Aegis package", executionConfig()?.packageId ?? "Not published/configured", configured],
    ["DeepBook pool", SUI_DBUSDC_POOL_ID, true],
    ["OpenAI model", "gpt-4o-mini (server-side)", true],
    ["Active policy", activePolicy?.objectId ?? "Not created", Boolean(activePolicy)],
    ["Execution rules", "Live data + fresh plan + successful dry run", true],
  ] as const;
  return <><h1>Settings & Readiness</h1><p className="page-sub">Real deployment and execution status. No cosmetic controls.</p><div className="settings-status">{rows.map(([label, value, ready]) => <div className="card" key={label}><div className="card-body"><small>{label}</small><code>{value}</code><span className={`pill ${ready ? "clear" : "block"}`}>{ready ? "Ready" : "Blocked"}</span></div></div>)}</div></>;
}

export default function Dashboard() {
  const account = useCurrentAccount();
  const { connectionStatus } = useCurrentWallet();
  const disconnect = useDisconnectWallet();
  const signer = useSignAndExecuteTransaction();
  const router = useRouter();
  const chain = useAegisChainData();
  const [page, setPage] = useState<Page>("swap");
  const [text, setText] = useState(samples[0]);
  const [intent, setIntent] = useState<ParsedIntent | null>(null);
  const [guardian, setGuardian] = useState<GuardianResult | null>(null);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [stress, setStress] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [digest, setDigest] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    if (connectionStatus === "disconnected") router.replace("/");
  }, [connectionStatus, router]);

  const executionGate = executionBlockReason(plan, chain.activePolicy);
  const canExecute = Boolean(plan && simulation?.success && guardian?.canExecute && !stress && !executionGate && (guardian.verdict !== "warn" || ack));
  const setupReady = chain.balances.sui > 0 && chain.balances.deep >= 0.05 && Boolean(chain.activePolicy);
  const activeNav = useMemo(() => nav.find(([id]) => id === page), [page]);

  async function disconnectAndExit() {
    await disconnect.mutateAsync();
    router.replace("/");
  }

  async function signTransaction(title: string, detail: string, makeTransaction: () => ReturnType<typeof buildRevokePolicyTransaction>, after?: (digest: string) => void) {
    setPendingAction({
      title,
      detail,
      run: async () => {
        if (!account) return;
        setBusy(true);
        setError("");
        try {
          const result = await signer.mutateAsync({ transaction: makeTransaction() });
          after?.(result.digest);
          chain.refresh();
          setPendingAction(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Wallet transaction failed.");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function requestFaucet() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/faucet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account.address }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Faucet request failed or is rate limited.");
      chain.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Faucet request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDeepBootstrap() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      const quoteResponse = await fetch("/api/deep-bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account.address, suiAmount: 0.3 }) });
      const quote = await quoteResponse.json();
      if (!quoteResponse.ok) throw new Error(quote.error ?? "Unable to quote DEEP bootstrap.");
      const tx = buildDeepBootstrapTransaction(account.address, quote.suiAmount, quote.minDeepOut);
      const dryRun = await simulateTransaction(tx, account.address);
      if (!dryRun.success) throw new Error(dryRun.error ?? "DEEP bootstrap dry run failed.");
      await signTransaction("Acquire DEEP on DeepBook", `Swap ${quote.suiAmount} SUI for at least ${quote.minDeepOut.toFixed(4)} DEEP. Dry run passed; gas ${dryRun.gasEstimate}.`, () => buildDeepBootstrapTransaction(account.address, quote.suiAmount, quote.minDeepOut));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare DEEP bootstrap.");
    } finally {
      setBusy(false);
    }
  }

  function createPolicy() {
    if (!account) return;
    const input = defaultPolicy();
    void signTransaction("Create GuardianPolicy", "Create a seven-day SUI/DBUSDC policy: 5 SUI, 10 DBUSDC, and 2% maximum slippage.", () => buildCreatePolicyTransaction(account.address, input));
  }

  function updatePolicy(policy: GuardianPolicyRecord) {
    const input = defaultPolicy();
    void signTransaction("Update GuardianPolicy", "Reset practical limits and extend this policy for seven days.", () => buildUpdatePolicyTransaction(policy.objectId, input));
  }

  function revokePolicy(policy: GuardianPolicyRecord) {
    void signTransaction("Revoke GuardianPolicy", "Permanently revoke this policy. The object remains visible on Sui Explorer.", () => buildRevokePolicyTransaction(policy.objectId));
  }

  async function parseAndGuard() {
    if (!account) return;
    setBusy(true);
    setError("");
    setDigest("");
    setAck(false);
    setPlan(null);
    setSimulation(null);
    try {
      const parsedResponse = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const parsed = await parsedResponse.json();
      if (!parsedResponse.ok || parsed.error) throw new Error(parsed.error ?? "Intent parsing failed.");
      setIntent(parsed.intent);
      const guardianResponse = await fetch("/api/guardian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: parsed.intent, stress }) });
      const checked: GuardianResult = await guardianResponse.json();
      setGuardian(checked);
      if (!chain.activePolicy) throw new Error("Create an active GuardianPolicy before generating an executable PTB.");
      if (!checked.canExecute || stress) return;
      const nextPlan = createExecutionPlan(parsed.intent, checked, chain.activePolicy.objectId);
      const nextSimulation = await simulateTransaction(buildIntentTransaction(account.address, nextPlan), account.address);
      setPlan(nextPlan);
      setSimulation(nextSimulation);
      if (!nextSimulation.success) setError(nextSimulation.error ?? "PTB dry run failed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to process intent.");
    } finally {
      setBusy(false);
    }
  }

  function prepareExecution() {
    if (!account || !plan || !simulation?.success) return;
    const blockReason = executionBlockReason(plan, chain.activePolicy);
    if (blockReason) {
      setError(`${blockReason} Re-run Aegis to requote and dry-run.`);
      return;
    }
    void signTransaction("Sign atomic Aegis PTB", `${plan.amount} ${plan.inputAsset} → minimum ${plan.minOutput.toFixed(6)} ${plan.outputAsset}. Policy assertion, DeepBook swap, and receipt mint execute atomically.`, () => buildIntentTransaction(account.address, plan), setDigest);
  }

  if (connectionStatus !== "connected" || !account) return <div className="wallet-gate"><span className="logo-mark">A</span><b>Checking Sui wallet connection...</b><small>Disconnected users are redirected to the landing page.</small></div>;

  return <div className="dashboard">
    <aside className="sidebar"><Logo /><div className="sidebar-section"><small>Main</small>{nav.slice(0, 3).map(([id, icon, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{icon}</span>{label}{id === "history" && chain.receipts.length > 0 && <em>{chain.receipts.length}</em>}</button>)}</div><div className="sidebar-section"><small>Manage</small>{nav.slice(3).map(([id, icon, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</div><div className="sidebar-section resources"><small>Resources</small><a href="https://docs.sui.io/" target="_blank">📖 Sui Docs</a><a href="https://suiexplorer.com/?network=testnet" target="_blank">🔍 Explorer ↗</a></div><div className="wallet-card"><div><code>{short(account.address)}</code><span className="network">● testnet</span></div><div className="balance-line"><span>{chain.balances.sui.toFixed(3)} SUI</span><span>{chain.balances.deep.toFixed(3)} DEEP</span></div></div></aside>
    <main className="dash-main"><header className="dash-top"><b>{activeNav?.[1]} {activeNav?.[2]}</b><div><button title="Deterministic adverse data for non-executable risk demonstrations." className={stress ? "stress active" : "stress"} onClick={() => setStress(!stress)}>🧪 Stress Mode {stress && <span>ACTIVE</span>}</button><div className="wallet-menu"><button className="wallet-trigger" onClick={() => setWalletOpen(!walletOpen)}><span className="wallet-dot" />{short(account.address)}⌄</button>{walletOpen && <div className="wallet-dropdown"><small>Connected wallet</small><code>{account.address}</code><button onClick={async () => { await navigator.clipboard.writeText(account.address); setCopied(true); }}>{copied ? "✓ Address copied" : "Copy address"}</button><div><span className="network">● testnet</span><a href={explorerObject(account.address)} target="_blank">Explorer ↗</a></div><button className="dropdown-disconnect" onClick={disconnectAndExit}>Disconnect wallet</button></div>}</div></div></header>{stress && <div className="stress-banner">🧪 <b>Stress mode active</b> — deterministic demonstration data. Signing and execution are disabled.</div>}
      <section className="page">
        {chain.error && <div className="error page-error">{chain.error}</div>}
        {error && <div className="error page-error">{error}</div>}
        {page === "history" && <><h1>Transaction History</h1><p className="page-sub">Real IntentExecuted events for the connected wallet.</p><ReceiptTable receipts={chain.receipts} mode="history" /></>}
        {page === "receipts" && <><h1>My IntentReceipts</h1><p className="page-sub">Owned receipt objects minted by successful atomic Aegis PTBs.</p><ReceiptTable receipts={chain.receipts} mode="receipts" /></>}
        {page === "analytics" && <AnalyticsPage receipts={chain.receipts} />}
        {page === "policy" && <PolicyPage policies={chain.policies} activePolicy={chain.activePolicy} busy={busy || signer.isPending} onCreate={createPolicy} onUpdate={updatePolicy} onRevoke={revokePolicy} />}
        {page === "settings" && <SettingsPage configured={chain.configured} activePolicy={chain.activePolicy} />}
        {page === "swap" && <><div className="intent-intro"><h1>New Intent</h1><p className="page-sub">Describe a financial goal. Aegis compiles, checks, simulates, and asks before signing.</p></div>{!setupReady && <SetupPanel balances={chain.balances} activePolicy={chain.activePolicy} busy={busy || signer.isPending} onFaucet={requestFaucet} onDeep={prepareDeepBootstrap} onPolicy={createPolicy} />}<div className={`swap-layout ${guardian ? "has-results" : "intent-only"}`}><div className="column"><div className="card"><div className="card-header"><b>Your Intent</b><small>SUI ↔ DBUSDC</small></div><div className="card-body"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Swap 1 SUI to DBUSDC with max 1% slippage" /><div className="chips">{samples.map((sample) => <button key={sample} onClick={() => setText(sample)}>{sample}</button>)}</div><button className="primary" onClick={parseAndGuard} disabled={busy}>{busy ? "Running OpenAI + live Aegis checks..." : "Parse Intent & Run Aegis"}</button></div></div>{intent && <div className="card"><div className="card-header"><b>Parsed Intent</b><span className="pill clear">Validated</span></div><div className="card-body parsed-grid"><Field label="Input Asset" value={intent.inputAsset} /><Field label="Output Asset" value={intent.outputAsset} /><Field label="Amount" value={`${intent.amount} ${intent.inputAsset}`} /><Field label="Max Slippage" value={`${intent.maxSlippageBps / 100}%`} /><Field label="Risk Tolerance" value={intent.riskTolerance} /></div></div>}</div><div className="column">{guardian && <><div className="card"><div className="card-header"><b>Aegis Analysis</b><span className={`pill ${guardian.verdict}`}>{guardian.verdict.toUpperCase()} · {guardian.dataMode}</span></div><div className="card-body"><div className="score"><strong className={guardian.verdict}>{guardian.score}</strong><span><b>Deterministic risk score</b><small>0 clear · 40 warn · 70 block</small><i><em style={{ width: `${guardian.score}%` }} /></i></span></div><div className={`verdict ${guardian.verdict}`}>{guardian.verdict === "clear" ? "Safe to prepare" : guardian.verdict === "warn" ? "Risks detected; acknowledgement required" : "Execution blocked"}</div><RiskRows result={guardian} /><p className={`guardian-message ${guardian.verdict}`}>{guardian.explanation}</p></div></div>{plan && <div className="card"><div className="card-header"><b>Human-readable PTB Preview</b><small>fresh for 30 seconds</small></div><div className="card-body parsed-grid"><Field label="Policy" value={short(plan.policyId)} /><Field label="Pool" value={short(plan.poolId)} /><Field label="Expected output" value={`${guardian.expectedOutput.toFixed(6)} ${plan.outputAsset}`} /><Field label="Minimum output" value={`${plan.minOutput.toFixed(6)} ${plan.outputAsset}`} /><Field label="DEEP fee budget" value={plan.deepBudget.toFixed(6)} /><Field label="Snapshot" value={new Date(plan.createdAt).toLocaleTimeString()} /></div><div className="ptb">{[["Assert GuardianPolicy", "Move"], [`DeepBook swap ${plan.amount} ${plan.inputAsset}`, "DeepBook"], ["Mint IntentReceipt", "Move"]].map(([label, protocol], index) => <div key={label}><span>{index + 1}</span><b>{label}</b><em>{protocol}</em></div>)}</div><div className="atomic">Atomic: all three calls succeed together or the transaction reverts.</div><div className="confirm">{simulation && <div className={`verdict ${simulation.success ? "clear" : "block"}`}>{simulation.success ? `Dry run passed · gas ${simulation.gasEstimate}` : `Dry run failed · ${simulation.error}`}</div>}{executionGate && <div className="verdict block">{executionGate}</div>}{guardian.verdict === "warn" && <label><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I understand the identified Aegis risks.</label>}<button className={canExecute ? "primary" : "disabled"} disabled={!canExecute || busy || signer.isPending} onClick={prepareExecution}>{canExecute ? "Review & Sign Atomic PTB" : "Execution gate not satisfied"}</button></div></div>}{digest && <div className="receipt"><b>Transaction executed and IntentReceipt minted</b><code>{digest}</code><a href={explorerTx(digest)} target="_blank" rel="noreferrer">View on Sui Explorer ↗</a></div>}</>}</div></div></>}
      </section>
    </main>
    {pendingAction && <div className="modal-backdrop"><div className="confirm-modal"><span className="logo-mark">A</span><h2>{pendingAction.title}</h2><p>{pendingAction.detail}</p><div><button onClick={() => setPendingAction(null)} disabled={busy || signer.isPending}>Cancel</button><button className="primary" onClick={pendingAction.run} disabled={busy || signer.isPending}>{busy || signer.isPending ? "Awaiting wallet..." : "Confirm in wallet"}</button></div></div></div>}
  </div>;
}
