import { describe, expect, it } from "vitest";
import {
  availableDoctorActions,
  generatePublicCode,
  jumpedSerials,
  nextToCall,
  nowServing,
  parseBulkList,
  peopleAhead,
  requeueOrder,
  sessionTransition,
  waitingInOrder,
  type QueueToken,
} from "@/lib/queue";
import type { TokenStatus } from "@/generated/prisma/enums";

/** t(serial, status, queueOrder = serial) */
const t = (serial: number, status: TokenStatus = "WAITING", queueOrder = serial): QueueToken => ({
  id: `t${serial}`,
  serial,
  status,
  queueOrder,
});

describe("next / now serving", () => {
  it("calls the lowest queue position among WAITING", () => {
    const tokens = [t(3), t(1, "DONE"), t(2), t(4, "SKIPPED")];
    expect(nextToCall(tokens)?.serial).toBe(2);
  });

  it("breaks queueOrder ties by serial", () => {
    expect(nextToCall([t(9, "WAITING", 5), t(5)])?.serial).toBe(5);
  });

  it("respects re-queued order before serial", () => {
    // serial 7 was re-queued after the current patient (queueOrder 1 < 2)
    expect(waitingInOrder([t(2), t(3), t(7, "WAITING", 1)]).map((x) => x.serial)).toEqual([7, 2, 3]);
  });

  it("returns nothing when no one waits", () => {
    expect(nextToCall([t(1, "DONE"), t(2, "NO_SHOW")])).toBeUndefined();
  });

  it("finds the patient inside", () => {
    expect(nowServing([t(1, "DONE"), t(2, "IN_CONSULT"), t(3)])?.serial).toBe(2);
    expect(nowServing([t(1, "CALLED")])?.serial).toBe(1);
    expect(nowServing([t(1)])).toBeUndefined();
  });
});

describe("jumpedSerials (out-of-order detection)", () => {
  const tokens = [t(1, "DONE"), t(2, "CALLED"), t(3), t(4), t(5), t(6, "SKIPPED")];
  it("is empty for the next patient", () => {
    expect(jumpedSerials(tokens[2], tokens)).toEqual([]);
  });
  it("lists waiting patients skipped over", () => {
    expect(jumpedSerials(tokens[4], tokens)).toEqual([3, 4]);
  });
  it("ignores skipped / no-show patients", () => {
    expect(jumpedSerials(t(7), [...tokens, t(7)])).toEqual([3, 4, 5]);
  });
});

describe("peopleAhead", () => {
  it("counts waiting ahead plus the patient inside", () => {
    const tokens = [t(1, "DONE"), t(2, "IN_CONSULT"), t(3), t(4), t(5)];
    expect(peopleAhead(tokens[2], tokens)).toBe(1); // you're next
    expect(peopleAhead(tokens[4], tokens)).toBe(3);
  });
  it("doesn't count an empty room", () => {
    const tokens = [t(1, "DONE"), t(2), t(3)];
    expect(peopleAhead(tokens[1], tokens)).toBe(0);
    expect(peopleAhead(tokens[2], tokens)).toBe(1);
  });
  it("is 0 for anyone not waiting", () => {
    expect(peopleAhead(t(1, "CALLED"), [t(1, "CALLED")])).toBe(0);
  });
});

describe("requeueOrder", () => {
  const tokens = [t(1, "DONE"), t(2, "CALLED"), t(3), t(4), t(5, "NO_SHOW")];
  it("after current → ahead of every waiting token", () => {
    const order = requeueOrder("AFTER_CURRENT", tokens);
    expect(order).toBeLessThan(3);
    const back = { ...tokens[4], status: "WAITING" as const, queueOrder: order };
    expect(nextToCall([...tokens.slice(0, 4), back])?.serial).toBe(5);
  });
  it("at end → after everyone, including later bookings so far", () => {
    expect(requeueOrder("AT_END", tokens)).toBe(6);
  });
  it("after current with nobody waiting → simply next", () => {
    const order = requeueOrder("AFTER_CURRENT", [t(1, "DONE"), t(2, "NO_SHOW")]);
    expect(order).toBe(3);
  });
});

describe("session transitions", () => {
  it("allows the normal flow", () => {
    expect(sessionTransition("ARRIVED", "NOT_STARTED")).toBe("DOCTOR_ARRIVED");
    expect(sessionTransition("BREAK", "RUNNING")).toBe("ON_BREAK");
    expect(sessionTransition("RESUME", "ON_BREAK")).toBe("RUNNING");
    expect(sessionTransition("END", "RUNNING")).toBe("ENDED");
  });
  it("rejects nonsense", () => {
    expect(sessionTransition("ARRIVED", "RUNNING")).toBeNull();
    expect(sessionTransition("RESUME", "RUNNING")).toBeNull();
    expect(sessionTransition("END", "ENDED")).toBeNull();
    expect(sessionTransition("BREAK", "CANCELLED")).toBeNull();
  });
  it("lists the buttons to show", () => {
    expect(availableDoctorActions("NOT_STARTED")).toEqual(["ARRIVED", "END"]);
    expect(availableDoctorActions("RUNNING")).toEqual(["BREAK", "END"]);
    expect(availableDoctorActions("ON_BREAK")).toEqual(["RESUME", "END"]);
    expect(availableDoctorActions("ENDED")).toEqual([]);
  });
});

describe("parseBulkList", () => {
  it("reads serial, name and phone in many shapes", () => {
    const { patients, errors } = parseBulkList(
      [
        "১২. রহিম উদ্দিন ০১৭১১-০০০০০০",
        "13) Karim Mia, +88 01811 222333",
        "আয়েশা বেগম",
        "  ",
        "15 সালমা 01911000000",
        "রাজু 017 1122 3344",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(patients).toEqual([
      { line: 1, serial: 12, name: "রহিম উদ্দিন", phone: "8801711000000" },
      { line: 2, serial: 13, name: "Karim Mia", phone: "8801811222333" },
      { line: 3, serial: undefined, name: "আয়েশা বেগম", phone: null },
      { line: 5, serial: 15, name: "সালমা", phone: "8801911000000" },
      { line: 6, serial: undefined, name: "রাজু", phone: "8801711223344" },
    ]);
  });

  it("reports lines without a name and duplicate serials", () => {
    const { patients, errors } = parseBulkList("5 রহিম\n5 করিম\n01711000000\n7.");
    expect(patients).toHaveLength(1);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [2, "DUPLICATE_SERIAL"],
      [3, "NO_NAME"],
      [4, "NO_NAME"],
    ]);
  });
});

describe("generatePublicCode", () => {
  it("is 10 chars from the no-look-alike alphabet", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generatePublicCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(/^[2-9a-hj-km-np-zA-HJ-NP-Z]{10}$/);
  });
});
