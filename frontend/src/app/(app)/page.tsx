import { redirect } from "next/navigation";

// Prospects + AI generation is the primary workflow, so it owns the root.
export default function RootPage() {
  redirect("/prospects");
}
