
/**
 * Mistral OCR Service
 */

export async function analyzeBatchWithMistral(pdfBase64: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error("Mistral API Key is required for the high-accuracy detail pass.");
  }

  try {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: {
          type: "document_url",
          document_url: `data:application/pdf;base64,${pdfBase64}`
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Mistral API error (${response.status}): ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    
    if (data.pages && data.pages.length > 0) {
      return data.pages.map((page: any) => page.markdown).join('\n\n');
    }

    return '';
  } catch (error: any) {
    console.error("Mistral OCR Batch Pass failed:", error);
    throw error;
  }
}

// Deprecated in favor of batching, but kept for compatibility if needed
export async function analyzeFrameWithMistral(frameBase64: string, apiKey: string): Promise<string> {
    return analyzeBatchWithMistral(frameBase64, apiKey);
}
