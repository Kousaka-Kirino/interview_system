"""Group11 regression tests run on temp data and a mocked model; no paid requests."""
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from zipfile import ZipFile

import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.materials import router as materials_router
from app.api.sessions import router as sessions_router
from app.core.database import Base, get_db
from app.models.material import Material
from app.models.resume import Resume
from app.models.session import InterviewSession
from app.models.report import InterviewAIReport  # noqa: F401
from app.services.deepseek_interview import get_interview_llm
from app.services.vector_store import get_vector_store
from app.stage11_local import get_user_settings
from app.stage8b_auth import require_owner_id
from app.services.presentation_local import slide_texts, original_path, render_png, PresentationError


def make_pptx():
    output = BytesIO()
    with ZipFile(output, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types>application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml</Types>')
        z.writestr('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1" /></p:sldIdLst></p:presentation>')
        z.writestr('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>')
        z.writestr('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第1页 研究样本500份</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    return output.getvalue()


class LLM:
    calls = 0
    def _complete_json(self, system, user, **kwargs):
        self.calls += 1
        if 'slide_text' in user:
            return {'question': '这一页的实验样本如何选择？', 'risk': '数据来源不够详细', 'suggestion': '补充抽样方法与数据来源'}
        return {'summary': '说明完整但需解释实验方法', 'strengths': ['背景明确'], 'improvements': ['补充基线'],
                'followup_question': '你刚刚讲的实验准确率如何与基线比较？'}
    def generate_question(self, **kwargs):
        return '请介绍项目的核心方法？'


class Store:
    def search(self, *args):
        from app.schemas.material import MaterialHit
        return [MaterialHit(material_id=args[1][0],original_filename='幻灯片',chunk_index=0,text='实验样本 500 份，准确率 90%',distance=0.3)]


@pytest.fixture
def env(tmp_path):
    engine = create_engine('sqlite:///'+str(tmp_path/'test.sqlite'),connect_args={'check_same_thread':False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine,expire_on_commit=False)
    uid=str(uuid4());material_id=str(uuid4())
    upload=tmp_path/'uploads'
    (upload/'materials').mkdir(parents=True)
    original_path(upload,material_id).write_bytes(make_pptx())
    with factory() as db:
        db.add(Material(id=material_id,original_filename='演示稿_PPTX文字提取版.docx', stored_filename=material_id+'.docx', file_size=80, chunk_count=1))
        db.commit()
    model=LLM()
    app=FastAPI()
    app.include_router(materials_router)
    app.include_router(sessions_router)
    def db_provider():
        with factory() as session:yield session
    app.dependency_overrides[get_db]=db_provider
    app.dependency_overrides[get_user_settings]=lambda: SimpleNamespace(uploads_dir=upload)
    app.dependency_overrides[get_interview_llm]=lambda: model
    app.dependency_overrides[get_vector_store]=lambda: Store()
    app.dependency_overrides[require_owner_id]=lambda: uid
    with TestClient(app) as client:
        yield client, factory, model, upload, material_id
    engine.dispose()


def test_local_original_slide_metadata_and_no_conversion_until_image_request(env):
    client,db,model,uploads,material=env
    result=client.get(f'/api/materials/{material}/slides')
    assert result.status_code==200,result.text
    info=result.json()
    assert info['has_original'] and info['page_count']==1
    assert '研究样本500份' in info['pages'][0]['text']
    assert model.calls==0


def test_slide_review_is_explicit_and_cached(env):
    client,db,model,uploads,material=env
    url=f'/api/materials/{material}/slides/1/review'
    assert model.calls==0
    first=client.post(url)
    assert first.status_code==200,first.text
    assert '实验样本' in first.json()['question']
    assert client.post(url).status_code==200
    assert model.calls==1
    assert client.post(f'/api/materials/{material}/slides/2/review').status_code==404


def test_invalid_material_does_not_expose_files(env):
    client,db,model,uploads,material=env
    assert client.get('/api/materials/../../storage/secrets/slides').status_code!=200
    assert client.get(f'/api/materials/{uuid4()}/slides').status_code==404
    with pytest.raises(ValueError):
        original_path(uploads, '../outside')


def test_old_text_derivative_falls_back_without_native_original(env):
    client,db,model,uploads,material=env
    original_path(uploads,material).unlink()
    document=Document()
    document.add_paragraph('源自 PPTX')
    document.add_heading('第 1 页', level=2)
    document.add_paragraph('实验设计与结论')
    document.save(uploads/'materials'/(material+'.docx'))
    result=client.get(f'/api/materials/{material}/slides')
    assert result.status_code==200
    assert result.json()['has_original'] is False
    assert result.json()['pages'][0]['text']=='实验设计与结论'
    assert client.get(f'/api/materials/{material}/slides/1/image').status_code==404


def test_opening_replaces_only_pending_first_question_and_caches(env):
    client, db_factory,model,uploads, material=env
    created=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]})
    assert created.status_code==201,created.text
    sid=created.json()['id']
    assert client.get(f'/api/interviews/{sid}/opening').json()['completed'] is False
    text='本次研究针对真实应用场景，建立了多种算法的实验对照组，并收集了五百份测试样本评估模型稳定性。'
    result=client.post(f'/api/interviews/{sid}/opening',json={'text':text})
    assert result.status_code==200,result.text
    assert model.calls==1
    assert client.post(f'/api/interviews/{sid}/opening',json={'text':text}).status_code==200
    assert model.calls==1
    read=client.get(f'/api/interviews/{sid}').json()
    assert read['turns'][0]['question']==result.json()['followup_question']
    assert client.get(f'/api/interviews/{sid}/opening').json()['completed'] is True
    with db_factory() as db:
        saved=db.get(InterviewSession,sid)
        assert saved.config_data['opening_statement']==text


