"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";
import { DBUSDC_TYPE, DEEP_TYPE, SUI_TYPE } from "@/lib/transaction";

export interface GuardianPolicyRecord {
  objectId: string;
  owner: string;
  maxSuiInput: number;
  maxDbusdcInput: number;
  maxSlippageBps: number;
  allowedPool: string;
  expiresAtMs: number;
  revoked: boolean;
}

export interface ReceiptRecord {
  receiptId: string;
  digest: string;
  policyId: string;
  pool: string;
  direction: number;
  inputAmount: string;
  minOutput: string;
  guardianScore: number;
  verdict: string;
  timestamp: number;
}

type MoveFields = Record<string, unknown>;
const asFields = (value: unknown) => value as MoveFields;
const idValue = (value: unknown) => {
  if (typeof value === "string") return value;
  const fields = asFields(value);
  return String(fields.id ?? fields.bytes ?? "");
};
const textValue = (value: unknown) => {
  if (typeof value === "string") return value;
  const fields = asFields(value);
  return String(fields.bytes ?? fields.value ?? "");
};

export function useAegisChainData() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const address = account?.address;
  const packageId = process.env.NEXT_PUBLIC_GUARDIAN_PACKAGE_ID;
  const [policies, setPolicies] = useState<GuardianPolicyRecord[]>([]);
  const [activePolicy, setActivePolicy] = useState<GuardianPolicyRecord | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [balances, setBalances] = useState({ sui: 0, deep: 0, dbusdc: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function load() {
      await Promise.resolve();
      if (cancelled || !address) return;
      setLoading(true);
      setError("");
      try {
        const [sui, deep, dbusdc] = await Promise.all([
          client.getBalance({ owner: address, coinType: SUI_TYPE }),
          client.getBalance({ owner: address, coinType: DEEP_TYPE }),
          client.getBalance({ owner: address, coinType: DBUSDC_TYPE }),
        ]);
        if (cancelled) return;
        setBalances({
          sui: Number(sui.totalBalance) / 1e9,
          deep: Number(deep.totalBalance) / 1e6,
          dbusdc: Number(dbusdc.totalBalance) / 1e6,
        });

        if (!packageId) {
          setPolicies([]);
          setActivePolicy(null);
          setReceipts([]);
          return;
        }

        const [ownedPolicies, ownedReceipts, events] = await Promise.all([
          client.getOwnedObjects({
            owner: address,
            filter: { StructType: `${packageId}::guardian::GuardianPolicy` },
            options: { showContent: true, showType: true },
          }),
          client.getOwnedObjects({
            owner: address,
            filter: { StructType: `${packageId}::guardian::IntentReceipt` },
            options: { showContent: true, showType: true },
          }),
          client.queryEvents({ query: { MoveEventType: `${packageId}::guardian::IntentExecuted` }, limit: 100, order: "descending" }),
        ]);
        if (cancelled) return;

        const nextPolicies = ownedPolicies.data.flatMap((entry) => {
          if (entry.data?.content?.dataType !== "moveObject") return [];
          const fields = asFields(entry.data.content.fields);
          return [{
            objectId: entry.data.objectId,
            owner: String(fields.owner ?? ""),
            maxSuiInput: Number(fields.max_sui_input ?? 0) / 1e9,
            maxDbusdcInput: Number(fields.max_dbusdc_input ?? 0) / 1e6,
            maxSlippageBps: Number(fields.max_slippage_bps ?? 0),
            allowedPool: idValue(fields.allowed_pool),
            expiresAtMs: Number(fields.expires_at_ms ?? 0),
            revoked: Boolean(fields.revoked),
          }];
        });
        setPolicies(nextPolicies);
        const now = Date.now();
        setActivePolicy(nextPolicies.find((policy) => !policy.revoked && policy.expiresAtMs > now) ?? null);

        const receiptIds = new Set(ownedReceipts.data.map((entry) => entry.data?.objectId).filter(Boolean));
        setReceipts(events.data.flatMap((event) => {
          const fields = asFields(event.parsedJson);
          if (String(fields.executor ?? "") !== address) return [];
          const receiptId = idValue(fields.receipt_id);
          if (receiptIds.size && !receiptIds.has(receiptId)) return [];
          return [{
            receiptId,
            digest: event.id.txDigest,
            policyId: idValue(fields.policy_id),
            pool: idValue(fields.pool),
            direction: Number(fields.direction ?? 0),
            inputAmount: String(fields.input_amount ?? "0"),
            minOutput: String(fields.min_output ?? "0"),
            guardianScore: Number(fields.guardian_score ?? 0),
            verdict: textValue(fields.verdict),
            timestamp: Number(fields.executed_at_ms ?? event.timestampMs ?? 0),
          }];
        }));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load Sui testnet data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [address, client, packageId, refreshKey]);

  return {
    policies,
    activePolicy,
    receipts,
    balances,
    loading,
    error,
    configured: Boolean(packageId),
    refresh,
  };
}
