"""Research refreshes must round-trip through authoritative artifacts, or fail closed."""
import contextlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from artifact_bridge import artifact_workspace, reject_legacy_writer
import artifact_bridge as BRIDGE
import build_additional_catalog as ADDITIONAL
import research_price_history as HISTORY
import quarter_price_audit as QUARTER


class ArtifactBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name).resolve()

    def marker(self):
        directory = self.root / 'artifacts'
        directory.mkdir()
        (directory / 'manifest.json').write_text('{}', encoding='utf-8')

    def exporter(self, command, **options):
        self.assertEqual(command[:3], ['node', str(self.root / 'scripts/artifact_store.mjs'), 'export-legacy'])
        self.assertEqual(command[-2:], ['--root', str(self.root)])
        work = pathlib.Path(command[3])
        (work / 'docs/data').mkdir(parents=True)
        (work / 'docs/data/catalog.json').write_text('{"offers":[]}', encoding='utf-8')
        (work / '.artifact-revision.json').write_text('{"revision":"base"}', encoding='utf-8')
        return subprocess.CompletedProcess(command, 0)

    def test_legacy_fixture_does_not_run_node_or_create_extra_directories(self):
        with mock.patch.object(BRIDGE.subprocess, 'run') as run:
            with artifact_workspace(self.root) as work:
                self.assertEqual(work, self.root)
            run.assert_not_called()
        self.assertFalse((self.root / 'outputs').exists())

    def test_success_exports_modifies_and_imports_once_without_touching_legacy_source(self):
        self.marker()
        existing = self.root / 'docs/data'; existing.mkdir(parents=True)
        old = existing / 'catalog.json'; old.write_text('original generated copy', encoding='utf-8')
        persistent = self.root / 'outputs'; persistent.mkdir()
        cached = persistent / 'source-evidence.txt'; cached.write_text('keep', encoding='utf-8')
        calls = []
        def run(command, **options):
            calls.append(command)
            if command[2] == 'export-legacy':return self.exporter(command, **options)
            self.assertEqual(command[2], 'import-legacy')
            self.assertEqual((pathlib.Path(command[3]) / 'docs/data/catalog.json').read_text(encoding='utf-8'), '{"offers":["new"]}')
            self.assertTrue(options['check'])
            return subprocess.CompletedProcess(command, 0)
        with mock.patch.object(BRIDGE.subprocess, 'run', side_effect=run):
            with artifact_workspace(self.root) as work:
                staged = work
                (work / 'docs/data/catalog.json').write_text('{"offers":["new"]}', encoding='utf-8')
        self.assertEqual([c[2] for c in calls], ['export-legacy', 'import-legacy'])
        self.assertFalse(staged.exists());self.assertEqual(old.read_text(encoding='utf-8'), 'original generated copy');self.assertEqual(cached.read_text(encoding='utf-8'), 'keep')

    def test_failed_research_never_imports_and_cleans_its_staging_directory(self):
        self.marker()
        with mock.patch.object(BRIDGE.subprocess, 'run', side_effect=self.exporter) as run:
            with self.assertRaisesRegex(ValueError, 'bad selected pack'):
                with artifact_workspace(self.root) as work:
                    staged = work
                    raise ValueError('bad selected pack')
            self.assertEqual(run.call_count, 1)
        self.assertFalse(staged.exists())

    def test_readonly_export_does_not_import_and_missing_base_revision_blocks_refresh(self):
        self.marker()
        with mock.patch.object(BRIDGE.subprocess, 'run', side_effect=self.exporter) as run:
            with artifact_workspace(self.root, writable=False):pass
            self.assertEqual(run.call_count, 1)
        with mock.patch.object(BRIDGE.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            with self.assertRaisesRegex(RuntimeError, 'base revision'):
                with artifact_workspace(self.root):self.fail('No export revision must fail before research starts.')
            self.assertEqual(run.call_count, 1)

    def test_concurrent_edit_rejection_is_reported_and_never_falls_back_to_docs_data(self):
        self.marker()
        def run(command, **options):
            if command[2] == 'export-legacy':return self.exporter(command, **options)
            raise subprocess.CalledProcessError(1, command, stderr='stale artifact revision')
        with mock.patch.object(BRIDGE.subprocess, 'run', side_effect=run):
            with self.assertRaisesRegex(RuntimeError, 'stale artifact revision'):
                with artifact_workspace(self.root) as work:staged = work
        self.assertFalse(staged.exists());self.assertFalse((self.root / 'docs/data').exists())

    def test_old_oneoff_writers_have_an_actionable_guard_only_in_artifact_projects(self):
        reject_legacy_writer(self.root, 'old.py')
        self.marker()
        with self.assertRaisesRegex(RuntimeError, 'merge_catalog_research.mjs'):
            reject_legacy_writer(self.root, 'old.py')

    def test_maintained_writer_wrappers_keep_evidence_cache_root_and_restore_globals(self):
        for module in [ADDITIONAL, HISTORY]:
            staged = self.root / module.__name__; staged.mkdir()
            @contextlib.contextmanager
            def workspace(root, **options):
                self.assertEqual(root, self.root)
                yield staged
            def run():
                self.assertEqual(module.ROOT, staged);self.assertEqual(module.OUTPUT_ROOT, self.root)
                raise ValueError('source failed')
            with self.subTest(module=module.__name__),mock.patch.object(module, 'ROOT', self.root),mock.patch.object(module, 'OUTPUT_ROOT', None),mock.patch.object(module, 'artifact_workspace', workspace),mock.patch.object(module, '_main', run):
                with self.assertRaisesRegex(ValueError, 'source failed'):module.main()
                self.assertEqual(module.ROOT, self.root);self.assertIsNone(module.OUTPUT_ROOT)

    def test_discovery_only_history_does_not_open_an_artifact_write_transaction(self):
        @contextlib.contextmanager
        def workspace(root, writable):
            self.assertFalse(writable)
            yield root
        with mock.patch.object(HISTORY, 'ROOT', self.root),mock.patch.object(HISTORY, 'artifact_workspace', workspace),mock.patch.object(HISTORY, '_main') as run,mock.patch('sys.argv',['history','--discover-only']):
            HISTORY.main();run.assert_called_once()

    def test_direct_category_save_cannot_bypass_the_artifact_transaction(self):
        self.marker()
        with self.assertRaisesRegex(RuntimeError, 'legacy docs/data writer'):
            ADDITIONAL.save_refreshed_categories(self.root, {'protein':[{'id':'new','brand':'Example'}]}, '2026-11-22')
        self.assertFalse((self.root/'docs').exists())

    def test_archive_parser_import_does_not_require_legacy_catalog_files(self):
        data = self.root / 'docs/data';data.mkdir(parents=True)
        for name in ['catalog', 'creatine']:(data / (name+'.json')).write_text(json.dumps({'offers':[name]}), encoding='utf-8')
        result = QUARTER.load_data(self.root)
        self.assertEqual(result['protein']['offers'], ['catalog']);self.assertEqual(result['creatine']['offers'], ['creatine'])


if __name__ == '__main__':unittest.main()
