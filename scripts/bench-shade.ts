import { runShadeBenchmark } from '../packages/core/src/sun/bench';
for (const [sizeM, cellM] of [[50, 0.5], [100, 1], [200, 1]] as const) {
  const r = runShadeBenchmark({ sizeM, cellM });
  console.log(`${sizeM} m square @ ${cellM} m (${r.cells} cells, ${r.samples} sun samples): full day ${r.fullDayMs.toFixed(0)} ms, move-a-greenhouse update ${r.incrementalMs.toFixed(0)} ms over ${r.incrementalCells} cells`);
}
