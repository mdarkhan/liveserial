/** Next.js calls this once per server start. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./lib/bootstrap");
  await bootstrap();
}
