"""Read-only Stage 24B integration checks: no model, database or network access."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class CurrentReleaseContracts(unittest.TestCase):
    def test_no_outdated_future_feature_promises(self):
        page = source('frontend/src/pages/InterviewConfigPage.tsx')
        self.assertIn('自我陈述', page)
        self.assertIn('本地 PPT', page)
        self.assertNotIn('自我陈述环节将在下一组开发', page)

    def test_account_errors_give_current_guidance(self):
        code = source('backend/app/stage8b_auth.py')
        self.assertIn('请检查后端启动日志和本地账号数据库', code)
        self.assertNotIn('请重新安装 Stage 8C', code)
        self.assertNotIn('请确认 Stage 8A / 8B 已完成', code)

    def test_speech_message_names_dependency(self):
        self.assertIn('请在项目虚拟环境安装 faster-whisper', source('backend/app/stage9_speech.py'))

    def test_ppt_pagination_hotfix_preserved(self):
        code = source('frontend/src/components/presentation/SlideDeck.tsx')
        for token in ('parseSlidePageInput', 'PageDown', '下一页', '当前第 {currentPage} 页'):
            self.assertIn(token, code)
        presenter = source('backend/app/services/presentation_local.py')
        self.assertIn('def conversion_available(', presenter)

    def test_core_routers_and_account_boundary_preserved(self):
        main = source('backend/app/main.py')
        for token in ('initialize_account_database()', 'init_db()',
                      'stage8b_install_auth(app)', 'stage8c2_install_owner_scope(app)',
                      'app.include_router(sessions_router)'):
            self.assertIn(token, main)

    def test_two_manuals_cover_key_caveats(self):
        a = source('docs/manuals/STAGE24A_WINDOWS_INSTALL.md')
        b = source('docs/manuals/STAGE24A_USER_GUIDE.md')
        self.assertIn('npm.cmd run build', a)
        self.assertIn('storage/', a)
        self.assertIn('PyAV', a)
        for token in ('面试模式', '项目答辩模式', 'PPT', '翻页', '自我陈述', '薄弱点', '费用'):
            self.assertIn(token, b)

    def test_pdf_manuals_exist(self):
        for name in ('STAGE24A_WINDOWS_INSTALL.pdf', 'STAGE24A_USER_GUIDE.pdf'):
            pdf = ROOT / 'docs/manuals' / name
            self.assertTrue(pdf.is_file())
            self.assertGreater(pdf.stat().st_size, 5000)


if __name__ == '__main__':
    unittest.main()
