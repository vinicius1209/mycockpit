"""Prepara arquivos locais. Não inicia CLI, tools nem chamadas de modelo."""
import pathlib
import shutil
import tempfile

source = pathlib.Path(__file__).parent
root = pathlib.Path(tempfile.mkdtemp(prefix="frota-agy-e2e-"))
workspace = root / "workspace"
workspace.mkdir()
shutil.copy2(source / "workload.py", workspace / "workload.py")
for template in source.glob("*.prompt.txt"):
    (root / template.name).write_text(
        template.read_text().replace("{{WORKSPACE}}", str(workspace))
    )
print(root)
