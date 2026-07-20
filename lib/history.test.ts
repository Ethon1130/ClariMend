import { describe, expect, it } from "vitest";
import { commitHistory, createHistory, redoHistory, undoHistory } from "./history";

describe("history", () => {
  it("undoes and redoes in order", () => {
    let history = createHistory(0);
    history = commitHistory(history, 1);
    history = commitHistory(history, 2);
    history = undoHistory(history);
    expect(history.present).toBe(1);
    history = redoHistory(history);
    expect(history.present).toBe(2);
  });

  it("keeps at most fifty prior actions and clears redo after a new action", () => {
    let history = createHistory(0);
    for (let value = 1; value <= 60; value += 1) history = commitHistory(history, value);
    expect(history.past).toHaveLength(50);
    history = undoHistory(history);
    history = commitHistory(history, 99);
    expect(history.future).toHaveLength(0);
  });
});
