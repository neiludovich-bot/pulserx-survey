import { Suspense } from "react";
import { AdminSourceLibraryClient } from "../../../src/components/AdminSourceLibraryClient";

export default function AdminSourceLibraryPage() {
  return (
    <Suspense fallback={null}>
      <AdminSourceLibraryClient />
    </Suspense>
  );
}
