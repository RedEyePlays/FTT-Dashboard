
import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem } from "../types";

// Vite uses import.meta.env for environment variables.
// We use optional chaining (?.) to prevent crashes if 'env' is undefined in some environments.
const apiKey = import.meta.env?.VITE_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const getFinancialInsights = async (data: InventoryItem[]): Promise<string> => {
  try {
    if (!apiKey) return "API Key is missing. Please check your .env file.";

    // Vulnerability Fix: Strip out user-provided 'notes' field to prevent prompt injection.
    const sanitizedData = data.map(({ notes, ...retainedFields }) => retainedFields);

    const dataString = JSON.stringify(sanitizedData);
    const prompt = `
      Act as a senior business analyst. Analyze the following inventory log for a flipping/reselling business.
      
      Data (JSON): ${dataString}
      
      Please provide a Markdown formatted response with:
      1. **Performance Summary**: Overall profit, margin health, and sales velocity.
      2. **Top Performers**: Which items or models are generating the best return?
      3. **Sourcing Insights**: Observations on where items are bought vs. profitability (if pattern exists).
      4. **Inventory Alert**: specific items that have been in stock too long (stale inventory) or anomalies.
      5. **Actionable Tip**: One specific strategy for next month.
      
      Keep it concise and professional.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a sharp, data-driven business consultant for a retail reseller.",
      }
    });

    return response.text || "No insights generated.";
  } catch (error) {
    console.error("Error generating insights:", error);
    return "Unable to generate insights at this time.";
  }
};

export const parseBulkInventory = async (text: string): Promise<InventoryItem[]> => {
  try {
    if (!apiKey) throw new Error("API Key is missing");

    const prompt = `
      Extract inventory items from the following text. 
      The text may contain multiple items, prices, dates, and descriptions mixed together.
      
      Text to parse:
      "${text}"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              item: {
                type: Type.STRING,
                description: "Name of the product",
              },
              date: {
                type: Type.STRING,
                description: `Purchase date (YYYY-MM-DD). If not found, use ${new Date().toISOString().split('T')[0]}.`,
              },
              purchaseCost: {
                type: Type.NUMBER,
                description: "How much it was bought for.",
              },
              boughtFrom: {
                type: Type.STRING,
                description: "Who it was bought from.",
              },
              imei: {
                type: Type.STRING,
                description: "IMEI or Serial number.",
              },
              salePrice: {
                type: Type.NUMBER,
                description: "How much it was sold for (0 if not sold).",
              },
              soldDate: {
                type: Type.STRING,
                description: "Sale date (YYYY-MM-DD).",
              },
              soldTo: {
                type: Type.STRING,
                description: "Who it was sold to.",
              },
              repairCost: {
                type: Type.NUMBER,
                description: "Any repair costs mentioned (default 0).",
              },
              notes: {
                type: Type.STRING,
                description: "Any other details.",
              },
            },
            required: ["item", "date", "purchaseCost"],
          },
        },
      }
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      // Ensure IDs are generated
      return Array.isArray(parsed) ? parsed.map((item: any) => ({
        ...item,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        repairCost: item.repairCost || 0,
        purchaseCost: item.purchaseCost || 0,
        salePrice: item.salePrice || 0,
        boughtFrom: item.boughtFrom || '',
        imei: item.imei || '',
        soldDate: item.soldDate || '',
        soldTo: item.soldTo || '',
        notes: item.notes || ''
      })) : [];
    }
    return [];
  } catch (error) {
    console.error("Error parsing bulk inventory:", error);
    throw new Error("Failed to parse inventory data.");
  }
};

export const extractImeiFromImage = async (base64Image: string): Promise<string> => {
  try {
    if (!apiKey) throw new Error("API Key is missing");

    // Remove header if present (e.g., "data:image/jpeg;base64,")
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          {
            text: "Look at this image. Find the IMEI number or Serial Number. Return ONLY the alphanumeric string. If there are multiple, prefer IMEI. Do not include labels like 'IMEI:' or 'S/N', just the number. If none found, return nothing."
          }
        ]
      }
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("Error processing image:", error);
    throw new Error("Failed to extract text from image.");
  }
};
