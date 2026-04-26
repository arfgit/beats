/**
 * Diagnostic: simulate the body the client sends to POST /api/projects
 * and run it through the same Zod validator the server uses. Prints
 * exactly which field(s) the schema rejects.
 *
 *   npx tsx scripts/diag-create-project.ts
 */
import { createProjectBody } from "../server/src/lib/schemas.js";
import {
  MATRIX_CELL_COUNT,
  createDefaultMatrix,
  createDefaultPattern,
  type MixerCell,
  type Pattern,
  type ProjectMatrix,
} from "@beats/shared";

// Replica of client's `buildMatrixFromPatternAndMatrix` — kept inline
// so the diag can run from any workspace without depending on client
// internals.
function buildMatrixFromPatternAndMatrix(
  pattern: Pattern,
  matrix: ProjectMatrix,
  selectedCellId: string,
): ProjectMatrix {
  const cellIndex = matrix.cells.findIndex((c) => c.id === selectedCellId);
  const updatedCells: MixerCell[] =
    cellIndex >= 0
      ? matrix.cells.map((c, i) =>
          i === cellIndex
            ? {
                ...c,
                pattern: {
                  stepCount: pattern.stepCount,
                  tracks: pattern.tracks,
                },
                effects: pattern.effects,
              }
            : c,
        )
      : matrix.cells;
  return {
    schemaVersion: 2,
    sharedBpm: pattern.bpm,
    masterGain: pattern.masterGain,
    cells:
      updatedCells.length === MATRIX_CELL_COUNT ? updatedCells : updatedCells,
  };
}

const matrix = createDefaultMatrix();
const pattern = createDefaultPattern();
const selectedCellId = matrix.cells[0]!.id;
const projectMatrix = buildMatrixFromPatternAndMatrix(
  pattern,
  matrix,
  selectedCellId,
);

const body = {
  title: "untitled beat",
  pattern: projectMatrix,
  isPublic: false,
};

const result = createProjectBody.safeParse(body);
if (result.success) {
  console.log("PASS — default matrix body validates clean.");
} else {
  console.log("FAIL — validation issues:");
  for (const issue of result.error.issues) {
    console.log(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.log("\nFirst cell summary:");
  const cell = projectMatrix.cells[0];
  console.log({
    cellId: cell?.id,
    enabled: cell?.enabled,
    trackCount: cell?.pattern.tracks.length,
    trackKinds: cell?.pattern.tracks.map((t) => t.kind),
    effectKinds: cell?.effects.map((e) => e.kind),
  });
}
