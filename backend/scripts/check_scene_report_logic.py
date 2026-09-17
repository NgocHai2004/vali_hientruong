"""Dependency-free checks of report logic; does not start FastAPI or MongoDB."""
import ast
import asyncio
import base64
import io
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'services/scene_report_service.py').read_text(encoding='utf-8'))
tree.body = [n for n in tree.body if not (isinstance(n, ast.ImportFrom) and n.module in ('bson', 'fastapi'))]

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)

ns = {'ObjectId': str, 'HTTPException': HTTPException}
exec(compile(tree, 'scene_report_service.py', 'exec'), ns)

class Cursor:
    def __init__(self, items): self.items = items
    def sort(self, *args): return self
    def __aiter__(self):
        async def iterator():
            for item in self.items: yield item
        return iterator()

class Collection:
    def __init__(self, items): self.items = items
    async def find_one(self, query):
        return next((x for x in self.items if x['_id'] == query['_id']), None)
    def find(self, query):
        return Cursor([x for x in self.items if all(
            x.get(k) in v['$in'] if isinstance(v, dict) else x.get(k) == v
            for k, v in query.items())])

class ReportTests(unittest.IsolatedAsyncioTestCase):
    def db(self, matches):
        return SimpleNamespace(
            cases=Collection([{'_id': 'case', 'code': '<script>bad()</script>', 'unit': 'other'}]),
            scene_traces=Collection([{'_id': 'trace', 'case_id': 'case', 'seq': 1}]),
            detainees=Collection([]), scene_matches=Collection(matches))

    async def test_filter_mock_labels_and_escape(self):
        matches = [{'_id': verdict, 'case_id': 'case', 'verdict': verdict,
                    'trace_id': 'trace', 'detainee_name': '<img onerror="bad()">'}
                   for verdict in ('match', 'review')]
        data = await ns['build_scene_report_data'](self.db(matches), 'case')
        self.assertEqual(data['match_count']['val'], 1)
        self.assertEqual(len(data['pairs']), 1)
        self.assertEqual(data['unit']['val'], 'C09')
        self.assertFalse(data['unit']['is_mock'])
        html = ns['render_html_report'](data)
        self.assertNotIn('<script>bad()', html)
        self.assertNotIn('<img onerror=', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('[Điểm đặc trưng giả lập]', html)
        self.assertNotIn('class="sr-fig-dot ', html)
        self.assertNotIn('sr-fig-dot sr-fig-dot-purple" style=', html)
        self.assertIn("dataset.paginationReady = 'true'", html)
        self.assertIn('sr-appendix-page', html)

    async def test_empty_matches_do_not_invent_pairs(self):
        data = await ns['build_scene_report_data'](self.db([]), 'case')
        self.assertEqual(data['pairs'], [])
        self.assertEqual(data['match_count']['val'], 0)

    async def test_real_trace_identity_and_multiple_pairs(self):
        matches = [
            {'_id': 'a1', 'case_id': 'case', 'verdict': 'match', 'trace_id': 'trace', 'score': 700},
            {'_id': 'a2', 'case_id': 'case', 'verdict': 'match', 'trace_id': 'trace', 'score': 950},
            {'_id': 'a3', 'case_id': 'case', 'verdict': 'match', 'trace_id': 'trace', 'score': 820},
            {'_id': 'b1', 'case_id': 'case', 'verdict': 'match', 'trace_id': '4', 'score': 910},
            {'_id': 'b2', 'case_id': 'case', 'verdict': 'match', 'trace_id': '4', 'score': 850},
            {'_id': 'c1', 'case_id': 'case', 'verdict': 'match', 'trace_id': '5', 'score': 780},
            {'_id': 'c2', 'case_id': 'case', 'verdict': 'match', 'trace_id': '5', 'score': 880},
        ]
        db = self.db(matches)
        db.scene_traces.items[0].update(seq=3, captured_at='2026-09-16T10:49:00')
        db.scene_traces.items.extend([{'_id': str(i), 'case_id': 'case', 'seq': i} for i in (4, 5)])
        data = await ns['build_scene_report_data'](db, 'case')
        self.assertEqual(data['total_lt']['val'], 3)
        self.assertEqual(data['match_count']['val'], 3)
        self.assertEqual(len(data['pairs']), 3)
        self.assertEqual(data['pairs'][0]['trace_code']['val'], 'DVHT-2026-0003')
        self.assertFalse(data['pairs'][0]['trace_code']['is_mock'])
        html = ns['render_html_report'](data)
        self.assertIn('3 ảnh dấu vết hiện trường', html)
        self.assertIn('3 cặp đối sánh', html)

    async def test_missing_case_is_404(self):
        with self.assertRaises(HTTPException) as caught:
            await ns['build_scene_report_data'](self.db([]), 'missing')
        self.assertEqual(caught.exception.status_code, 404)

    async def test_report_image_is_resized_and_landmarks_are_rasterized(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'finger.png'
            ns['Image'].new('L', (1600, 1200), 220).save(source)
            url = ns['file_to_report_data_url'](
                str(source), [{'x': 50, 'y': 50, 'is_mock': False}], '#ec4899'
            )
            self.assertTrue(url.startswith('data:image/jpeg;base64,'))
            with ns['Image'].open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))) as rendered:
                self.assertLessEqual(rendered.width, 640)
                self.assertLessEqual(rendered.height, 600)
                center = rendered.getpixel((rendered.width // 2, rendered.height // 2))
                self.assertGreater(center[0], center[1] + 40)
            with ns['Image'].open(source) as original:
                self.assertEqual(original.size, (1600, 1200))

if __name__ == '__main__':
    unittest.main()
