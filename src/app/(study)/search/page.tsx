import { Suspense } from "react";
import { SearchScreen } from "../../../components/screens.js";

export default function Page() {
  return (
    <Suspense fallback={<p className="status" role="status">Loading search…</p>}>
      <SearchScreen />
    </Suspense>
  );
}
