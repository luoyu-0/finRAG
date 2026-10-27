-- 仅供已存在 document_chunks 表、但缺少该索引的环境执行一次。
ALTER TABLE document_chunks
  ADD FULLTEXT INDEX ix_document_chunks_text_ngram (text) WITH PARSER ngram;
