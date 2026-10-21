"""
ChromaDB 持久化 + 本地 BGE Embedding。

重量级依赖在首次使用时加载，
避免启动 FastAPI 时立即加载模型。
"""

from functools import lru_cache
from fastapi import Request
from app.stage11_local import get_user_settings

from app.core.config import Settings, get_settings
from app.schemas.material import MaterialHit


COLLECTION_NAME = "materials_bge_small_zh_v1"

QUERY_PREFIX = (
    "为这个句子生成表示以用于检索相关文章："
)


class VectorStore:

    def __init__(self, settings: Settings):

        self.settings = settings

        self._client = None
        self._collection_cache = None
        self._model = None

    def _collection(self):
        """获取本地 ChromaDB 集合。"""

        if self._collection_cache is None:

            import chromadb

            self.settings.chroma_dir.mkdir(
                parents=True,
                exist_ok=True
            )

            self._client = chromadb.PersistentClient(
                path=str(self.settings.chroma_dir)
            )

            self._collection_cache = (
                self._client.get_or_create_collection(
                    name=COLLECTION_NAME,
                    metadata={
                        "hnsw:space": "cosine"
                    }
                )
            )

        return self._collection_cache

    def _embed(
        self,
        texts: list[str]
    ) -> list[list[float]]:
        """本地生成向量。"""

        if self._model is None:

            from sentence_transformers import (
                SentenceTransformer
            )

            self._model = SentenceTransformer(
                self.settings.embedding_model
            )

        return self._model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False
        ).tolist()

    def add_chunks(
        self,
        material_id: str,
        filename: str,
        chunks: list[str]
    ) -> None:
        """将一份资料的文本切片写入向量库。"""

        if not chunks:
            raise ValueError(
                "没有可索引的文字切片"
            )

        vectors = self._embed(chunks)

        self._collection().upsert(
            ids=[
                f"{material_id}:{i}"
                for i in range(len(chunks))
            ],

            documents=chunks,

            embeddings=vectors,

            metadatas=[
                {
                    "material_id": material_id,
                    "original_filename": filename,
                    "chunk_index": i
                }
                for i in range(len(chunks))
            ]
        )

    def search(
        self,
        query: str,
        material_ids: list[str],
        top_k: int
    ) -> list[MaterialHit]:
        """
        只从指定资料中检索。

        查询先向量化，
        然后根据 material_id 过滤。
        """

        vector = self._embed(
            [QUERY_PREFIX + query]
        )[0]

        result = self._collection().query(
            query_embeddings=[vector],

            n_results=top_k,

            where={
                "material_id": {
                    "$in": material_ids
                }
            },

            include=[
                "documents",
                "metadatas",
                "distances"
            ]
        )

        documents = (
            result.get("documents") or [[]]
        )[0]

        metadatas = (
            result.get("metadatas") or [[]]
        )[0]

        distances = (
            result.get("distances") or [[]]
        )[0]

        return [
            MaterialHit(
                material_id=meta["material_id"],
                original_filename=meta[
                    "original_filename"
                ],
                chunk_index=int(
                    meta["chunk_index"]
                ),
                text=text,
                distance=float(distance)
            )
            for text, meta, distance
            in zip(
                documents,
                metadatas,
                distances
            )
        ]

    def delete_material(
        self,
        material_id: str
    ) -> None:
        """删除指定资料的全部向量切片。"""

        self._collection().delete(
            where={
                "material_id": material_id
            }
        )


@lru_cache(maxsize=128)
def _store_for_path(chroma_dir: str, model_id: str) -> VectorStore:
    settings = get_settings().model_copy(update={"chroma_path": chroma_dir, "embedding_model": model_id})
    return VectorStore(settings)


def get_vector_store(request: Request) -> VectorStore:
    scoped = get_user_settings(request)
    return _store_for_path(str(scoped.chroma_dir), scoped.embedding_model)