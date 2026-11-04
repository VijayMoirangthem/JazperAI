import copy
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routes.office import _world

BASE = json.loads((Path(__file__).resolve().parents[3] / "app/public/office3/world.json").read_text(encoding="utf-8"))
ROOM = BASE["rooms"][0]["id"]


def with_wp(points):
    w = copy.deepcopy(BASE)
    w["waypoints"] = points
    return w


def test_base_world_and_valid_waypoint_pass():
    _world(copy.deepcopy(BASE))
    assert _world(with_wp([{"id": "wp-a", "room": ROOM, "pos": [1, 1]}]))["waypoints"][0]["id"] == "wp-a"


@pytest.mark.parametrize("points", [
    [{"id": "a", "room": "nope", "pos": [1, 1]}],
    [{"id": "a", "room": ROOM, "pos": [9999, 1]}],
    [{"id": "a", "room": ROOM, "pos": [1, 1]}, {"id": "a", "room": ROOM, "pos": [2, 1]}],
    [{"id": f"w{i}", "room": ROOM, "pos": [1, 1]} for i in range(65)],
    "not a list",
])
def test_bad_waypoints_rejected(points):
    with pytest.raises(HTTPException) as err:
        _world(with_wp(points))
    assert err.value.status_code == 422


def test_doc_decodes_jsonb_text():
    from api.routes.office import _doc
    assert _doc('{"a": 1}') == {"a": 1}
    assert _doc(b'{"a": 1}') == {"a": 1}
    assert _doc({"a": 1}) == {"a": 1}


def test_people_schema_creates_invites_before_altering():
    import inspect
    from api.routes import people
    src = inspect.getsource(people._ensure)
    assert src.index("CREATE TABLE IF NOT EXISTS shared.office_invites") < src.index("ALTER TABLE shared.office_invites")
