
import { GoogleGenAI, Type } from "@google/genai";
import { Contact, GeminiModel } from "../types";

const CONTACT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Full name or primary identifier" },
      phone: { type: Type.STRING, description: "Phone number if applicable" },
      email: { type: Type.STRING, description: "Email address if applicable" },
      role: { type: Type.STRING, description: "Job title, role, or secondary detail" },
      company: { type: Type.STRING, description: "Company or organization name" },
      other: { type: Type.STRING, description: "Any other relevant info" }
    },
    propertyOrdering: ["name", "phone", "email", "role", "company", "other"]
  }
};

const GENERIC_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      item_name: { type: Type.STRING, description: "The primary name or title of the extracted entity" },
      category: { type: Type.STRING, description: "The type or category of the entity" },
      description: { type: Type.STRING, description: "A summary or description of the found item" },
      details: { type: Type.STRING, description: "Specific technical details or values found" },
      timestamp: { type: Type.STRING, description: "If a specific time or frame is relevant" }
    }
  }
};

function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e2) {
        console.error("Failed to parse extracted JSON", e2);
      }
    }
    return null;
  }
}

export async function analyzeVideoDirectly(
  videoBase64: string, 
  mimeType: string, 
  model: GeminiModel,
  customPrompt?: string
): Promise<Contact[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const isCustom = !!customPrompt;
  const prompt = isCustom 
    ? `Analyze this video and extract the following: ${customPrompt}. Return a clean list in JSON format.`
    : "Extract every piece of contact information shown visually in this video. Look for names, phone numbers, and email addresses. Return a clean list in JSON format.";

  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: videoBase64,
              mimeType: mimeType
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: isCustom ? GENERIC_SCHEMA : CONTACT_SCHEMA
    }
  });

  return extractJson(response.text || '[]') || [];
}

export async function extractDataFromOcrText(
  rawText: string, 
  model: GeminiModel,
  customPrompt?: string
): Promise<Contact[]> {
  if (!rawText || rawText.trim().length < 10) return [];

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const isCustom = !!customPrompt;
  const prompt = isCustom
    ? `The following text was extracted from a video frame using OCR. Based on this text, extract: ${customPrompt}. Clean up noise and return as a JSON array.`
    : `The following text was extracted from a video frame using Mistral OCR. Identify and extract all contact details (Name, Phone, Email, Role, Company). Clean up any OCR noise or artifacts. Return as a JSON array.`;

  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        text: `${prompt}\n\nText: ${rawText}`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: isCustom ? GENERIC_SCHEMA : CONTACT_SCHEMA
    }
  });

  return extractJson(response.text || '[]') || [];
}

export async function deduplicateContacts(
  contacts: Contact[], 
  model: GeminiModel,
  customPrompt?: string
): Promise<Contact[]> {
  if (contacts.length === 0) return [];
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const isCustom = !!customPrompt;
  const context = isCustom ? `based on the goal: ${customPrompt}` : "contact records";

  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        text: `Merge and deduplicate the following ${context} extracted from both Video Analysis and OCR passes. 
        - Combine partial matches for the same entity.
        - Prioritize accuracy.
        
        Data: ${JSON.stringify(contacts)}`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: isCustom ? GENERIC_SCHEMA : CONTACT_SCHEMA
    }
  });

  return extractJson(response.text || '[]') || contacts;
}
