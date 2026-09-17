'use client';

import { useState, useTransition } from 'react';
import type { Policy } from '@reconcile/domain';
import { discardPolicyDraft, publishPolicy, savePolicyDraft } from '../lib/actions';

interface Row {
  ruleId: string;
  priceId: string;
  capabilities: string[];
}

export function PolicyEditor({
  initial,
  capabilities,
  defaultVersion,
}: {
  initial: Policy;
  capabilities: string[];
  defaultVersion: string;
}) {
  const [pending, start] = useTransition();
  const [version, setVersion] = useState(defaultVersion);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>(initial.priceMappings.map((m) => ({ ...m })));
  const [grace, setGrace] = useState(String(initial.lifecycle.pastDueGraceHours));
  const [trial, setTrial] = useState(initial.lifecycle.trialGrantsAccess);
  const [fresh, setFresh] = useState(String(initial.freshness.maxEvidenceAgeMinutes));
  const [msg, setMsg] = useState<string | null>(null);

  function toPolicy(): Policy {
    return {
      version,
      capabilities,
      priceMappings: rows.filter((r) => r.priceId.trim() !== ''),
      lifecycle: { pastDueGraceHours: Number(grace), trialGrantsAccess: trial },
      freshness: { maxEvidenceAgeMinutes: Number(fresh) },
    };
  }

  const input = 'w-full rounded border px-1 py-0.5 text-xs font-mono';

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500">
            <th>rule</th>
            <th>price</th>
            {capabilities.map((c) => (
              <th key={c} className="font-mono">{c}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-1 pr-2">
                <input
                  className={input}
                  value={r.ruleId}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, ruleId: e.target.value } : x)))
                  }
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  className={input}
                  value={r.priceId}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, priceId: e.target.value } : x)))
                  }
                />
              </td>
              {capabilities.map((c) => (
                <td key={c} className="py-1 text-center">
                  <input
                    type="checkbox"
                    checked={r.capabilities.includes(c)}
                    onChange={(e) =>
                      setRows(
                        rows.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                capabilities: e.target.checked
                                  ? [...x.capabilities, c]
                                  : x.capabilities.filter((k) => k !== c),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
              ))}
              <td className="py-1">
                <button
                  className="text-xs text-red-600"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="mt-2 rounded border px-2 py-0.5 text-xs"
        onClick={() => setRows([...rows, { ruleId: 'plan:new', priceId: '', capabilities: [] }])}
      >
        add mapping
      </button>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <label>
          pastDueGraceHours
          <input className={input} value={grace} onChange={(e) => setGrace(e.target.value)} />
        </label>
        <label>
          maxEvidenceAgeMinutes
          <input className={input} value={fresh} onChange={(e) => setFresh(e.target.value)} />
        </label>
        <label className="flex items-end gap-1">
          <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
          trialGrantsAccess
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <label>
          version
          <input className={input} value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label>
          note
          <input
            className={input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="publish note"
          />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          className="rounded border px-3 py-1 text-sm"
          onClick={() => start(async () => { setMsg(null); await savePolicyDraft(toPolicy()); setMsg('draft saved'); })}
        >
          Save draft
        </button>
        <button
          disabled={pending}
          className="rounded border px-3 py-1 text-sm"
          onClick={() => start(async () => { setMsg(null); await discardPolicyDraft(); setMsg('draft discarded'); })}
        >
          Discard draft
        </button>
        <button
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
          onClick={() =>
            start(async () => {
              setMsg(null);
              await savePolicyDraft(toPolicy());
              const res = await publishPolicy(note);
              setMsg(res.ok ? `published` : `publish refused: ${res.error}`);
            })
          }
        >
          Publish
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
    </div>
  );
}
