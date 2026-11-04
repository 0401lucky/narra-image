"""Run the existing isolation regression suite through the revision-2 entry."""

import importlib.util
from pathlib import Path
import sys
import unittest

import isolated


sys.modules["isolated_check"] = isolated.checks
file = Path(__file__).resolve().parents[1] / "isolated_check_test.py"
spec = importlib.util.spec_from_file_location("revision2_isolation_tests", file)
assert spec and spec.loader
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
tests.IsolationTests.setUpClass = classmethod(lambda cls: setattr(cls, "node", isolated.PINNED_NODE))
suite = unittest.defaultTestLoader.loadTestsFromModule(tests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