def test_opening_requires_defense_and_valid_text(env):
    client,db,model,uploads,material=env
    sid=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]}).json()['id']
    assert client.post(f'/api/interviews/{sid}/opening',json={'text':'短'}).status_code==422
    assert client.get(f'/api/interviews/{uuid4()}/opening').status_code==404
    assert model.calls==0


def test_render_page_checks_range_before_converter(env):
    _,__,___,uploads,material=env
    with pytest.raises(PresentationError):
        render_png(uploads,material,0,1)
    with pytest.raises(PresentationError):
        render_png(uploads,material,2,1)


def test_pptx_upload_keeps_native_copy_without_schema_change(env, monkeypatch):
    client, db_factory, model, uploads, _ = env
    import app.stage10_pptx as importer
    from app.stage10_pptx import import_pptx
    from app.services.presentation_local import remove_presentation_files

    # The private ASGI transport accesses the same app as the outer request.
    from app.api.materials import router as materials_router
    from app.api.sessions import router as sessions_router
    from app.services.vector_store import get_vector_store
    from app.stage11_local import get_user_settings
    from app.core.database import get_db
    from app.stage8b_auth import require_owner_id
    from app.services.material_parser import split_text
    from fastapi import FastAPI
    app = FastAPI()
    app.add_api_route('/api/pptx-import', import_pptx, methods=['POST'])
    app.include_router(materials_router)
    class Indexed:
        def add_chunks(self, material_id, name, chunks):
            assert chunks
        def delete_material(self, material_id):
            return None
    def db_provider():
        with db_factory() as db: yield db
    app.dependency_overrides[get_db] = db_provider
    app.dependency_overrides[get_user_settings] = lambda: SimpleNamespace(uploads_dir=uploads)
    app.dependency_overrides[get_vector_store] = lambda: Indexed()
    app.dependency_overrides[require_owner_id] = lambda: 'local-user'
    monkeypatch.setattr(importer, 'require_owner_id', lambda request: 'local-user')
    monkeypatch.setattr(importer, 'account_settings', lambda user_id: SimpleNamespace(uploads_dir=uploads))
    with TestClient(app) as upload_client:
        response = upload_client.post('/api/pptx-import', files={
            'file': ('我的答辩.pptx', make_pptx(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')})
        assert response.status_code == 201, response.text
        material_id = response.json()['id']
        assert original_path(uploads, material_id).read_bytes() == make_pptx()
        with db_factory() as db:
            row = db.get(Material, material_id)
            assert row.stored_filename.endswith('.docx')
            assert row.original_filename.endswith('_PPTX文字提取版.docx')
        listing = upload_client.get(f'/api/materials/{material_id}/slides').json()
        assert listing['has_original'] and listing['page_count'] == 1
        assert upload_client.delete(f'/api/materials/{material_id}').status_code == 204
        assert not original_path(uploads, material_id).exists()
