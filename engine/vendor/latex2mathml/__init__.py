from importlib import metadata

try:
    __version__ = metadata.version("latex2mathml")
except Exception:  # vendored 副本没有 .dist-info
    __version__ = "3.81.1-vendored"
