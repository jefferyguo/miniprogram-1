#!/usr/bin/env python3

"""兼容旧命令；训练 DOCX 解析统一由 build-training-content-0728.py 完成。"""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("build-training-content-0728.py")
args = [arg for arg in sys.argv[1:] if arg == "--check"]
print("[parse_docx] 已迁移到 scripts/build-training-content-0728.py", file=sys.stderr)
raise SystemExit(subprocess.call([sys.executable, str(SCRIPT), *args], cwd=SCRIPT.parent.parent))
