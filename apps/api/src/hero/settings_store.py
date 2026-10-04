"""App settings in the config directory. The Cursor key is not stored here."""

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from hero.atomic import atomic_write_text
from hero.schema import TitleBlock


class AppSettings(BaseModel):
    """Title-block defaults, dimension unit, and grid. No API key."""

    model_config = ConfigDict(extra="ignore")

    titleBlock: TitleBlock = Field(default_factory=TitleBlock)
    dimensionUnit: Literal["cm", "mm"] = "cm"
    gridSpacingM: Annotated[float, Field(gt=0, allow_inf_nan=False)] = 1


class SettingsStore:
    """Load and save ``settings.json`` with an atomic replace."""

    def __init__(self, config_dir: Path) -> None:
        self.config_dir = config_dir

    def path(self) -> Path:
        return self.config_dir / "settings.json"

    def load(self) -> AppSettings:
        file = self.path()
        if not file.is_file():
            return AppSettings()
        return AppSettings.model_validate_json(file.read_text(encoding="utf-8"))

    def save(self, settings: AppSettings) -> AppSettings:
        text = json.dumps(settings.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"
        atomic_write_text(self.path(), text)
        return settings
