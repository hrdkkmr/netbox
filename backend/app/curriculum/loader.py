import json
from pathlib import Path
from typing import Dict, List, Optional

from .models import LabDefinition

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CURRICULUM_DIR = REPO_ROOT / "curriculum"
LABS_DIR = CURRICULUM_DIR / "labs"


class CurriculumLoader:
    def __init__(self, curriculum_dir: Path = CURRICULUM_DIR):
        self.curriculum_dir = curriculum_dir
        self.labs_dir = curriculum_dir / "labs"
        self._labs_cache: Dict[str, LabDefinition] = {}
        self._ordered_ids: List[str] = []
        self.reload()

    def reload(self) -> None:
        self._labs_cache = {}
        self._ordered_ids = []

        index_file = self.curriculum_dir / "curriculum_index.json"
        file_list: List[Path] = []
        if index_file.is_file():
            index_data = json.loads(index_file.read_text(encoding="utf-8"))
            for rel in index_data.get("lab_files", []):
                p = (self.curriculum_dir / rel).resolve()
                if p.is_file():
                    file_list.append(p)
        elif self.labs_dir.is_dir():
            file_list = sorted(self.labs_dir.glob("*.json"))

        for lab_file in file_list:
            data = json.loads(lab_file.read_text(encoding="utf-8"))
            lab = LabDefinition(**data)
            self._labs_cache[lab.lab_id] = lab
            self._ordered_ids.append(lab.lab_id)

    def list_labs(self) -> List[LabDefinition]:
        return [self._labs_cache[lid] for lid in self._ordered_ids if lid in self._labs_cache]

    def get_lab(self, lab_id: str) -> Optional[LabDefinition]:
        return self._labs_cache.get(lab_id)
