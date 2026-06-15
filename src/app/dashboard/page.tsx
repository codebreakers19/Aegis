"use client";

import { useCurrentAccount, useCurrentWallet, useDisconnectWallet, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAegisChainData, type GuardianPolicyRecord, type ReceiptRecord } from "@/hooks/useAegisChainData";
import type { GuardianResult, StressScenario } from "@/lib/guardian";
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
  isPlanFresh,
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
const explorerObject = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
const explorerTx = (digest: string) => `https://suiscan.xyz/testnet/tx/${digest}`;
const receiptAssets = (receipt: ReceiptRecord) => receipt.direction === 0
  ? { input: "SUI", output: "DBUSDC", inputScalar: 1e9, outputScalar: 1e6 }
  : { input: "DBUSDC", output: "SUI", inputScalar: 1e6, outputScalar: 1e9 };
const formatAmount = (atomic: string, scalar: number, symbol: string) => {
  const amount = Number(atomic) / scalar;
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`;
};
const defaultPolicy = (): PolicyInput => ({
  maxSuiInput: 5,
  maxDbusdcInput: 10,
  maxSlippageBps: 200,
  expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
});
const GAS_RESERVE_SUI = 0.06;

function balanceBlockReason(plan: ExecutionPlan | null, balances: { sui: number; deep: number; dbusdc: number }) {
  if (!plan) return null;
  if (plan.inputAsset === "SUI" && balances.sui < plan.amount + GAS_RESERVE_SUI) return `Need at least ${(plan.amount + GAS_RESERVE_SUI).toFixed(3)} SUI for this swap plus gas reserve. You have ${balances.sui.toFixed(3)} SUI.`;
  if (plan.inputAsset === "DBUSDC" && balances.dbusdc < plan.amount) return `Need ${plan.amount.toFixed(3)} DBUSDC for this swap. You have ${balances.dbusdc.toFixed(3)} DBUSDC.`;
  if (plan.inputAsset !== "SUI" && balances.sui < GAS_RESERVE_SUI) return `Need at least ${GAS_RESERVE_SUI.toFixed(2)} SUI for gas. You have ${balances.sui.toFixed(3)} SUI.`;
  if (balances.deep < plan.deepBudget) return `Need ${plan.deepBudget.toFixed(6)} DEEP for DeepBook fees. You have ${balances.deep.toFixed(6)} DEEP.`;
  return null;
}

function friendlyTxError(error?: string) {
  if (!error) return "PTB dry run failed.";
  if (error.includes("InsufficientCoinBalance")) return "Dry run failed: wallet balance is not enough for this swap plus gas reserve. Lower the amount or request more test SUI.";
  if (error.includes("Insufficient balance") && error.includes("DEEP")) return "Dry run failed: wallet needs more DEEP for DeepBook fees. Use Testnet Setup to acquire DEEP.";
  return `Dry run failed: ${error}`;
}

function Logo() {
  return <Link className="sidebar-logo" href="/"><Image src="/icon-192.png" alt="" width={34} height={34} priority /><span><b>Aegis</b><small>Intent Guardian</small></span></Link>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="parsed-field"><small>{label}</small><b>{value}</b></div>;
}

function PolicyExpiryCountdown({ expiresAtMs }: { expiresAtMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, expiresAtMs - now);
  if (!remaining) return <span className="expiry-countdown expired">Expired</span>;
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return <span className="expiry-countdown">Expires in {hours}h {minutes}m</span>;
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
  return <div className="proof-list">{receipts.map((receipt, index) => {
    const assets = receiptAssets(receipt);
    const verdict = receipt.verdict || "clear";
    const isHistory = mode === "history";
    return <details className="proof-card compact-proof" key={`${receipt.digest}-${receipt.receiptId}`}>
      <summary className="proof-card-top">
        <span className="proof-index">{String(receipts.length - index).padStart(2, "0")}</span>
        <div><small>{mode === "history" ? "Atomic Aegis execution" : "Owned IntentReceipt"}</small><h2>{assets.input} <span>→</span> {assets.output}</h2></div>
        <code>{isHistory ? short(receipt.digest) : short(receipt.policyId)}</code>
        <strong>{formatAmount(receipt.inputAmount, assets.inputScalar, assets.input)}</strong>
        <span className={`pill ${verdict}`}>{verdict.toUpperCase()} · {receipt.guardianScore}/100</span>
        <span className="expand-cue"><span className="open-label">{isHistory ? "Open tx" : "Open receipt"}</span><span className="close-label">Close</span></span>
      </summary>
      <div className="proof-details">
      <div className="proof-amounts">
        <div><small>Input amount</small><strong>{formatAmount(receipt.inputAmount, assets.inputScalar, assets.input)}</strong><code>{receipt.inputAmount} atomic units</code></div>
        <div><small>Protected minimum output</small><strong>{formatAmount(receipt.minOutput, assets.outputScalar, assets.output)}</strong><code>{receipt.minOutput} atomic units</code></div>
        <div><small>Executed on testnet</small><strong>{new Date(receipt.timestamp).toLocaleDateString()}</strong><code>{new Date(receipt.timestamp).toLocaleTimeString()}</code></div>
      </div>
      <div className="proof-hash">
        <span><small>Transaction digest</small><code>{receipt.digest}</code></span>
        <a className="proof-primary-link" href={explorerTx(receipt.digest)} target="_blank" rel="noreferrer">Verify transaction on SuiScan ↗</a>
      </div>
      <div className="proof-links">
        <span>On-chain proof</span>
        <a href={explorerObject(receipt.receiptId)} target="_blank" rel="noreferrer">IntentReceipt {short(receipt.receiptId)} ↗</a>
        <a href={explorerObject(receipt.policyId)} target="_blank" rel="noreferrer">GuardianPolicy {short(receipt.policyId)} ↗</a>
        <a href={explorerObject(receipt.pool)} target="_blank" rel="noreferrer">DeepBook pool {short(receipt.pool)} ↗</a>
      </div>
      </div>
    </details>;
  })}</div>;
}
void ReceiptTable;

function ProofList({ receipts, mode }: { receipts: ReceiptRecord[]; mode: "history" | "receipts" }) {
  if (!receipts.length) return <div className="card"><div className="card-body">No Explorer-verifiable Aegis executions were found for this wallet.</div></div>;
  return <div className="proof-list compact-list">{receipts.map((receipt, index) => {
    const assets = receiptAssets(receipt);
    const verdict = receipt.verdict || "clear";
    const isHistory = mode === "history";
    const primaryId = isHistory ? receipt.digest : receipt.receiptId;
    return <details className="proof-card compact-proof" key={`${receipt.digest}-${receipt.receiptId}`}>
      <summary className="proof-card-top">
        <span className="proof-index">{String(receipts.length - index).padStart(2, "0")}</span>
        <div><small>{isHistory ? "Transaction event" : "Receipt object"}</small><h2>{isHistory ? `${assets.input} swap` : "IntentReceipt"} <span>→</span> {isHistory ? assets.output : short(receipt.receiptId)}</h2></div>
        <code>{short(primaryId)}</code>
        <strong>{formatAmount(receipt.inputAmount, assets.inputScalar, assets.input)}</strong>
        <span className={`pill ${verdict}`}>{verdict.toUpperCase()} · {receipt.guardianScore}/100</span>
        <span className="expand-cue"><span className="open-label">{isHistory ? "Open tx" : "Open receipt"}</span><span className="close-label">Close</span></span>
      </summary>
      <div className="proof-details">
        <div className="proof-amounts">
          <div><small>Input amount</small><strong>{formatAmount(receipt.inputAmount, assets.inputScalar, assets.input)}</strong><code>{receipt.inputAmount} atomic units</code></div>
          <div><small>Protected minimum output</small><strong>{formatAmount(receipt.minOutput, assets.outputScalar, assets.output)}</strong><code>{receipt.minOutput} atomic units</code></div>
          <div><small>Executed on testnet</small><strong>{new Date(receipt.timestamp).toLocaleDateString()}</strong><code>{new Date(receipt.timestamp).toLocaleTimeString()}</code></div>
        </div>
        <div className="proof-hash">
          <span><small>{isHistory ? "Transaction digest" : "IntentReceipt object ID"}</small><code>{primaryId}</code></span>
          <a className="proof-primary-link" href={isHistory ? explorerTx(receipt.digest) : explorerObject(receipt.receiptId)} target="_blank" rel="noreferrer">{isHistory ? "Verify transaction" : "Open receipt object"} on SuiScan ↗</a>
        </div>
        <div className="proof-links">
          <span>{isHistory ? "Related objects" : "Receipt context"}</span>
          <a href={explorerTx(receipt.digest)} target="_blank" rel="noreferrer">Transaction {short(receipt.digest)} ↗</a>
          <a href={explorerObject(receipt.receiptId)} target="_blank" rel="noreferrer">IntentReceipt {short(receipt.receiptId)} ↗</a>
          <a href={explorerObject(receipt.policyId)} target="_blank" rel="noreferrer">GuardianPolicy {short(receipt.policyId)} ↗</a>
          <a href={explorerObject(receipt.pool)} target="_blank" rel="noreferrer">DeepBook pool {short(receipt.pool)} ↗</a>
        </div>
      </div>
    </details>;
  })}</div>;
}

function PolicyPageLegacy({ policies, activePolicy, busy, onCreate, onUpdate, onRevoke }: {
  policies: GuardianPolicyRecord[];
  activePolicy: GuardianPolicyRecord | null;
  busy: boolean;
  onCreate: () => void;
  onUpdate: (policy: GuardianPolicyRecord) => void;
  onRevoke: (policy: GuardianPolicyRecord) => void;
}) {
  return <><h1>Guardian Policy</h1><p className="page-sub">Connected-wallet Move policy objects. Limits are enforced by Sui, not by the interface.</p><div className="policy-stack">{!activePolicy && <button className="primary standalone" disabled={busy} onClick={onCreate}>Create default seven-day policy</button>}{policies.map((policy) => <div className="card" key={policy.objectId}><div className="card-header"><b>{short(policy.objectId)}</b><span className={`pill ${policy.revoked ? "block" : activePolicy?.objectId === policy.objectId ? "clear" : "warn"}`}>{policy.revoked ? "Revoked" : activePolicy?.objectId === policy.objectId ? "Active" : "Expired"}</span></div><div className="card-body"><div className="parsed-grid"><Field label="Max SUI input" value={`${policy.maxSuiInput} SUI`} /><Field label="Max DBUSDC input" value={`${policy.maxDbusdcInput} DBUSDC`} /><Field label="Max slippage" value={`${policy.maxSlippageBps} bps`} /><div className="parsed-field"><small>Expires</small><b>{new Date(policy.expiresAtMs).toLocaleString()}</b><PolicyExpiryCountdown expiresAtMs={policy.expiresAtMs} /></div><Field label="Allowed pool" value={short(policy.allowedPool)} /><Field label="Owner" value={short(policy.owner)} /></div><div className="policy-actions"><a href={explorerObject(policy.objectId)} target="_blank" rel="noreferrer">View object ↗</a>{!policy.revoked && <><button disabled={busy} onClick={() => onUpdate(policy)}>Extend & update</button><button className="danger" disabled={busy} onClick={() => onRevoke(policy)}>Revoke</button></>}</div></div></div>)}</div></>;
}

void PolicyPageLegacy;

function PolicyPage({ policies, activePolicy, busy, onCreate, onUpdate, onRevoke }: {
  policies: GuardianPolicyRecord[];
  activePolicy: GuardianPolicyRecord | null;
  busy: boolean;
  onCreate: () => void;
  onUpdate: (policy: GuardianPolicyRecord) => void;
  onRevoke: (policy: GuardianPolicyRecord) => void;
}) {
  return <><div className="page-heading"><h1>Guardian Policy</h1><p className="page-sub">Your Move safety contract. Aegis must pass this object before any DeepBook swap can execute.</p></div>
    <div className={`policy-hero ${activePolicy ? "ready" : "blocked"}`}>
      <div><small>Policy enforcement</small><strong>{activePolicy ? "On-chain guard is active" : "Create a policy to unlock execution"}</strong><p>{activePolicy ? "Every PTB asserts owner, pool, direction, amount ceiling, slippage, expiry, and revocation state before swapping." : "Without an active GuardianPolicy, Aegis can parse and analyze but cannot execute a real swap."}</p></div>
      {!activePolicy && <button className="primary" disabled={busy} onClick={onCreate}>Create default 7-day policy</button>}
    </div>
    <div className="policy-summary-grid">
      <div><small>Active policy</small><b>{activePolicy ? short(activePolicy.objectId) : "None"}</b></div>
      <div><small>SUI ceiling</small><b>{activePolicy ? `${activePolicy.maxSuiInput} SUI` : "—"}</b></div>
      <div><small>DBUSDC ceiling</small><b>{activePolicy ? `${activePolicy.maxDbusdcInput} DBUSDC` : "—"}</b></div>
      <div><small>Max slippage</small><b>{activePolicy ? `${activePolicy.maxSlippageBps / 100}%` : "—"}</b></div>
    </div>
    <div className="policy-stack polished">{policies.length === 0 && <div className="card empty-policy"><div className="card-body"><b>No GuardianPolicy objects found.</b><p>Create one to make the hackathon flow executable on Sui testnet.</p></div></div>}{policies.map((policy) => {
      const status = policy.revoked ? "Revoked" : activePolicy?.objectId === policy.objectId ? "Active" : "Expired";
      return <article className="policy-card" key={policy.objectId}>
        <div className="policy-card-head">
          <div><small>GuardianPolicy object</small><h2>{short(policy.objectId)}</h2><code>{policy.objectId}</code></div>
          <span className={`pill ${policy.revoked ? "block" : activePolicy?.objectId === policy.objectId ? "clear" : "warn"}`}>{status}</span>
        </div>
        <div className="policy-rule-grid">
          <Field label="Owner" value={short(policy.owner)} />
          <Field label="Allowed pool" value={short(policy.allowedPool)} />
          <Field label="Max SUI input" value={`${policy.maxSuiInput} SUI`} />
          <Field label="Max DBUSDC input" value={`${policy.maxDbusdcInput} DBUSDC`} />
          <Field label="Max slippage" value={`${policy.maxSlippageBps} bps (${policy.maxSlippageBps / 100}%)`} />
          <div className="parsed-field"><small>Expiration</small><b>{new Date(policy.expiresAtMs).toLocaleString()}</b><PolicyExpiryCountdown expiresAtMs={policy.expiresAtMs} /></div>
        </div>
        <div className="policy-checklist">
          {["Owner must match connected wallet", "Pool must be SUI / DBUSDC", "Amount must stay under policy ceiling", "Revoked or expired policy blocks execution"].map((item) => <span key={item}>✓ {item}</span>)}
        </div>
        <div className="policy-actions">
          <a href={explorerObject(policy.objectId)} target="_blank" rel="noreferrer">Inspect policy on SuiScan ↗</a>
          <a href={explorerObject(policy.allowedPool)} target="_blank" rel="noreferrer">View allowed pool ↗</a>
          {!policy.revoked && <><button disabled={busy} onClick={() => onUpdate(policy)}>Extend & update policy</button><button className="danger" disabled={busy} onClick={() => onRevoke(policy)}>Revoke policy</button></>}
        </div>
      </article>;
    })}</div></>;
}

function AnalyticsPage({ receipts }: { receipts: ReceiptRecord[] }) {
  const average = receipts.length ? receipts.reduce((sum, row) => sum + row.guardianScore, 0) / receipts.length : 0;
  const suiVolume = receipts.filter((row) => row.direction === 0).reduce((sum, row) => sum + Number(row.inputAmount) / 1e9, 0);
  const dbusdcVolume = receipts.filter((row) => row.direction === 1).reduce((sum, row) => sum + Number(row.inputAmount) / 1e6, 0);
  const verdicts = {
    clear: receipts.filter((row) => (row.verdict || "clear") === "clear").length,
    warn: receipts.filter((row) => row.verdict === "warn").length,
    block: receipts.filter((row) => row.verdict === "block").length,
  };
  return <><div className="page-heading"><span>Real testnet telemetry</span><h1>Analytics</h1><p className="page-sub">Every number below is derived from this wallet&apos;s on-chain IntentExecuted events.</p></div><div className="metrics analytics-metrics">{[
    ["Total executions", String(receipts.length), "IntentExecuted events"],
    ["Average risk", average.toFixed(1), "deterministic score / 100"],
    ["SUI protected", `${suiVolume.toFixed(3)} SUI`, "real input volume"],
    ["DBUSDC protected", `${dbusdcVolume.toFixed(3)} DBUSDC`, "real input volume"],
  ].map(([label, value, detail]) => <div className="metric" key={label}><small>{label}</small><strong>{value}</strong><em>{detail}</em></div>)}</div>
    <div className="analytics-grid">
      <div className="card chart"><div className="card-header"><b>Guardian score history</b><small>Chronological · score / 100</small></div><div className="score-chart">{receipts.length ? receipts.slice().reverse().map((row, index) => <div className="score-column" key={row.digest}><span>{row.guardianScore}</span><i style={{ height: `${Math.max(12, row.guardianScore * 1.65)}px` }} className={row.guardianScore >= 70 ? "red" : row.guardianScore >= 40 ? "amber" : "green"} /><small>#{index + 1}</small></div>) : <p>No execution scores yet.</p>}</div><div className="chart-legend"><span><i className="green" />Clear 0–39</span><span><i className="amber" />Warn 40–69</span><span><i className="red" />Block 70+</span></div></div>
      <div className="card verdict-card"><div className="card-header"><b>Verdict distribution</b><small>Executed intents</small></div><div className="verdict-stats">{(["clear", "warn", "block"] as const).map((verdict) => <div key={verdict}><span className={`verdict-dot ${verdict}`} /><span><b>{verdicts[verdict]}</b><small>{verdict}</small></span><em>{receipts.length ? Math.round((verdicts[verdict] / receipts.length) * 100) : 0}%</em></div>)}</div></div>
    </div>
  </>;
}

function SettingsPage({ configured, activePolicy, address, balances, receiptCount }: { configured: boolean; activePolicy: GuardianPolicyRecord | null; address: string; balances: { sui: number; deep: number; dbusdc: number }; receiptCount: number }) {
  const rows = [
    ["Network", "Sui testnet", "Transactions sign with the connected testnet wallet.", true],
    ["Aegis Move package", executionConfig()?.packageId ?? "Not published/configured", "Policy assertion and receipt mint targets.", configured],
    ["DeepBook market", SUI_DBUSDC_POOL_ID, "Allowed SUI / DBUSDC execution pool.", true],
    ["OpenAI parser", "gpt-4o-mini · server-side", "Parses intent and explains immutable risk results.", true],
    ["GuardianPolicy", activePolicy?.objectId ?? "Not created", "On-chain limits enforced before every swap.", Boolean(activePolicy)],
    ["Execution gate", "Live quote · risk check · dry run · explicit confirmation", "All gates must pass before wallet signing.", true],
  ] as const;
  const readyCount = rows.filter((row) => row[3]).length;
  return <><div className="page-heading"><span>Deployment controls</span><h1>Settings & Readiness</h1><p className="page-sub">Inspectable configuration for the real Aegis testnet execution path.</p></div><div className={`readiness-banner ${readyCount === rows.length ? "ready" : "blocked"}`}><div><small>Execution readiness</small><strong>{readyCount}/{rows.length} systems ready</strong><span>{readyCount === rows.length ? "Aegis is ready to build and simulate guarded PTBs." : "Complete the blocked requirement before executing."}</span></div><span className={`pill ${readyCount === rows.length ? "clear" : "block"}`}>{readyCount === rows.length ? "READY" : "ACTION NEEDED"}</span></div>
    <div className="section-title"><span>01</span><div><b>Wallet state</b><small>Balances and proof count for the connected account.</small></div></div>
    <div className="settings-overview"><div className="card wallet-readiness"><div className="card-header"><b>Connected wallet</b><span className="pill clear">testnet</span></div><div className="card-body"><code>{address}</code><div className="balance-grid"><span><small>SUI balance</small><b>{balances.sui.toFixed(6)} SUI</b></span><span><small>DEEP fees</small><b>{balances.deep.toFixed(6)} DEEP</b></span><span><small>DBUSDC balance</small><b>{balances.dbusdc.toFixed(6)} DBUSDC</b></span><span><small>Verified receipts</small><b>{receiptCount}</b></span></div><a className="proof-primary-link" href={explorerObject(address)} target="_blank" rel="noreferrer">Inspect wallet on SuiScan ↗</a></div></div>
      <div className="card safety-gates"><div className="card-header"><b>Required execution gates</b><small>Enforced every time</small></div><div className="card-body">{["Connected testnet wallet", "Active non-revoked GuardianPolicy", "Live DeepBook market snapshot", "Deterministic Guardian verdict", "Successful PTB dry run", "Explicit user confirmation"].map((gate, index) => <div key={gate}><span>{index + 1}</span><b>{gate}</b><em>Required</em></div>)}</div></div>
    </div>
    <div className="section-title"><span>02</span><div><b>System configuration</b><small>Runtime targets that make this a real Sui testnet product.</small></div></div>
    <div className="settings-status">{rows.map(([label, value, detail, ready]) => <div className="card setting-status-card" key={label}><div className="card-body"><div><small>{label}</small><span className={`pill ${ready ? "clear" : "block"}`}>{ready ? "Ready" : "Blocked"}</span></div><code>{value}</code><p>{detail}</p>{label === "Aegis Move package" && configured && <a href={explorerObject(value)} target="_blank" rel="noreferrer">Inspect package ↗</a>}{label === "GuardianPolicy" && activePolicy && <a href={explorerObject(activePolicy.objectId)} target="_blank" rel="noreferrer">Inspect policy ↗</a>}{label === "DeepBook market" && <a href={explorerObject(SUI_DBUSDC_POOL_ID)} target="_blank" rel="noreferrer">Inspect pool ↗</a>}</div></div>)}</div></>;
}

function SidebarWalletCard({ address, balances, open, copied, onToggle, onCopy, onDisconnect }: {
  address: string;
  balances: { sui: number; deep: number; dbusdc: number };
  open: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDisconnect: () => void;
}) {
  return <div className="wallet-card sidebar-wallet">
    <button className="sidebar-wallet-trigger" onClick={onToggle} aria-expanded={open} aria-label={open ? "Close wallet menu" : "Manage connected wallet"}>
      <span><code>{short(address)}</code><small><i /> testnet</small></span>
      <b>{open ? "Close" : "Manage"}</b>
    </button>
    <div className="balance-line"><span>{balances.sui.toFixed(3)} SUI</span><span>{balances.deep.toFixed(3)} DEEP</span></div>
    {open && <div className="sidebar-wallet-dropdown">
      <small>Connected wallet</small>
      <code>{address}</code>
      <button onClick={onCopy}>{copied ? "Address copied" : "Copy address"}</button>
      <a href={explorerObject(address)} target="_blank" rel="noreferrer">Open wallet on SuiScan ↗</a>
      <button className="dropdown-disconnect" onClick={onDisconnect}>Disconnect wallet</button>
    </div>}
  </div>;
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
  const [stressScenario, setStressScenario] = useState<StressScenario>("block");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [digest, setDigest] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [successDigest, setSuccessDigest] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectionStatus === "disconnected") router.replace("/");
  }, [connectionStatus, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!successDigest) return;
    const hideTimer = window.setTimeout(() => setSuccessDigest(""), 5_000);
    return () => window.clearTimeout(hideTimer);
  }, [successDigest]);

  const executionGate = executionBlockReason(plan, chain.activePolicy, clockNow);
  const balanceGate = balanceBlockReason(plan, chain.balances);
  const planStale = Boolean(plan && !isPlanFresh(plan, clockNow));
  const canExecute = Boolean(plan && simulation?.success && guardian?.canExecute && !stress && !executionGate && !balanceGate && (guardian.verdict !== "warn" || ack));
  const setupReady = chain.balances.sui > 0 && chain.balances.deep >= 0.05 && Boolean(chain.activePolicy);
  const activeNav = useMemo(() => nav.find(([id]) => id === page), [page]);

  async function disconnectAndExit() {
    await disconnect.mutateAsync();
    router.replace("/");
  }

  function invalidateExecutionState() {
    setGuardian(null);
    setPlan(null);
    setSimulation(null);
    setAck(false);
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
          if (after) setSuccessDigest(result.digest);
          chain.refresh();
          invalidateExecutionState();
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
      if (quote.alreadyReady) {
        chain.refresh();
        setError("");
        return;
      }
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

  async function runGuardian(nextIntent: ParsedIntent) {
    if (!account) return;
    setBusy(true);
    setError("");
    setDigest("");
    setAck(false);
    setPlan(null);
    setSimulation(null);
    try {
      const guardianResponse = await fetch("/api/guardian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: nextIntent, stress, stressScenario }) });
      const checked: GuardianResult = await guardianResponse.json();
      if (!guardianResponse.ok) throw new Error("Guardian analysis failed.");
      setGuardian(checked);
      if (!checked.canExecute || stress) return;
      if (!chain.activePolicy) throw new Error("Create an active GuardianPolicy before generating an executable PTB.");
      const nextPlan = createExecutionPlan(nextIntent, checked, chain.activePolicy.objectId);
      const nextSimulation = await simulateTransaction(buildIntentTransaction(account.address, nextPlan), account.address);
      setPlan(nextPlan);
      setSimulation(nextSimulation);
      if (!nextSimulation.success) setError(friendlyTxError(nextSimulation.error));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to process intent.");
    } finally {
      setBusy(false);
    }
  }

  async function parseAndGuard() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      const parsedResponse = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const parsed = await parsedResponse.json();
      if (!parsedResponse.ok || parsed.error) throw new Error(parsed.error ?? "Intent parsing failed.");
      setIntent(parsed.intent);
      await runGuardian(parsed.intent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to process intent.");
      setBusy(false);
    }
  }

  function rerunGuardian() {
    if (!intent) return;
    void runGuardian(intent);
  }

  function selectStressScenario(scenario: StressScenario) {
    setStressScenario(scenario);
    invalidateExecutionState();
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

  if (connectionStatus !== "connected" || !account) return <div className="wallet-gate"><b>Aegis</b><small>Checking Sui wallet connection...</small><small>Disconnected users are redirected to the landing page.</small></div>;

  return <div className="dashboard">
    <aside className="sidebar"><Logo /><div className="sidebar-section"><small>Main</small>{nav.slice(0, 3).map(([id, icon, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</div><div className="sidebar-section"><small>Manage</small>{nav.slice(3).map(([id, icon, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{icon}</span>{label}</button>)}</div><div className="sidebar-section resources"><small>Resources</small><a href="https://docs.sui.io/" target="_blank">📖 Sui Docs</a><a href="https://suiexplorer.com/?network=testnet" target="_blank">🔍 Explorer ↗</a></div><SidebarWalletCard address={account.address} balances={chain.balances} open={walletOpen} copied={copied} onToggle={() => setWalletOpen(!walletOpen)} onCopy={async () => { await navigator.clipboard.writeText(account.address); setCopied(true); }} onDisconnect={disconnectAndExit} /></aside>
    <main className="dash-main"><header className="dash-top"><b>{activeNav?.[1]} {activeNav?.[2]}</b><div><button title="Deterministic non-executable data for risk demonstrations." className={stress ? "stress active" : "stress"} onClick={() => { setStress(!stress); invalidateExecutionState(); }}>🧪 Stress Mode {stress && <span>ACTIVE</span>}</button></div></header>{stress && <div className="stress-banner"><span>🧪 <b>Stress mode active</b> — deterministic demonstration data. Signing and execution are disabled.</span><div className="stress-scenarios">{(["clear", "warn", "block"] as StressScenario[]).map((scenario) => <button key={scenario} className={stressScenario === scenario ? `active ${scenario}` : ""} onClick={() => selectStressScenario(scenario)}>{scenario}</button>)}</div></div>}
      <section className="page">
        {chain.error && <div className="error page-error">{chain.error}</div>}
        {error && <div className="error page-error">{error}</div>}
        {successDigest && <div className="success-toast"><span><b>Execution confirmed</b><small>IntentReceipt flow completed on Sui testnet.</small></span><a href={explorerTx(successDigest)} target="_blank" rel="noreferrer">Open transaction ↗</a></div>}
        {page === "history" && <><div className="page-heading"><h1>Transaction History</h1><p className="page-sub">Transaction-first timeline. Click a row to verify the swap transaction and related objects.</p></div><ProofList receipts={chain.receipts} mode="history" /></>}
        {page === "receipts" && <><div className="page-heading"><h1>My IntentReceipts</h1><p className="page-sub">Receipt-first proof objects. Click a row to inspect the minted IntentReceipt object and its source transaction.</p></div><ProofList receipts={chain.receipts} mode="receipts" /></>}
        {page === "analytics" && <AnalyticsPage receipts={chain.receipts} />}
        {page === "policy" && <PolicyPage policies={chain.policies} activePolicy={chain.activePolicy} busy={busy || signer.isPending} onCreate={createPolicy} onUpdate={updatePolicy} onRevoke={revokePolicy} />}
        {page === "settings" && <SettingsPage configured={chain.configured} activePolicy={chain.activePolicy} address={account.address} balances={chain.balances} receiptCount={chain.receipts.length} />}
        {page === "swap" && <><div className="intent-intro"><h1>New Intent</h1><p className="page-sub">Describe a financial goal. Aegis compiles, checks, simulates, and asks before signing.</p></div>{!setupReady && <SetupPanel balances={chain.balances} activePolicy={chain.activePolicy} busy={busy || signer.isPending} onFaucet={requestFaucet} onDeep={prepareDeepBootstrap} onPolicy={createPolicy} />}<div className={`swap-layout ${guardian ? "has-results" : "intent-only"}`}><div className="column"><div className="card"><div className="card-header"><b>Your Intent</b><small>SUI ↔ DBUSDC</small></div><div className="card-body"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Swap 1 SUI to DBUSDC with max 1% slippage" /><div className="chips">{samples.map((sample) => <button key={sample} onClick={() => setText(sample)}>{sample}</button>)}</div><button className="primary" onClick={parseAndGuard} disabled={busy}>{busy ? "Building guarded PTB preview..." : "Parse Intent & Preview Swap"}</button></div></div>{intent && <div className="card"><div className="card-header"><b>Parsed Intent</b><span className="pill clear">Validated</span></div><div className="card-body parsed-grid"><Field label="Input Asset" value={intent.inputAsset} /><Field label="Output Asset" value={intent.outputAsset} /><Field label="Amount" value={`${intent.amount} ${intent.inputAsset}`} /><Field label="Max Slippage" value={`${intent.maxSlippageBps / 100}%`} /><Field label="Risk Tolerance" value={intent.riskTolerance} /></div></div>}</div><div className="column">{guardian && <><div className="card"><div className="card-header"><b>Aegis Analysis</b><span className={`pill ${guardian.verdict}`}>{guardian.verdict.toUpperCase()} · {guardian.dataMode}</span></div><div className="card-body"><div className="score"><strong className={guardian.verdict}>{guardian.score}</strong><span><b>Deterministic risk score</b><small>0 clear · 40 warn · 70 block</small><i><em style={{ width: `${guardian.score}%` }} /></i></span></div><div className={`verdict ${guardian.verdict}`}>{guardian.verdict === "clear" ? "Safe to prepare" : guardian.verdict === "warn" ? "Risks detected; acknowledgement required" : "Execution blocked"}</div><RiskRows result={guardian} /><p className={`guardian-message ${guardian.verdict}`}>{guardian.explanation}</p></div></div>{plan && <div className="card"><div className="card-header"><b>Human-readable PTB Preview</b><small>fresh for 60 seconds</small></div><div className="card-body parsed-grid"><Field label="Policy" value={short(plan.policyId)} /><Field label="Pool" value={short(plan.poolId)} /><Field label="Expected output" value={`${guardian.expectedOutput.toFixed(6)} ${plan.outputAsset}`} /><Field label="Minimum output" value={`${plan.minOutput.toFixed(6)} ${plan.outputAsset}`} /><Field label="DEEP fee budget" value={plan.deepBudget.toFixed(6)} /><Field label="Snapshot" value={new Date(plan.createdAt).toLocaleTimeString()} /></div><div className="ptb">{[["Assert GuardianPolicy", "Move"], [`DeepBook swap ${plan.amount} ${plan.inputAsset}`, "DeepBook"], ["Mint IntentReceipt", "Move"]].map(([label, protocol], index) => <div key={label}><span>{index + 1}</span><b>{label}</b><em>{protocol}</em></div>)}</div><div className="atomic">Atomic: all three calls succeed together or the transaction reverts.</div><div className="confirm">{simulation && <div className={`verdict ${simulation.success ? "clear" : "block"}`}>{simulation.success ? `Dry run passed · gas ${simulation.gasEstimate}` : friendlyTxError(simulation.error)}</div>}{executionGate && <div className="verdict block">{executionGate}</div>}{balanceGate && <div className="verdict block">{balanceGate}</div>}{planStale && <button className="secondary-action" disabled={busy} onClick={rerunGuardian}>Re-run Guardian with live data</button>}{guardian.verdict === "warn" && <label><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I understand the identified Aegis risks.</label>}<button className={canExecute ? "primary" : "disabled"} disabled={!canExecute || busy || signer.isPending} onClick={prepareExecution}>{canExecute ? "Review & Sign Atomic PTB" : "Execution gate not satisfied"}</button></div></div>}{digest && <div className="receipt"><b>Transaction executed and IntentReceipt minted</b><code>{digest}</code><a href={explorerTx(digest)} target="_blank" rel="noreferrer">Verify on SuiScan ↗</a></div>}</>}</div></div></>}
      </section>
    </main>
    {pendingAction && <div className="modal-backdrop"><div className="confirm-modal"><small>Wallet confirmation</small><h2>{pendingAction.title}</h2><p>{pendingAction.detail}</p><div><button onClick={() => setPendingAction(null)} disabled={busy || signer.isPending}>Cancel</button><button className="primary" onClick={pendingAction.run} disabled={busy || signer.isPending}>{busy || signer.isPending ? "Awaiting wallet..." : "Confirm in wallet"}</button></div></div></div>}
  </div>;
}
