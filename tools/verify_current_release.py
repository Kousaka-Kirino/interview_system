"""Safe read-only stage 24B prerequisite/handbook check; no imports from app or model APIs."""
from pathlib import Path
import sys
import argparse

CHECKS = {
  'Stage 13 first-run database': ('backend/app/stage13_bootstrap.py', 'initialize_account_database'),
  'Stage 21 AI review': ('backend/tests/test_ai_review_group8.py', 'test_'),
  'Stage 22 training loop': ('backend/tests/test_group9_training_loop.py', 'test_'),
  'Stage 23 practice modes': ('backend/app/services/practice_mode.py', 'def '),
  'Stage 24 local presentation': ('backend/app/services/presentation_local.py', 'def slide_texts('),
  'Stage 24A pagination': ('frontend/src/components/presentation/SlideDeck.tsx', 'parseSlidePageInput'),
  'Account ownership checks': ('backend/app/main.py', 'stage8c2_install_owner_scope(app)'),
  'Install manual': ('docs/manuals/STAGE24A_WINDOWS_INSTALL.md', 'PPT'),
  'User guide': ('docs/manuals/STAGE24A_USER_GUIDE.md', '薄弱点'),
}


def run(root: Path) -> int:
    issues = []
    for label, (relative, snippet) in CHECKS.items():
        target = root / relative
        exists = target.is_file()
        present = exists and snippet in target.read_text(encoding='utf-8')
        print(f"{'OK' if present else 'MISSING'}  {label}: {relative}")
        if not present:
            issues.append(label)
    print(f"Result: {len(CHECKS) - len(issues)}/{len(CHECKS)} checks passed. No project data modified.")
    return 1 if issues else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    sys.exit(run(args.project.resolve()))
