import { expect, test, type Page } from "@playwright/test";

/**
 * The three flows that matter most (run in order, sharing one session):
 *  1. An assistant calls the next patient from the console.
 *  2. A patient's page shows the change within 5 s, without reloading.
 *  3. An out-of-order call needs a reason and shows up highlighted in the audit log.
 * Serials appear in Bangla digits on screen.
 */

const env = () => ({
  password: process.env.E2E_PASSWORD!,
  admin: process.env.E2E_ADMIN_PHONE!,
  assistant: process.env.E2E_ASSISTANT_PHONE!,
  sessionId: process.env.E2E_SESSION_ID!,
  codes: JSON.parse(process.env.E2E_CODES!) as Record<string, string>,
});

async function login(page: Page, phone: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator("input[name=phone]").fill(phone);
  await page.locator("input[name=password]").fill(env().password);
  await page.getByRole("button", { name: "লগ ইন করুন" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const nowServing = (page: Page) => page.locator('section[aria-labelledby="now-h"]');
const nextButton = (page: Page) => page.getByRole("button", { name: /পরের রোগী ডাকুন/ });

test.describe.serial("critical flows", () => {
  test("assistant calls the next patient", async ({ page }) => {
    await login(page, env().assistant);
    await page.goto(`/console/${env().sessionId}`);
    await expect(nextButton(page)).toContainText("পরবর্তী: সিরিয়াল ১");
    await nextButton(page).click();
    await expect(nowServing(page)).toContainText("১");
    await expect(nowServing(page)).toContainText("রোগী ১");
    await expect(page.getByText("সব সেভ হয়েছে")).toBeVisible();
    await expect(nextButton(page)).toContainText("পরবর্তী: সিরিয়াল ২");
  });

  test("patient page updates live within 5 seconds", async ({ browser }) => {
    // Patient: no login, just the link from the SMS.
    const patientCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const patient = await patientCtx.newPage();
    await patient.goto(`/t/${env().codes["3"]}`);
    await expect(patient.locator("main")).toContainText("আপনার সিরিয়াল");
    await expect(patient.locator("main")).toContainText("আপনার আগে আছেন ২ জন");
    await expect(patient.getByText("লাইভ", { exact: true })).toBeVisible();
    await patient.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    // Assistant taps next in another browser context.
    const staffCtx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const staff = await staffCtx.newPage();
    await login(staff, env().assistant);
    await staff.goto(`/console/${env().sessionId}`);
    await nextButton(staff).click();
    await expect(nowServing(staff)).toContainText("রোগী ২");

    await expect(patient.locator("main")).toContainText("আপনার আগে ১ জন — আপনি পরের জন", { timeout: 5_000 });
    await expect(patient.locator("main")).toContainText("এখন রওনা দিন");
    // Same page instance: it updated live, not by reloading.
    expect(await patient.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    // The patient page never shows other patients' names.
    await expect(patient.locator("body")).not.toContainText("রোগী ২");

    await patientCtx.close();
    await staffCtx.close();
  });

  test("out-of-order call requires a reason and is highlighted in the audit log", async ({ page }) => {
    await login(page, env().assistant);
    await page.goto(`/console/${env().sessionId}`);
    await page.locator('section[aria-labelledby="waiting-h"] button').filter({ hasText: "রোগী ৬" }).click();
    await page.getByRole("button", { name: "এখনই ডাকুন" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("ক্রম ভেঙে ডাকছেন");
    await expect(dialog).toContainText("৩, ৪, ৫");
    await dialog.getByRole("button", { name: "ডাকুন", exact: true }).click();
    await expect(dialog).toContainText("কারণ বেছে নিন"); // no reason chosen yet
    await dialog.getByLabel("রিপোর্ট দেখানো").check();
    await dialog.getByRole("button", { name: "ডাকুন", exact: true }).click();
    await expect(nowServing(page)).toContainText("রোগী ৬");

    // The clinic admin sees it highlighted with the reason and who was jumped.
    await page.context().clearCookies();
    await login(page, env().admin);
    await page.goto(`/admin/sessions/${env().sessionId}`);
    const row = page.locator('section[aria-labelledby="audit-h"] li').filter({ hasText: "ক্রম ভেঙে ডাকা" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("কারণ: রিপোর্ট দেখানো");
    await expect(row).toContainText("যাদের আগে ডাকা হলো: ৩, ৪, ৫");
    await expect(row).toContainText("E2E সহকারী");
  });

  test("waiting-room display shows now serving and the next three", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/display/${env().sessionId}`);
    await expect(page.getByRole("region", { name: "এখন চলছে" })).toContainText("৬");
    await expect(page.getByRole("region", { name: "পরবর্তী" })).toContainText("৩");
    await expect(page.locator("body")).not.toContainText("রোগী");
  });
});
