"""Deprecated import path; use app.account_storage for new code.

Alias the actual module object so legacy imports and monkeypatching remain compatible.
"""
from importlib import import_module as _import_module
import sys as _sys
_sys.modules[__name__] = _import_module("app.account_storage")
