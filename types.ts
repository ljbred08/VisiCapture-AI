
export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
  company?: string;
  other?: string;
  [key: string]: any; // Allow for custom fields
}

export type GeminiModel = 'gemini-3-flash-preview' | 'gemini-3-pro-preview';
export type ExtractionMode = 'contacts' | 'custom';

export enum ProcessingStep {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  VIDEO_ANALYSIS = 'VIDEO_ANALYSIS',
  FRAME_EXTRACTION = 'FRAME_EXTRACTION',
  DETAIL_OCR = 'DETAIL_OCR',
  DEDUPLICATION = 'DEDUPLICATION',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ProcessingState {
  step: ProcessingStep;
  progress: number;
  message: string;
}
