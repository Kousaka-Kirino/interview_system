"""Serialize first-time AI report generation inside one Uvicorn worker.

Locks are weakly referenced so keys cannot accumulate indefinitely. For multi-worker
servers use a persistent cross-process job reservation; the local guide uses one worker.
"""
from contextlib import contextmanager
from threading import Lock
from weakref import WeakValueDictionary

_guard = Lock()
_locks: WeakValueDictionary[str, Lock] = WeakValueDictionary()

@contextmanager
def review_lock(user_id: str, session_id: str):
    with _guard:
        key = user_id + ":" + session_id
        lock = _locks.get(key)
        if lock is None:
            lock = Lock()
            _locks[key] = lock
    with lock:
        yield
