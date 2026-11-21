"""The scheduler must not acknowledge an unsuccessful recovery as HTTP success."""
import ast
from pathlib import Path

import pytest
from firebase_admin import firestore
import report_publication


@pytest.mark.parametrize("status,failed", [
    ("PUBLISHED", False), ("ALREADY_PUBLISHED", False), ("IN_PROGRESS", False),
    ("FAILED", True), ("ATTEMPTS_EXHAUSTED", True),
])
@pytest.mark.parametrize("handler", [
    "scheduled_recover_strategy_reports", "scheduled_publish_daily_report", "scheduled_publish_weekly_report",
])
def test_scheduler_propagates_publication_failure(monkeypatch, status, failed, handler):
    # Execute the actual handler without the Firebase HTTP decorator or credentials.
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text(encoding="utf8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name == handler)
    function.decorator_list = []
    function.returns = None
    for arg in function.args.args:
        arg.annotation = None
    namespace = {"publish_strategy_report_service": lambda *args: {"status": status}}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "main.py", "exec"), namespace)
    monkeypatch.setattr(firestore, "client", lambda: object())
    monkeypatch.setattr(report_publication, "recover_due_reports", lambda **kw: [{"status": status}])
    if failed:
        with pytest.raises(RuntimeError, match="(recovery|publication) failed"):
            namespace[function.name](None)
    else:
        namespace[function.name](None)
