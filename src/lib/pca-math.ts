// Pure JavaScript PCA via covariance matrix + Jacobi eigendecomposition.
//
// No external dependencies. Operates on a matrix where rows are observations
// (runs) and columns are variables (analytes). The data is log-transformed,
// mean-centered, and then decomposed into principal components.
//
// Reference: Numerical Recipes — Jacobi eigenvalue algorithm for symmetric
// matrices.

export type PCAResult = {
  scores: Array<{ runId: string; pc1: number; pc2: number; pc3: number; label: string }>;
  loadings: Array<{ analyteId: string; name: string; pc1: number; pc2: number }>;
  explainedVariance: number[];
};

/**
 * Run PCA on a data matrix.
 *
 * @param data      Matrix of shape [nRows][nCols] (rows = runs, cols = analytes).
 * @param rowLabels Labels for each row (run IDs).
 * @param colLabels Labels for each column (analyte IDs or names).
 * @returns         PCAResult with top-3 PC scores, loadings, and explained variance %.
 */
export function runPCA(
  data: number[][],
  rowLabels: string[],
  colLabels: string[],
): PCAResult {
  const nRows = data.length;
  const nCols = data[0]?.length ?? 0;

  if (nRows < 2 || nCols < 1) {
    // Not enough data — return a degenerate result so callers don't crash.
    return {
      scores: rowLabels.map((label) => ({ runId: label, pc1: 0, pc2: 0, pc3: 0, label })),
      loadings: colLabels.map((name) => ({ analyteId: name, name, pc1: 0, pc2: 0 })),
      explainedVariance: [0, 0, 0],
    };
  }

  // ---- Step 1: log-transform (add 1 to handle zeros) ----
  const logData: number[][] = data.map((row) =>
    row.map((v) => Math.log1p(Math.max(0, v))),
  );

  // ---- Step 2: mean-center each column ----
  const colMeans = new Array(nCols).fill(0);
  for (let j = 0; j < nCols; j++) {
    let sum = 0;
    for (let i = 0; i < nRows; i++) sum += logData[i][j];
    colMeans[j] = sum / nRows;
  }
  const centered: number[][] = logData.map((row) =>
    row.map((v, j) => v - colMeans[j]),
  );

  // ---- Step 3: compute covariance matrix (nCols x nCols) ----
  // cov = (1/(n-1)) * X^T * X
  const cov: number[][] = Array.from({ length: nCols }, () =>
    new Array(nCols).fill(0),
  );
  const denom = nRows > 1 ? nRows - 1 : 1;
  for (let i = 0; i < nCols; i++) {
    for (let j = i; j < nCols; j++) {
      let sum = 0;
      for (let k = 0; k < nRows; k++) sum += centered[k][i] * centered[k][j];
      cov[i][j] = sum / denom;
      cov[j][i] = cov[i][j]; // symmetric
    }
  }

  // ---- Step 4: Jacobi eigendecomposition ----
  const { eigenvalues, eigenvectors } = jacobiEigen(cov, nCols);

  // ---- Step 5: sort eigenvalues descending, reorder eigenvectors ----
  const order = eigenvalues
    .map((val, idx) => ({ val, idx }))
    .sort((a, b) => b.val - a.val)
    .map((o) => o.idx);

  const sortedEigenvalues = order.map((i) => eigenvalues[i]);
  // eigenvectors[col][pc] — reorder columns
  const sortedEigenvectors: number[][] = Array.from({ length: nCols }, () =>
    new Array(nCols).fill(0),
  );
  for (let col = 0; col < nCols; col++) {
    for (let pc = 0; pc < nCols; pc++) {
      sortedEigenvectors[col][pc] = eigenvectors[col][order[pc]];
    }
  }

  // ---- Step 6: explained variance percentages ----
  const totalVariance = sortedEigenvalues.reduce((s, v) => s + Math.max(0, v), 0);
  const explainedVariance = sortedEigenvalues.map((v) =>
    totalVariance > 0 ? (Math.max(0, v) / totalVariance) * 100 : 0,
  );

  // ---- Step 7: compute scores (project centered data onto PCs) ----
  // scores[row][pc] = sum_j centered[row][j] * eigenvector[j][pc]
  const nPCs = Math.min(3, nCols);
  const scores: number[][] = [];
  for (let r = 0; r < nRows; r++) {
    const rowScores: number[] = new Array(nPCs).fill(0);
    for (let pc = 0; pc < nPCs; pc++) {
      let s = 0;
      for (let j = 0; j < nCols; j++) {
        s += centered[r][j] * sortedEigenvectors[j][pc];
      }
      rowScores[pc] = s;
    }
    scores.push(rowScores);
  }

  // ---- Step 8: build result ----
  const scoreRows = rowLabels.map((label, i) => ({
    runId: label,
    pc1: scores[i][0] ?? 0,
    pc2: scores[i][1] ?? 0,
    pc3: scores[i][2] ?? 0,
    label,
  }));

  // Loadings: eigenvector columns for PC1 and PC2
  const loadings = colLabels.map((name, j) => ({
    analyteId: name,
    name,
    pc1: sortedEigenvectors[j][0] ?? 0,
    pc2: sortedEigenvectors[j][1] ?? 0,
  }));

  return {
    scores: scoreRows,
    loadings,
    explainedVariance: explainedVariance.slice(0, 3),
  };
}

// ---- Jacobi eigenvalue algorithm for symmetric matrices ----
// Returns { eigenvalues: number[], eigenvectors: number[][] }
// where eigenvectors[col][eigenIdx] is the component of the col-th
// variable in the eigenIdx-th eigenvector.
function jacobiEigen(
  a: number[][],
  n: number,
  maxSweeps = 100,
  tol = 1e-12,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  // Work on a copy
  const A: number[][] = a.map((row) => [...row]);

  // Initialize eigenvector matrix to identity
  const V: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0);
    row[i] = 1;
    return row;
  });

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Compute off-diagonal sum
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        off += A[p][q] * A[p][q];
      }
    }
    if (off < tol) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < tol) continue;

        const app = A[p][p];
        const aqq = A[q][q];
        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);

        // Rotate A
        for (let i = 0; i < n; i++) {
          const aip = A[i][p];
          const aiq = A[i][q];
          A[i][p] = cos * aip - sin * aiq;
          A[i][q] = sin * aip + cos * aiq;
        }
        for (let j = 0; j < n; j++) {
          const apj = A[p][j];
          const aqj = A[q][j];
          A[p][j] = cos * apj - sin * aqj;
          A[q][j] = sin * apj + cos * aqj;
        }

        // Rotate V
        for (let i = 0; i < n; i++) {
          const vip = V[i][p];
          const viq = V[i][q];
          V[i][p] = cos * vip - sin * viq;
          V[i][q] = sin * vip + cos * viq;
        }
      }
    }
  }

  const eigenvalues = new Array(n).fill(0);
  for (let i = 0; i < n; i++) eigenvalues[i] = A[i][i];

  return { eigenvalues, eigenvectors: V };
}
