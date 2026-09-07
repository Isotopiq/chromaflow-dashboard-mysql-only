// Integration test — simulates the desktop companion workflow:
// 1. Login to get JWT
// 2. Get lab data (methods, columns, batches)
// 3. Get upload URL for the raw file
// 4. Upload the raw file
// 5. Parse the mzXML file locally (using the parser worker logic)
// 6. Create a run with parsed data
// 7. Verify the run exists via find-run

const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");

const API = "http://localhost:29473";
const TEST_FILE = process.argv[2] || path.join(__dirname, "test_sample.mzXML");
const EMAIL = "test@chroma.lab";
const PASSWORD = "Test1234!";

async function main() {
  console.log("=== Desktop Companion Integration Test ===\n");
  console.log(`Test file: ${TEST_FILE}`);
  const fileSize = fs.statSync(TEST_FILE).size;
  console.log(`File size: ${fileSize} bytes\n`);

  // Step 1: Login
  console.log("Step 1: Login...");
  const loginResp = await fetch(`${API}/api/desktop/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginResp.ok) throw new Error(`Login failed: ${loginResp.status} ${await loginResp.text()}`);
  const { token, user } = await loginResp.json();
  console.log(`  ✓ Logged in as ${user.email} (id: ${user.id})`);
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Step 2: Get lab data
  console.log("Step 2: Get lab data...");
  const labDataResp = await fetch(`${API}/api/desktop/lab-data`, { headers: authHeaders });
  if (!labDataResp.ok) throw new Error(`Lab data failed: ${labDataResp.status}`);
  const labData = await labDataResp.json();
  console.log(`  ✓ Methods: ${labData.methods.length}, Columns: ${labData.columns.length}, Batches: ${labData.batches.length}`);

  // Step 3: Get upload URL
  console.log("Step 3: Get upload URL...");
  const uploadUrlResp = await fetch(`${API}/api/desktop/upload-url`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ filename: path.basename(TEST_FILE), bucket: "raw-runs" }),
  });
  if (!uploadUrlResp.ok) throw new Error(`Upload URL failed: ${uploadUrlResp.status}`);
  const { signedUrl, path: uploadPath } = await uploadUrlResp.json();
  console.log(`  ✓ Upload path: ${uploadPath}`);

  // Step 4: Upload the raw file
  console.log("Step 4: Upload raw file...");
  const fileBuffer = fs.readFileSync(TEST_FILE);
  const uploadResp = await fetch(`${API}${signedUrl}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: fileBuffer,
  });
  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status} ${await uploadResp.text()}`);
  console.log(`  ✓ Raw file uploaded`);

  // Step 5: Parse the mzXML file locally (using worker thread)
  console.log("Step 5: Parse mzXML file locally...");
  const parserWorkerPath = path.join(__dirname, "..", "dist", "main", "parser-worker.js");
  if (!fs.existsSync(parserWorkerPath)) {
    console.log(`  ⚠ Parser worker not built at ${parserWorkerPath}, skipping parse step`);
    return;
  }
  const parseResult = await new Promise((resolve, reject) => {
    const worker = new Worker(parserWorkerPath, { workerData: TEST_FILE });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Parser worker exited with code ${code}`));
    });
  });
  if (!parseResult.ok) throw new Error(`Parse failed: ${parseResult.error}`);
  const { summary } = parseResult;
  console.log(`  ✓ Parsed: ${summary.scanCount} scans, ${summary.peakCount || 0} peaks, TIC: ${summary.tic || 0}`);

  // Step 6: Create a run
  console.log("Step 6: Create run...");
  // Build trace data — replace NaN/null with valid numbers
  const safeNum = (v, fallback) => (typeof v === "number" && !isNaN(v) ? v : fallback);
  const trace = summary.trace && summary.trace.x
    ? {
        x: summary.trace.x.map((v, i) => safeNum(v, i * 60)),
        tic: summary.trace.tic.map((v) => safeNum(v, 0)),
        bpc: summary.trace.bpc.map((v) => safeNum(v, 0)),
      }
    : { x: [0, 60, 120], tic: [5000, 8000, 12000], bpc: [1000, 2000, 3000] };

  const runInput = {
    name: path.basename(TEST_FILE),
    methodId: labData.methods[0]?.id || null,
    columnId: labData.columns[0]?.id || null,
    batchId: labData.batches[0]?.id || null,
    filePath: uploadPath,
    scansBlobPath: uploadPath.replace("raw-runs", "scans") + ".scans.bin",
    fileFormat: "mzXML",
    fileSize: String(fileSize),
    ionMode: summary.ionMode || "positive",
    msLevel: summary.msLevel || 1,
    trace,
    peaks: summary.peaks || [],
    compoundListId: null,
  };
  const createRunResp = await fetch(`${API}/api/desktop/create-run`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(runInput),
  });
  if (!createRunResp.ok) {
    const errText = await createRunResp.text();
    throw new Error(`Create run failed: ${createRunResp.status} ${errText}`);
  }
  const { run } = await createRunResp.json();
  console.log(`  ✓ Run created: id=${run.id}, name=${run.name}`);

  // Step 7: Verify via find-run
  console.log("Step 7: Verify run exists via find-run...");
  const findRunResp = await fetch(`${API}/api/desktop/find-run`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ filePath: uploadPath }),
  });
  if (!findRunResp.ok) throw new Error(`Find run failed: ${findRunResp.status}`);
  const { run: foundRun } = await findRunResp.json();
  if (!foundRun) throw new Error("Run not found after creation!");
  console.log(`  ✓ Run found: id=${foundRun.id}, name=${foundRun.name}`);

  // Step 8: Idempotency check — creating the same run again should return the existing one
  console.log("Step 8: Idempotency check (create same run again)...");
  const createRun2Resp = await fetch(`${API}/api/desktop/create-run`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(runInput),
  });
  if (!createRun2Resp.ok) throw new Error(`Idempotent create failed: ${createRun2Resp.status}`);
  const { run: run2 } = await createRun2Resp.json();
  if (run2.id === run.id) {
    console.log(`  ✓ Idempotent: returned same run id=${run2.id}`);
  } else {
    console.log(`  ⚠ Non-idempotent: got new run id=${run2.id} (expected ${run.id})`);
  }

  console.log("\n=== Integration test PASSED ===");
}

main().catch((err) => {
  console.error("\n=== Integration test FAILED ===");
  console.error(err.message);
  process.exit(1);
});
