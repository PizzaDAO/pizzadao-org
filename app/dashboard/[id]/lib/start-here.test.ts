import { describe, it, expect } from "vitest";
import { startHereMission } from "./start-here";

describe("startHereMission", () => {
  it("treats a sent-back mission as to do", () => {
    expect(startHereMission([{ id: 1, title: "A", state: "done" }, { id: 2, title: "B", state: "todo" }])).toEqual({ state: "todo", id: 2, title: "B" });
  });
  it("is pending when everything is submitted and one is in review", () => {
    expect(startHereMission([{ id: 1, title: "A", state: "done" }, { id: 2, title: "B", state: "pending" }])).toEqual({ state: "pending" });
  });
  it("is done only when all are approved", () => {
    expect(startHereMission([{ id: 1, title: "A", state: "done" }])).toEqual({ state: "done" });
  });
});
