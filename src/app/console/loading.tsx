import { FullPageSkeleton } from "@/components/page-skeleton";

/** Shown at once while the page loads on a slow connection. */
export default function Loading() {
  return <FullPageSkeleton />;
}
