import { describe, expect, it } from "vitest";
import { patientLink, renderSms, smsSegments } from "@/lib/sms-text";

describe("smsSegments", () => {
  it("counts plain text as GSM-7 (160 / 153)", () => {
    expect(smsSegments("Hello")).toMatchObject({ encoding: "GSM7", segments: 1 });
    expect(smsSegments("a".repeat(160)).segments).toBe(1);
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("a".repeat(306)).segments).toBe(2);
    expect(smsSegments("a".repeat(307)).segments).toBe(3);
  });
  it("counts GSM extension characters twice", () => {
    expect(smsSegments("€".repeat(80)).length).toBe(160);
    expect(smsSegments("€".repeat(81)).segments).toBe(2);
  });
  it("counts Bangla as Unicode (70 / 67)", () => {
    expect(smsSegments("ক".repeat(70))).toMatchObject({ encoding: "UCS2", segments: 1 });
    expect(smsSegments("ক".repeat(71)).segments).toBe(2);
    expect(smsSegments("ক".repeat(134)).segments).toBe(2);
    expect(smsSegments("ক".repeat(135)).segments).toBe(3);
  });
  it("one Bangla character makes the whole message Unicode", () => {
    expect(smsSegments(`${"a".repeat(80)}ক`)).toMatchObject({ encoding: "UCS2", segments: 2 });
  });
});

describe("templates", () => {
  const link = patientLink("https://liveserial.example/", "Ab3dE9xQ2k");
  const input = { serial: 12, doctorName: "ডা. আব্দুল করিম", link, peopleAhead: 5, minutes: 30 };

  it("builds the patient link without double slashes", () => {
    expect(link).toBe("https://liveserial.example/t/Ab3dE9xQ2k");
  });

  it("uses Bangla digits and includes the link", () => {
    const body = renderSms("LEAVE_NOW", input);
    expect(body).toContain("সিরিয়াল ১২");
    expect(body).toContain("৫ জন");
    expect(body).toContain(link);
    expect(renderSms("DELAY_BROADCAST", input)).toContain("৩০ মিনিট দেরিতে");
  });

  it("keeps every template within 2 Unicode segments for a typical doctor name and domain", () => {
    for (const code of ["TOKEN_CREATED", "LEAVE_NOW", "NEXT_UP", "DELAY_BROADCAST"] as const) {
      const body = renderSms(code, input);
      expect(smsSegments(body).segments, `${code}: ${body} (${body.length})`).toBeLessThanOrEqual(2);
    }
  });
});
