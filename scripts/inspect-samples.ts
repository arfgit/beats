/**
 * Read-only inventory of the production sample library. Run before
 * touching demo composers to ground their `pickByCategory` / positional
 * picks against what's actually present.
 *
 * Requires Application Default Credentials:
 *   gcloud auth application-default login
 *
 * Run with:
 *   npm run inspect:samples
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "beats-prod-ant";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

async function run(): Promise<void> {
  const snap = await db.collection("samples").get();
  const byKind = new Map<
    string,
    Array<{ id: string; name: string; category?: string }>
  >();
  for (const doc of snap.docs) {
    const data = doc.data() as {
      kind: string;
      name: string;
      category?: string;
    };
    const arr = byKind.get(data.kind) ?? [];
    arr.push({ id: doc.id, name: data.name, category: data.category });
    byKind.set(data.kind, arr);
  }

  for (const [kind, samples] of [...byKind.entries()].sort()) {
    console.log(`\n=== ${kind} (${samples.length}) ===`);
    const byCat = new Map<string, number>();
    for (const s of samples) {
      const cat = s.category ?? "(uncategorized)";
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    }
    for (const [cat, count] of [...byCat.entries()].sort()) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log(`  first 5 by id-sort:`);
    samples
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 5)
      .forEach((s) =>
        console.log(`    [${s.category ?? "-"}] ${s.id}  "${s.name}"`),
      );

    // Distinct name "families" — first word/token of the human name —
    // so we can pick by family later instead of by raw positional index.
    const families = new Map<string, number>();
    for (const s of samples) {
      const token = (s.name.split(/\s+/)[0] ?? "").toLowerCase();
      if (!token) continue;
      families.set(token, (families.get(token) ?? 0) + 1);
    }
    const sortedFamilies = [...families.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    console.log(`  top name families:`);
    for (const [token, count] of sortedFamilies) {
      console.log(`    ${token}: ${count}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
