import { PageSkeleton } from "@/components/page-skeleton";

/** Shown inside the admin frame (header and tabs stay) while a page loads. */
export default function Loading() {
  return <PageSkeleton />;
}
