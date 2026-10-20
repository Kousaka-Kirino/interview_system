"""Run isolated compatibility tests without touching the user's storage or models."""
from __future__ import annotations
import io
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from zipfile import ZipFile

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.testclient import TestClient
from docx import Document

root = Path(__file__).resolve().parents[1]
backend = Path(sys.argv[1]) if len(sys.argv) > 1 else (root / 'backend')
sys.path.insert(0, str(backend))

# Avoid importing the real users' auth/database when testing parser.
stub = ModuleType('app.stage8b_auth')
def owner(req: Request):
    if req.cookies.get('session') != 'test':
        raise HTTPException(401, 'not authenticated')
    return 'test-owner'
stub.require_owner_id = owner
sys.modules['app.stage8b_auth'] = stub
from app.stage10_pptx import extract_pptx_pages, convert_pptx_to_docx, router


def sample(slide2_text='第二页重点'):
    buf = io.BytesIO()
    ct = b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'
    presentation = b'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="255" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
    rels = b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'
    def slide(text):
        return ('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>' + text + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>').encode('utf-8')
    with ZipFile(buf, 'w') as z:
        z.writestr('[Content_Types].xml',ct)
        z.writestr('ppt/presentation.xml',presentation)
        z.writestr('ppt/_rels/presentation.xml.rels',rels)
        z.writestr('ppt/slides/slide1.xml',slide('第一页结论'))
        z.writestr('ppt/slides/slide2.xml',slide(slide2_text))
    return buf.getvalue()


payload = sample()
pages = extract_pptx_pages(payload)
assert pages == [(1, ['第二页重点']), (2, ['第一页结论'])], pages
print('[OK] slide reordering and page markers')
doc = Document(io.BytesIO(convert_pptx_to_docx(payload, '课题.pptx')))
text = '\n'.join(p.text for p in doc.paragraphs)
assert '第 1 页' in text and '第 2 页' in text and text.index('第二页重点') < text.index('第一页结论')
print('[OK] DOCX text derivative contains slide numbers')
try:
    extract_pptx_pages(b'not-a-pptx')
    raise AssertionError('invalid PPTX accepted')
except ValueError:
    pass
print('[OK] invalid archive rejected')
try:
    extract_pptx_pages(sample(''))
except ValueError:
    raise AssertionError('another slide contains text; should still be accepted')
print('[OK] empty individual slide allowed')

app = FastAPI()
@app.post('/api/materials', status_code=201)
async def material_upload(request: Request, file: UploadFile = File(...)):
    owner(request)
    content = await file.read()
    assert file.filename.endswith('.docx')
    assert content[:2] == b'PK'
    return {'id': 'generated', 'original_filename': file.filename, 'file_size': len(content), 'chunk_count': 2}
app.include_router(router)
client = TestClient(app)
response = client.post('/api/materials/pptx-import', files={'file':('论文.pptx', payload, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')}, cookies={'session': 'test'})
assert response.status_code == 201, response.text
assert 'PPTX文字提取版.docx' in response.json()['original_filename']
print('[OK] PPTX upload reuses existing indexed-material API')
response = client.post('/api/materials/pptx-import', files={'file':('论文.pptx', payload, 'application/octet-stream')})
assert response.status_code == 401, response.text
print('[OK] unauthenticated PPTX upload blocked')
response = client.post('/api/materials/pptx-import', files={'file':('old.ppt', b'x'*128, 'application/octet-stream')}, cookies={'session':'test'})
assert response.status_code == 415, response.text
print('[OK] legacy .ppt rejected explicitly')
response = client.post('/api/materials/pptx-import', files={'file':('big.pptx', b'x'*(12*1024*1024+1), 'application/octet-stream')}, cookies={'session':'test'})
assert response.status_code == 413, response.text
print('[OK] oversized PPTX rejected')
print('Stage 10: 8 test cases passed.')
