/**
 * SMS text: templates and segment counting. Pure and browser-safe, so the
 * console can show the exact segment count before a broadcast is sent.
 *
 * Bangla needs Unicode (UCS-2) SMS: 70 characters in one segment, 67 per
 * segment when split. Plain GSM-7 text: 160 / 153. Templates stay short and
 * use Bangla digits (patient-facing).
 */
import { bn } from "@/lib/format";

// GSM 03.38 basic set; the extension set costs 2 characters each.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€\f";

export type SegmentInfo = { encoding: "GSM7" | "UCS2"; length: number; segments: number; perSegment: number };

export function smsSegments(text: string): SegmentInfo {
  let gsmLength = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXT.includes(ch)) gsmLength += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const perSegment = gsmLength <= 160 ? 160 : 153;
    return { encoding: "GSM7", length: gsmLength, segments: Math.max(1, Math.ceil(gsmLength / perSegment)), perSegment };
  }
  const length = text.length; // UTF-16 code units — what UCS-2 SMS counts
  const perSegment = length <= 70 ? 70 : 67;
  return { encoding: "UCS2", length, segments: Math.max(1, Math.ceil(length / perSegment)), perSegment };
}

export type SmsTemplateCode = "TOKEN_CREATED" | "LEAVE_NOW" | "NEXT_UP" | "DELAY_BROADCAST";

export type TemplateInput = {
  serial: number;
  doctorName: string;
  link: string;
  peopleAhead?: number;
  minutes?: number;
};

/** Patient link for a public code (APP_BASE_URL without a trailing slash). */
export function patientLink(baseUrl: string, publicCode: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/t/${publicCode}`;
}

export function renderSms(code: SmsTemplateCode, i: TemplateInput): string {
  const s = bn(i.serial);
  switch (code) {
    case "TOKEN_CREATED":
      return `সিরিয়াল ${s}, ${i.doctorName}। লাইভ দেখুন: ${i.link}`;
    case "LEAVE_NOW":
      return `সিরিয়াল ${s}: আগে ${bn(i.peopleAhead ?? 0)} জন। এখন রওনা দিন। ${i.link}`;
    case "NEXT_UP":
      return `সিরিয়াল ${s}: আপনি পরের জন, চেম্বারে থাকুন। ${i.link}`;
    case "DELAY_BROADCAST":
      return `${i.doctorName} প্রায় ${bn(i.minutes ?? 0)} মিনিট দেরিতে আসবেন। সিরিয়াল ${s}। ${i.link}`;
  }
}
