import logging
import os

logger = logging.getLogger(__name__)

_client = None
_use_memory = False


def get_client():
    global _client, _use_memory
    if _client is not None:
        return _client

    emulator = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
    project = os.environ.get("KOTOLEAF_GCP_PROJECT_ID", "")

    if not emulator and not project:
        logger.info("No Firestore configured — using in-memory store")
        _use_memory = True
        _client = MemoryClient()
        return _client

    from google.cloud import firestore
    _client = firestore.AsyncClient(project=project or "kotoleaf-dev")
    return _client


def is_memory_mode() -> bool:
    return _use_memory


class MemoryDocument:
    def __init__(self, data: dict | None, ref):
        self._data = data
        self.reference = ref
        self.exists = data is not None

    def to_dict(self):
        return self._data


class MemoryDocRef:
    def __init__(self, store: dict, path: str):
        self._store = store
        self._path = path

    async def get(self):
        return MemoryDocument(self._store.get(self._path), self)

    async def set(self, data: dict):
        self._store[self._path] = dict(data)

    async def update(self, data: dict):
        if self._path in self._store:
            self._store[self._path].update(data)
        else:
            self._store[self._path] = dict(data)

    def collection(self, name: str):
        return MemoryCollection(self._store, f"{self._path}/{name}")


class _MemoryStream:
    """Async iterator over matching documents."""

    def __init__(self, docs: list[MemoryDocument]):
        self._docs = docs

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._docs:
            raise StopAsyncIteration
        return self._docs.pop(0)


class MemoryQuery:
    def __init__(self, store: dict, prefix: str, filters: list[tuple] | None = None):
        self._store = store
        self._prefix = prefix
        self._filters = filters or []
        self._order_field = None
        self._order_dir = None
        self._limit_n = None

    def where(self, field: str, op: str = "==", value=None, **kwargs):
        # Support both where("field", "==", value) and where(filter=...)
        if op and value is not None:
            new_filters = self._filters + [(field, op, value)]
        else:
            new_filters = list(self._filters)
        q = MemoryQuery(self._store, self._prefix, new_filters)
        q._order_field = self._order_field
        q._order_dir = self._order_dir
        q._limit_n = self._limit_n
        return q

    def order_by(self, field, direction=None):
        q = MemoryQuery(self._store, self._prefix, list(self._filters))
        q._order_field = field
        q._order_dir = direction
        q._limit_n = self._limit_n
        return q

    def limit(self, n):
        q = MemoryQuery(self._store, self._prefix, list(self._filters))
        q._order_field = self._order_field
        q._order_dir = self._order_dir
        q._limit_n = n
        return q

    def _matches(self, data: dict) -> bool:
        for field, op, value in self._filters:
            dval = data.get(field)
            if op == "==" and dval != value:
                return False
            if op == "array_contains" and (not isinstance(dval, list) or value not in dval):
                return False
        return True

    def stream(self):
        results = []
        for key, data in self._store.items():
            if key.startswith(self._prefix + "/") and key.count("/") == self._prefix.count("/") + 1:
                if self._matches(data):
                    ref = MemoryDocRef(self._store, key)
                    results.append(MemoryDocument(data, ref))
        if self._limit_n:
            results = results[: self._limit_n]
        return _MemoryStream(results)


class MemoryCollection:
    def __init__(self, store: dict, prefix: str):
        self._store = store
        self._prefix = prefix

    def document(self, doc_id: str):
        return MemoryDocRef(self._store, f"{self._prefix}/{doc_id}")

    def where(self, field, op="==", value=None, **kwargs):
        return MemoryQuery(self._store, self._prefix).where(field, op, value)

    def order_by(self, field, direction=None):
        return MemoryQuery(self._store, self._prefix).order_by(field, direction)


class MemoryClient:
    def __init__(self):
        self._store: dict[str, dict] = {}

    def collection(self, name: str):
        return MemoryCollection(self._store, name)
