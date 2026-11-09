import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/access";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}
