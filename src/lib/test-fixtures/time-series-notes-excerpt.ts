import type { ParsedDocument } from "@/lib/types";

const sectionBlock = (page: number, heading: string, body: string) => `[Page ${page}]
${heading}
${body}
`;

const pages: string[] = [];
for (let page = 10; page <= 35; page += 1) {
  pages.push(
    sectionBlock(
      page,
      `${2 + Math.floor((page - 10) / 3)}.${(page % 4) + 1}.${(page % 3) + 1} ${page % 2 ? "SECOND-ORDER/WEAK/COVARIANCE stationarity" : "COMPLETE/STRONG/STRICT stationarity"}`,
      `
[1] White noise process
Definition. A white noise process {Xt} has E{Xt}=0 and cov{Xt, Xt+ω}=0 for ω != 0.
[2] q-th order moving average process MA(q)
Xt = εt - θ εt-1
[3] p-th order autoregressive process AR(p)
Xt = φ Xt-1 + εt
[4] ARMA(p,q)
Φ(B)Xt = Θ(B)εt
[5] ARCH(p)
ρk = sk/s0
Worked example: stationarity and invertibility.
Stationarity condition: roots outside the unit circle.
Invertibility condition: roots outside the unit circle.
Autocovariance sequence and autocorrelation sequence.
Toeplitz covariance matrix is positive semi-definite.
Ljung-Box test for residual diagnostics.
Forecasting and parametric AR model fitting.
`,
    ),
  );
}

for (let page = 37; page <= 39; page += 1) {
  pages.push(
    sectionBlock(
      page,
      `${4}.${page - 34} Spectral analysis`,
      `
Spectral representation theorem.
Integrated spectrum and spectral density function.
Periodogram and direct spectral estimator.
Tapering.
Differencing and backshift operator.
Seasonal differencing and trend removal.
ARIMA(p,d,q) and General Linear Process.
`,
    ),
  );
}

export const timeSeriesFixtureDocument: ParsedDocument = {
  sourceFile: "time-series-notes-fixture.txt",
  fileType: "txt",
  fullText: pages.join("\n"),
  diagnostics: {
    success: true,
    charCount: pages.join("\n").length,
    pageCount: 29,
    warnings: [],
    errors: [],
    extractionQuality: "high",
  },
};
