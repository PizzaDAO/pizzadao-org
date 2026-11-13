// Drift guard: the keys each form emits are what the rsv-pizza PDF service reads.
// If this snapshot changes, the backend contract changed: update rsv-pizza and these forms together.
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { W9Form } from "../_components/W9Form";
import { W8BENForm } from "../_components/W8BENForm";
import { W8BENEForm } from "../_components/W8BENEForm";

function fillAll(Form: React.ComponentType<any>, initial: Record<string, any> = {}) {
  const latest: { current: Record<string, any> } = { current: {} };
  const Wrapper = () => {
    const [v, setV] = useState<Record<string, any>>(initial);
    const onChange = (n: Record<string, any>) => {
      latest.current = n;
      setV(n);
    };
    return <Form value={v} onChange={onChange} onSwitchFormType={() => {}} />;
  };
  const { container } = render(<Wrapper />);
  const fields = Array.from(container.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea"));
  for (const el of fields) {
    const input = el as HTMLInputElement;
    fireEvent.change(input, { target: { value: input.type === "date" ? "2026-01-01" : "x" } });
  }
  return Object.keys(latest.current).sort();
}

describe("form emitted keys", () => {
  // W-9 hides name/address/TIN until a classification is picked, so start from "individual".
  it("W9", () => expect(fillAll(W9Form, { taxClassification: "individual" })).toMatchSnapshot());
  it("W8BEN", () => expect(fillAll(W8BENForm)).toMatchSnapshot());
  it("W8BEN-E", () => expect(fillAll(W8BENEForm)).toMatchSnapshot());
});
