import { useMemo, useState } from "react";
import { CheckCircle, FilePlus, Plus, Trash } from "@phosphor-icons/react";
import { createReq, type Req } from "../lib/api";
import { formatINR } from "../lib/workflow";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

interface ItemRow {
  item_name: string;
  specification: string;
  quantity: string;
  tentative_unit_price: string;
}

const EMPTY_ROW: ItemRow = {
  item_name: "",
  specification: "",
  quantity: "1",
  tentative_unit_price: "",
};

function rowTotal(r: ItemRow): number {
  const q = Number(r.quantity);
  const p = Number(r.tentative_unit_price);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return q * p;
}

export default function NewRequisition({
  token,
  onCreated,
}: {
  token: string;
  onCreated: (r: Req) => void;
}) {
  const [category, setCategory] = useState("LAB");
  const [justification, setJustification] = useState("");
  const [amc, setAmc] = useState<"yes" | "no">("no");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Req | null>(null);

  const total = useMemo(() => items.reduce((s, r) => s + rowTotal(r), 0), [items]);

  function setRow(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    if (justification.trim().length < 5) {
      setError("Justification must be at least 5 characters.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one item.");
      return;
    }
    for (const [i, r] of items.entries()) {
      if (!r.item_name.trim() || !r.specification.trim()) {
        setError(`Item ${i + 1}: name and specification are required.`);
        return;
      }
      if (!Number.isInteger(Number(r.quantity)) || Number(r.quantity) <= 0) {
        setError(`Item ${i + 1}: quantity must be a positive whole number.`);
        return;
      }
      if (!Number.isFinite(Number(r.tentative_unit_price)) || Number(r.tentative_unit_price) <= 0) {
        setError(`Item ${i + 1}: unit price must be a positive number.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const req = await createReq(token, {
        category,
        justification: justification.trim(),
        amc_preference: amc === "yes",
        items: items.map((r) => ({
          item_name: r.item_name.trim(),
          specification: r.specification.trim(),
          quantity: Number(r.quantity),
          tentative_unit_price: Number(r.tentative_unit_price),
        })),
      });
      setCreated(req);
      onCreated(req);
      setJustification("");
      setAmc("no");
      setItems([{ ...EMPTY_ROW }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create requisition");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <FilePlus size={18} /> New requisition
          </span>
        </CardTitle>
        <CardDescription>
          Draft a purchase request. Submitting routes it to HOD review, or
          straight to the Principal for HOD/Office-originated requests.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {created && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-success">
            <CheckCircle size={16} /> Created {created.procurement_id} as a draft — submit it from your queue.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="nr-category" className="text-sm font-medium text-zinc-700">
                Category
              </label>
              <Select
                id="nr-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="LAB">LAB</option>
                <option value="NON_LAB">NON_LAB</option>
              </Select>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-zinc-700">AMC preference</legend>
              <div className="flex h-10 items-center gap-4">
                {(["yes", "no"] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-1.5 text-sm text-zinc-700">
                    <input
                      type="radio"
                      name="nr-amc"
                      value={v}
                      checked={amc === v}
                      onChange={() => setAmc(v)}
                      className="accent-[#1e3a5f]"
                    />
                    {v === "yes" ? "Yes" : "No"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="nr-just" className="text-sm font-medium text-zinc-700">
              Justification
            </label>
            <Textarea
              id="nr-just"
              rows={3}
              placeholder="Why is this purchase needed?"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-zinc-700">Items</p>
            {items.map((r, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Item name"
                    aria-label={`Item ${i + 1} name`}
                    value={r.item_name}
                    onChange={(e) => setRow(i, { item_name: e.target.value })}
                  />
                  <Input
                    placeholder="Specification"
                    aria-label={`Item ${i + 1} specification`}
                    value={r.specification}
                    onChange={(e) => setRow(i, { specification: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="Qty"
                    aria-label={`Item ${i + 1} quantity`}
                    value={r.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Unit price (₹)"
                    aria-label={`Item ${i + 1} unit price`}
                    value={r.tentative_unit_price}
                    onChange={(e) => setRow(i, { tentative_unit_price: e.target.value })}
                  />
                  <div className="col-span-2 flex items-center justify-between sm:col-span-1">
                    <span className="text-xs text-zinc-500">{formatINR(rowTotal(r))}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove item ${i + 1}`}
                      disabled={items.length <= 1}
                      onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ROW }])}
              >
                <Plus size={16} /> Add item
              </Button>
              <p className="text-sm text-zinc-700">
                Estimated total: <strong>{formatINR(total)}</strong>
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create requisition"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
