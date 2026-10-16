import chromadb

from app.core.config import get_settings


def main() -> None:
    chroma_dir = get_settings().chroma_dir
    chroma_dir.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(chroma_dir))
    # 只测试存储与查询，不下载 Embedding 模型
    collection = client.get_or_create_collection(name="stage0_smoke")
    collection.upsert(
        ids=["test-1"],
        embeddings=[[0.1, 0.2, 0.3]],
        documents=["这是本地向量库连通性测试"],
    )
    result = collection.query(query_embeddings=[[0.1, 0.2, 0.3]], n_results=1)
    assert result["ids"][0][0] == "test-1"
    client.delete_collection(name="stage0_smoke")
    print(f"ChromaDB 本地向量库正常：{chroma_dir}")


if __name__ == "__main__":
    main()
