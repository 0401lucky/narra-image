"""Exercise retained isolation contracts with this task's pinned runtime."""

import importlib.util
from pathlib import Path
import sys
import unittest

import isolated

sys.modules["isolated_check"] = isolated.checks
spec = importlib.util.spec_from_file_location("ghcr_isolation_tests", Path(__file__).with_name("isolation_base_test.py"))
assert spec and spec.loader
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
tests.IsolationTests.setUpClass = classmethod(lambda cls: setattr(cls, "node", isolated.PINNED_NODE))
result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(tests))
raise SystemExit(0 if result.wasSuccessful() else 1)
