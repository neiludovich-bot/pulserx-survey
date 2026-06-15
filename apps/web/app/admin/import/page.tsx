import { Suspense } from "react";
import { AdminImportClient } from "../../../src/components/AdminImportClient";

export default function AdminImportPage() {
  return (
    <Suspense fallback={null}>
      <AdminImportClient />
    </Suspense>
  );
}
