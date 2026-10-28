export interface ResumeInfo {
  id: string
  original_filename: string
  file_size: number
  created_at: string
}

export interface ResumeDetail extends ResumeInfo {
  full_text: string
  structured_data: Record<string, unknown>
}

export interface MaterialInfo {
  id: string
  original_filename: string
  file_size: number
  chunk_count: number
  created_at: string
}

export interface MaterialSearchRequest {
  query: string
  material_ids: string[]
  top_k: number
}

export interface MaterialSearchHit {
  material_id: string
  original_filename: string
  chunk_index: number
  text: string
  distance: number
}

export interface MaterialSearchResponse {
  hits: MaterialSearchHit[]
}
