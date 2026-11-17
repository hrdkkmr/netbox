import json
import logging
from pathlib import Path
from typing import List, Union
from ..models.events import NetworkEvent

logger = logging.getLogger("netbox.event_reader")


class EventReader:
    @staticmethod
    def read_jsonl_file(file_path: Union[str, Path]) -> List[NetworkEvent]:
        """Reads a single JSONL event file and returns parsed NetworkEvent objects."""
        path = Path(file_path)
        if not path.is_file():
            return []

        events: List[NetworkEvent] = []
        with open(path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    ev = NetworkEvent.model_validate(data)
                    events.append(ev)
                except Exception as err:
                    logger.warning("Failed to parse event at %s:%d: %s", path, line_num, err)

        return events

    @staticmethod
    def merge_and_sort_events(file_paths: List[Union[str, Path]]) -> List[NetworkEvent]:
        """
        Reads multiple JSONL files (e.g. from server and client processes),
        merges them, sorts strictly by timestamp_ns, and re-sequences monotonically.
        """
        all_events: List[NetworkEvent] = []
        for p in file_paths:
            all_events.extend(EventReader.read_jsonl_file(p))

        # Sort chronologically by timestamp_ns
        all_events.sort(key=lambda e: e.timestamp_ns)

        # Normalize unified sequence numbers 1..N
        for idx, ev in enumerate(all_events, start=1):
            ev.sequence = idx

        return all_events
