import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { InventoryItem, ChatMessage } from "../types";

// All Gemini calls now go through the `aiGenerate` Cloud Function, which holds
// the API key server-side (Firebase Secret Manager) and requires an
// authenticated caller. The key is NEVER present in the client bundle.
const aiGenerate = httpsCallable(functions, "aiGenerate");

// A conversational turn as the callable expects it.
interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

export const getFinancialInsights = async (data: InventoryItem[]): Promise<string> => {
  try {
    const result = await aiGenerate({ op: "insights", data });
    const { text } = (result.data ?? {}) as { text?: string };
    return text || "No insights generated.";
  } catch (error) {
    console.error("Error generating insights:", error);
    return "Unable to generate insights at this time.";
  }
};

export const parseBulkInventory = async (text: string): Promise<InventoryItem[]> => {
  try {
    const result = await aiGenerate({ op: "bulkParse", text });
    const { items } = (result.data ?? {}) as { items?: any[] };

    // Ensure IDs are generated and defaults are applied (unchanged from before).
    return Array.isArray(items)
      ? items.map((item: any) => ({
          ...item,
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          repairCost: item.repairCost || 0,
          purchaseCost: item.purchaseCost || 0,
          salePrice: item.salePrice || 0,
          boughtFrom: item.boughtFrom || "",
          imei: item.imei || "",
          soldDate: item.soldDate || "",
          soldTo: item.soldTo || "",
          notes: item.notes || "",
        }))
      : [];
  } catch (error) {
    console.error("Error parsing bulk inventory:", error);
    throw new Error("Failed to parse inventory data.");
  }
};

export const extractImeiFromImage = async (base64Image: string): Promise<string> => {
  try {
    const result = await aiGenerate({ op: "imeiExtract", base64Image });
    const { text } = (result.data ?? {}) as { text?: string };
    return text?.trim() || "";
  } catch (error) {
    console.error("Error processing image:", error);
    throw new Error("Failed to extract text from image.");
  }
};

/**
 * Conversational assistant over the inventory. `messages` is the running list of
 * chat messages (the UI-only 'welcome' message is stripped here). Returns the
 * assistant's reply text.
 */
export const generateChatResponse = async (
  inventory: InventoryItem[],
  messages: ChatMessage[]
): Promise<string> => {
  const history: ChatTurn[] = messages
    .filter((m) => m.id !== "welcome")
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  const result = await aiGenerate({ op: "chat", inventory, history });
  const { text } = (result.data ?? {}) as { text?: string };
  return text || "I'm having trouble analyzing that right now.";
};
