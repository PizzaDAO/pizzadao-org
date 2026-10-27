import { redirect } from "next/navigation";

// POAP mint links were replaced by Call Slices.
export default function AdminPoapsRedirect() {
  redirect("/admin/slices");
}
