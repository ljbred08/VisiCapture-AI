
import { jsPDF } from "jspdf";

/**
 * Converts an array of base64 images into a single PDF as a base64 string.
 */
export async function imagesToPdfBase64(images: string[]): Promise<string> {
  if (images.length === 0) return "";

  // Create PDF based on first image dimensions
  // We'll use a hidden image to get dimensions
  const getDims = (src: string): Promise<{ w: number; h: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.src = src;
    });
  };

  const { w, h } = await getDims(images[0]);
  const pdf = new jsPDF({
    orientation: w > h ? "l" : "p",
    unit: "px",
    format: [w, h],
  });

  for (let i = 0; i < images.length; i++) {
    if (i > 0) {
      pdf.addPage([w, h], w > h ? "l" : "p");
    }
    // images[i] is a data URL
    pdf.addImage(images[i], "JPEG", 0, 0, w, h);
  }

  const pdfBase64 = pdf.output("datauristring").split(",")[1];
  return pdfBase64;
}
