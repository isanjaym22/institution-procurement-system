import { useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react";
import { createRequisition, type User } from "@/lib/api";
import { Card, CardBody, CardDescription, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/field";
import { Notice } from "./ui/feedback";

export function NewRequisition({
  token,
  user,
  onCreated,
}: {
  token: string;
  user: User;
  onCreated: () => void;
}) {
  const [itemName, setItemName] = useState("");
  const [spec, setSpec] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("NON_LAB");
  const [justification, setJustification] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await createRequisition(token, {
        category,
        justification,
        items: [
          {
            item_name: itemName,
            specification: spec,
            quantity: Number(qty),
            tentative_unit_price: price,
          },
        ],
      });
      setItemName("");
      setSpec("");
      setQty(1);
      setPrice("");
      setJustification("");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2">
          <Plus size={20} className="text-brand-700" aria-hidden="true" />
          <CardTitle>New Requisition</CardTitle>
        </div>
        <CardDescription>
          Draft a purchase request for your department. It goes to your HOD
          first — you can submit it from the queue below.
        </CardDescription>
        <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
          <span className="font-medium text-slate-800">{user.name}</span>
          {user.employee_id ? ` · ${user.employee_id}` : ""}
          {user.designation ? ` · ${user.designation}` : ""}
          <br />
          Department is taken automatically from your account.
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Item name" id="nr-item" required>
              <Input
                id="nr-item"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                required
              />
            </Field>
            <Field label="Category" id="nr-cat" required>
              <Select
                id="nr-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="LAB">Lab</option>
                <option value="NON_LAB">Non-Lab</option>
              </Select>
            </Field>
          </div>
          <Field label="Detailed specification" id="nr-spec" required>
            <Input
              id="nr-spec"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" id="nr-qty" required>
              <Input
                id="nr-qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                required
              />
            </Field>
            <Field label="Tentative unit price (₹)" id="nr-price" required>
              <Input
                id="nr-price"
                type="number"
                min={0.01}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Justification" id="nr-just" required>
            <Textarea
              id="nr-just"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why is this purchase needed?"
              required
            />
          </Field>
          {err && <Notice tone="error">{err}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Draft"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
