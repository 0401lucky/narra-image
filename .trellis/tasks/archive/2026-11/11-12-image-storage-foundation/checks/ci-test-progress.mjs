// Task-local diagnostic reporter; it does not filter tests or change results.
export default class TestProgressReporter {
  starts = new Map();

  onTestRunStart(specifications) {
    console.log(`[local-test-progress] modules=${specifications.length}`);
  }

  onTestModuleStart(module) {
    this.starts.set(module.moduleId, Date.now());
    console.log(`[local-test-progress] start ${module.relativeModuleId}`);
  }

  onTestCaseReady(test) {
    console.log(`[local-test-progress] case ${test.fullName}`);
  }

  onTestModuleEnd(module) {
    const started = this.starts.get(module.moduleId);
    console.log(`[local-test-progress] end ${module.relativeModuleId} state=${module.state()} elapsedMs=${started === undefined ? "unknown" : Date.now() - started}`);
  }
}
