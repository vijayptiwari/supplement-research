"""Run maintained Python research against the authoritative artifact store.

The temporary legacy layout is a compatibility boundary, never another source of
truth. Node validates the imported revision and refuses stale concurrent writes.
"""
import contextlib
import pathlib
import subprocess
import tempfile


def uses_artifacts(root):
    return (pathlib.Path(root) / 'artifacts/manifest.json').is_file()


def _run_bridge(root, operation, work):
    command = ['node', str(root / 'scripts/artifact_store.mjs'), operation, str(work), '--root', str(root)]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or str(error)).strip()
        raise RuntimeError(f'Artifact {operation} failed; authoritative data was not accepted: {detail}') from error


@contextlib.contextmanager
def artifact_workspace(root, writable=True):
    """Yield compatible docs/data inputs; import only after successful research."""
    root = pathlib.Path(root).resolve()
    if not uses_artifacts(root):
        yield root
        return
    cache = root / 'outputs'
    if not cache.resolve().is_relative_to(root):
        raise ValueError('The artifact workspace cache must remain inside the repository.')
    cache.mkdir(exist_ok=True)
    temporary = tempfile.TemporaryDirectory(prefix='artifact-refresh-', dir=cache)
    work = pathlib.Path(temporary.name).resolve()
    # The explicit bound is checked before the context can recursively clean up.
    if work.parent != cache.resolve() or not work.name.startswith('artifact-refresh-'):
        raise ValueError('Unexpected artifact refresh workspace path.')
    try:
        _run_bridge(root, 'export-legacy', work)
        if not (work / '.artifact-revision.json').is_file():
            raise RuntimeError('Artifact export did not provide its base revision; refresh was not started.')
        yield work
        if writable:
            _run_bridge(root, 'import-legacy', work)
    finally:
        temporary.cleanup()


def reject_legacy_writer(root, script):
    """Old one-off patchers must not silently write an ignored docs/data copy."""
    if uses_artifacts(root):
        raise RuntimeError(
            f'{script} is a legacy docs/data writer and cannot update the artifact-backed project. '
            'Edit artifacts/products/<supplement>/<brand>/<product>.json, use '
            'scripts/merge_catalog_research.mjs for reviewed changes, or run the maintained '
            'scripts/build_additional_catalog.py refresh instead.'
        )
