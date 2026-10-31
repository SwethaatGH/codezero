/** Biomedical theme ↔ technical meaning. Used for labels and tooltips. */
export const TERMS = {
  patient: { themed: "Patient", technical: "GitHub repository" },
  mutation: { themed: "Mutation", technical: "Commit or code change" },
  patientZero: { themed: "Patient Zero", technical: "Suspected regression-introducing commit" },
  infection: { themed: "Infection", technical: "Potential software regression" },
  infectionMap: { themed: "Infection Map", technical: "Dependency and impact graph" },
  symptoms: { themed: "Symptoms", technical: "Error messages or failing tests" },
  diagnosis: { themed: "Diagnosis", technical: "AI-generated root-cause hypothesis" },
  dnaComparison: { themed: "DNA Comparison", technical: "Code diff" },
  treatment: { themed: "Treatment", technical: "Proposed code fix" },
  recovery: { themed: "Recovery", technical: "Validated fix or rollback" },
  medicalRecord: { themed: "Medical Record", technical: "Investigation report" },
  healthMonitor: { themed: "Health Monitor", technical: "Repository health dashboard" },
} as const;

export const MODE_LABELS = {
  "quick-scan": { title: "Quick Scan", description: "Analyze the latest commits on a branch." },
  "regression-hunt": { title: "Regression Hunt", description: "Search between a known working and known broken commit." },
  "single-commit": { title: "Single Commit", description: "Deep-dive into one selected commit." },
  exploration: { title: "Repository Exploration", description: "Browse history without assuming a regression exists." },
  "ai-guided": { title: "AI-Guided Investigation", description: "Describe the bug; symptoms steer prioritization." },
} as const;

export const FINDING_STATUS_LABELS = {
  suspected: "Suspected regression",
  "test-confirmed": "Test-confirmed behavioral change",
  "unverified-hypothesis": "Unverified hypothesis",
  "insufficient-evidence": "Insufficient evidence",
} as const;
