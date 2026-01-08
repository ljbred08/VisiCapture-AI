
import React, { useState, useRef, useEffect } from 'react';
import Header from './components/Header';
import ResultsTable from './components/ResultsTable';
import { Contact, ProcessingStep, ProcessingState, GeminiModel, ExtractionMode } from './types';
import { extractFrames, fileToBase64 } from './utils/videoProcessor';
import { analyzeVideoDirectly, deduplicateContacts, extractDataFromOcrText } from './services/geminiService';
import { analyzeBatchWithMistral } from './services/mistralService';
import { imagesToPdfBase64 } from './utils/pdfGenerator';

const MISTRAL_KEY_STORAGE = 'vcapture_mistral_key';
const GEMINI_MODEL_STORAGE = 'vcapture_gemini_model';
const SAMPLING_INTERVAL_STORAGE = 'vcapture_sampling_interval';
const MISTRAL_BATCH_SIZE_STORAGE = 'vcapture_mistral_batch_size';

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [mistralKey, setMistralKey] = useState<string>(() => localStorage.getItem(MISTRAL_KEY_STORAGE) || '');
  const [geminiModel, setGeminiModel] = useState<GeminiModel>(() => (localStorage.getItem(GEMINI_MODEL_STORAGE) as GeminiModel) || 'gemini-3-flash-preview');
  const [samplingInterval, setSamplingInterval] = useState<number>(() => Number(localStorage.getItem(SAMPLING_INTERVAL_STORAGE)) || 2.0);
  const [mistralBatchSize, setMistralBatchSize] = useState<number>(() => Number(localStorage.getItem(MISTRAL_BATCH_SIZE_STORAGE)) || 50);
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('contacts');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  
  const [pass1Data, setPass1Data] = useState<Contact[] | null>(null);
  const [mistralRawData, setMistralRawData] = useState<string[] | null>(null);
  const [pass2Data, setPass2Data] = useState<Contact[] | null>(null);

  const [status, setStatus] = useState<ProcessingState>({
    step: ProcessingStep.IDLE,
    progress: 0,
    message: ''
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    localStorage.setItem(MISTRAL_KEY_STORAGE, mistralKey);
  }, [mistralKey]);

  useEffect(() => {
    localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModel);
  }, [geminiModel]);

  useEffect(() => {
    localStorage.setItem(SAMPLING_INTERVAL_STORAGE, samplingInterval.toString());
  }, [samplingInterval]);

  useEffect(() => {
    localStorage.setItem(MISTRAL_BATCH_SIZE_STORAGE, mistralBatchSize.toString());
  }, [mistralBatchSize]);

  const updateStatus = (step: ProcessingStep, progress: number, message: string) => {
    setStatus({ step, progress, message });
  };

  const handleMetadataLoaded = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    setVideoDuration(e.currentTarget.duration);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setContacts([]);
    setPass1Data(null);
    setMistralRawData(null);
    setPass2Data(null);
    updateStatus(ProcessingStep.IDLE, 0, "");

    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }

    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
  };

  const expectedFrames = videoDuration ? Math.ceil(videoDuration / samplingInterval) : 0;
  const expectedBatches = Math.ceil(expectedFrames / mistralBatchSize);
  
  /**
   * Time Estimation Formula:
   * (expectedFrames * 0.2) + expectedBatches
   * Explanation: 10s per 50 frames (0.2s/frame) + 1s overhead per batch
   */
  const estimatedOcrSeconds = Math.ceil((expectedFrames * 0.2) + expectedBatches);
  
  const formatTime = (seconds: number) => {
    if (seconds <= 0) return "0s";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const startProcessing = async () => {
    const fileToProcess = selectedFile || fileInputRef.current?.files?.[0];

    if (!fileToProcess || !videoPreviewUrl) {
      alert("Please select a video file first.");
      return;
    }

    if (!mistralKey) {
      alert("Please provide a Mistral API Key in the settings before starting the high-accuracy extraction.");
      return;
    }

    if (expectedFrames > 100 || expectedBatches > 5) {
      const confirmLargeBatch = window.confirm(
        `Warning: Large Processing Task\n\nFrames to extract: ${expectedFrames}\nMistral OCR Batches: ${expectedBatches}\nEstimated Completion Time: ~${formatTime(estimatedOcrSeconds)}\n\nWould you like to proceed?`
      );
      if (!confirmLargeBatch) return;
    }

    try {
      const finalPrompt = extractionMode === 'custom' ? customPrompt : undefined;
      
      updateStatus(ProcessingStep.VIDEO_ANALYSIS, 10, `Pass 1: Running ${geminiModel} Vision Scan...`);
      const videoBase64 = await fileToBase64(fileToProcess);
      const pass1Results = await analyzeVideoDirectly(videoBase64, fileToProcess.type, geminiModel, finalPrompt);
      setPass1Data(pass1Results);
      
      updateStatus(ProcessingStep.FRAME_EXTRACTION, 30, "Extracting high-fidelity frames...");
      const frames = await extractFrames(fileToProcess, samplingInterval); 
      
      updateStatus(ProcessingStep.DETAIL_OCR, 40, `Pass 2: Preparing ${frames.length} frames for OCR...`);
      
      let mistralRawTexts: string[] = [];
      for (let i = 0; i < frames.length; i += mistralBatchSize) {
        const chunk = frames.slice(i, i + mistralBatchSize);
        const batchNum = Math.floor(i / mistralBatchSize) + 1;
        
        // Dynamic remaining time calculation: (remaining frames * 0.2) + remaining batches
        const remainingFrames = frames.length - i;
        const remainingBatches = expectedBatches - batchNum + 1;
        const estRemainingTime = Math.ceil((remainingFrames * 0.2) + remainingBatches);
        
        updateStatus(
          ProcessingStep.DETAIL_OCR, 
          40 + Math.floor((batchNum / expectedBatches) * 30), 
          `Batch ${batchNum}/${expectedBatches} in progress... (~${formatTime(estRemainingTime)} left)`
        );
        
        const pdfBase64 = await imagesToPdfBase64(chunk);
        const batchMarkdown = await analyzeBatchWithMistral(pdfBase64, mistralKey);
        
        if (batchMarkdown) mistralRawTexts.push(batchMarkdown);
      }
      setMistralRawData(mistralRawTexts);

      updateStatus(ProcessingStep.DETAIL_OCR, 75, "Synthesizing OCR text with Gemini Vision...");
      const combinedMistralText = mistralRawTexts.join('\n\n---\n\n');
      const pass2Results = await extractDataFromOcrText(combinedMistralText, geminiModel, finalPrompt);
      setPass2Data(pass2Results);

      updateStatus(ProcessingStep.DEDUPLICATION, 90, "AI deduplication and cross-reference check...");
      const allFound = [...pass1Results, ...pass2Results];
      const cleanResults = await deduplicateContacts(allFound, geminiModel, finalPrompt);

      setContacts(cleanResults);
      updateStatus(ProcessingStep.COMPLETED, 100, "Multi-pass extraction successful.");
    } catch (error: any) {
      console.error("Extraction Pipeline Error:", error);
      updateStatus(ProcessingStep.ERROR, 0, `Error: ${error.message || "Extraction pipeline failure."}`);
    }
  };

  const isProcessing = status.step !== ProcessingStep.IDLE && 
                     status.step !== ProcessingStep.COMPLETED && 
                     status.step !== ProcessingStep.ERROR;

  return (
    <div className="min-h-screen bg-gray-50 pb-12 text-gray-900 font-sans">
      <Header />
      
      <input 
        ref={fileInputRef} 
        type="file" 
        className="hidden" 
        accept="video/*" 
        onChange={handleFileUpload} 
        disabled={isProcessing} 
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm ring-1 ring-gray-900/5 transition-all hover:shadow-md">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center border-b border-gray-100 pb-2">
                <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Extraction Configuration
              </h2>
              
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Extraction Target</span>
                  <div className="flex bg-gray-100 rounded-lg p-1">
                    <button 
                      onClick={() => setExtractionMode('contacts')}
                      disabled={isProcessing}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${extractionMode === 'contacts' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                    >
                      Contacts
                    </button>
                    <button 
                      onClick={() => setExtractionMode('custom')}
                      disabled={isProcessing}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${extractionMode === 'custom' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                    >
                      Custom Query
                    </button>
                  </div>
                </div>

                {extractionMode === 'custom' && (
                  <div className="animate-fadeIn">
                    <label className="block">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">What should we extract?</span>
                      <textarea 
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="e.g. Extract all product names and their prices..."
                        className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 p-2 border h-20 bg-gray-50"
                        disabled={isProcessing}
                      />
                    </label>
                  </div>
                )}

                <div>
                  <label className="block mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Intelligence Model</span>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg">
                      <button
                        onClick={() => setGeminiModel('gemini-3-flash-preview')}
                        disabled={isProcessing}
                        className={`py-1.5 text-xs font-semibold rounded-md transition-all ${geminiModel === 'gemini-3-flash-preview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                      >
                        Flash (Fast)
                      </button>
                      <button
                        onClick={() => setGeminiModel('gemini-3-pro-preview')}
                        disabled={isProcessing}
                        className={`py-1.5 text-xs font-semibold rounded-md transition-all ${geminiModel === 'gemini-3-pro-preview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                      >
                        Pro (Smart)
                      </button>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Sampling Interval</span>
                      <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{samplingInterval.toFixed(1)}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.5" 
                      max="15.0" 
                      step="0.5"
                      value={samplingInterval}
                      onChange={(e) => setSamplingInterval(parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      disabled={isProcessing}
                    />
                    {videoDuration > 0 && (
                      <div className={`mt-3 p-3 rounded-lg text-xs flex flex-col gap-1 transition-all duration-300 ${expectedFrames > 100 || expectedBatches > 5 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-indigo-50 text-indigo-800 border border-indigo-200'}`}>
                        <div className="flex items-center font-bold">
                          <svg className="w-4 h-4 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Pipeline Estimation</span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Video Duration:</span>
                            <span className="font-semibold">{videoDuration.toFixed(1)}s</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Extracted Frames:</span>
                            <span className="font-semibold">{expectedFrames}</span>
                          </div>
                          <div className="flex justify-between border-t border-indigo-100 mt-1 pt-1">
                            <span className="text-gray-700 font-bold uppercase tracking-tighter text-[9px]">Est. Mistral OCR Time:</span>
                            <span className="font-bold text-indigo-600">{formatTime(estimatedOcrSeconds)}</span>
                          </div>
                        </div>
                        {(expectedFrames > 100 || expectedBatches > 5) && (
                          <p className="mt-2 font-bold text-amber-600 text-[10px] uppercase tracking-wider text-center bg-white/50 py-1 rounded">⚠️ High Complexity Task</p>
                        )}
                      </div>
                    )}
                  </label>
                </div>

                <div>
                  <label className="block">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Mistral PDF Batch Size</span>
                      <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{mistralBatchSize} frames</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="50" 
                      step="1"
                      value={mistralBatchSize}
                      onChange={(e) => setMistralBatchSize(parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      disabled={isProcessing}
                    />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-medium">
                      <span>1 frame / req</span>
                      <span>50 frames / PDF</span>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">Mistral OCR Key</span>
                    <input 
                      type="password" 
                      value={mistralKey}
                      onChange={(e) => setMistralKey(e.target.value)}
                      placeholder="Enter API Key to enable Pass 2"
                      className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 p-2 border bg-gray-50"
                      disabled={isProcessing}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm ring-1 ring-gray-900/5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Source Material</h2>
              <div className="space-y-4">
                {videoPreviewUrl ? (
                  <div className="space-y-4">
                    <div className="aspect-video bg-black rounded-lg overflow-hidden relative shadow-inner">
                      <video 
                        ref={videoRef}
                        src={videoPreviewUrl} 
                        className="w-full h-full object-contain" 
                        controls 
                        onLoadedMetadata={handleMetadataLoaded}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="text-center py-2 text-sm text-gray-600 hover:text-gray-800 font-medium border border-gray-200 rounded-md bg-gray-50 transition-colors"
                      >
                        Change
                      </button>
                      <button 
                        onClick={startProcessing}
                        disabled={isProcessing}
                        className={`text-center py-2 text-sm text-white font-bold rounded-md shadow-sm transition-all ${
                          !mistralKey ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                        }`}
                      >
                        {isProcessing ? 'Processing...' : 'Run Analysis'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-all"
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4">
                        <div className="p-3 bg-white rounded-full shadow-sm mb-3">
                          <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                        </div>
                        <p className="mb-1 text-sm text-gray-900 font-semibold text-center">Select Video File</p>
                        <p className="text-xs text-gray-500 text-center">Vision-Led Intelligence</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {status.step !== ProcessingStep.IDLE && (
              <div className="bg-white p-6 rounded-xl shadow-sm ring-1 ring-gray-900/5 overflow-hidden relative border-t-4 border-indigo-600">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Execution Stack</h3>
                  <span className={`text-[10px] uppercase font-bold tracking-tighter px-2 py-0.5 rounded ${
                    status.step === ProcessingStep.ERROR ? 'bg-red-100 text-red-700' :
                    status.step === ProcessingStep.COMPLETED ? 'bg-green-100 text-green-700' :
                    'bg-indigo-100 text-indigo-700'
                  }`}>
                    {status.step.replace('_', ' ')}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3 overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-700 ease-in-out ${status.step === ProcessingStep.ERROR ? 'bg-red-500' : 'bg-indigo-600'}`} 
                    style={{ width: `${status.progress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-600 font-medium italic">Current: {status.message}</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm relative overflow-hidden group">
                <div className="relative z-10">
                  <h2 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">Intelligence Ledger</h2>
                  <p className="text-gray-500 text-sm max-w-lg leading-relaxed">
                    Extracted from {geminiModel.includes('pro') ? 'Gemini 3 Pro' : 'Gemini 3 Flash'} and Mistral OCR batches.
                  </p>
                </div>
              </div>
              
              <ResultsTable contacts={contacts} onUpdate={setContacts} />

              {(pass1Data || mistralRawData || pass2Data) && (
                <div className="space-y-4 mt-12 border-t border-gray-200 pt-8">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 px-2">Pipeline Inspection</h3>
                  
                  {pass1Data && (
                    <details className="group bg-white rounded-xl shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
                      <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 list-none">
                        <div className="flex items-center space-x-3">
                          <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Pass 1</span>
                          <span className="text-sm font-semibold text-gray-700">Vision Analysis (Native Video)</span>
                        </div>
                        <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </summary>
                      <div className="p-4 bg-gray-50 border-t border-gray-100">
                        <pre className="text-[11px] font-mono text-gray-600 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(pass1Data, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}

                  {mistralRawData && (
                    <details className="group bg-white rounded-xl shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
                      <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 list-none">
                        <div className="flex items-center space-x-3">
                          <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Pass 2 - Raw</span>
                          <span className="text-sm font-semibold text-gray-700">OCR Frame Batches</span>
                        </div>
                        <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </summary>
                      <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-4 max-h-[400px] overflow-y-auto">
                        {mistralRawData.map((text, i) => (
                          <div key={i} className="bg-white p-3 rounded border border-gray-200 shadow-sm">
                            <div className="text-[10px] font-bold text-gray-400 mb-2 uppercase tracking-widest border-b pb-1">Batch {i + 1}</div>
                            <div className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed prose prose-sm max-w-none">
                              {text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {pass2Data && (
                    <details className="group bg-white rounded-xl shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
                      <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 list-none">
                        <div className="flex items-center space-x-3">
                          <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Pass 2 - Synthesized</span>
                          <span className="text-sm font-semibold text-gray-700">Structured OCR Findings</span>
                        </div>
                        <svg className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </summary>
                      <div className="p-4 bg-gray-50 border-t border-gray-100">
                        <pre className="text-[11px] font-mono text-gray-600 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(pass2Data, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        summary::-webkit-details-marker {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default App;
