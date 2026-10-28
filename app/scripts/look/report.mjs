import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const saveReport = (directory, report) =>
  writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
