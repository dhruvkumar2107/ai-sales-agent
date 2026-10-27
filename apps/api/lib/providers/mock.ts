// Mock STT provider - converts audio text (for demo purposes)
export async function mockSTT(audioBuffer: Buffer, language?: string): Promise<{text: string, language: string}> {
  // In a real implementation, this would call Deepgram, Sarvam, etc.
  // For now, return a simulated transcript based on common phrases
  const lang = language || "en";
  
  return {
    text: "[STT placeholder - audio received]",
    language: lang,
  };
}

// Mock LLM provider - generates agent response (for demo purposes)
export async function mockLLM(messages: Array<{role: string, text: string}>, tools?: any, toolChoice?: string): Promise<{
  text: string;
  toolCalls?: Array<{name: string, args: any}>;
  language: string;
}> {
  // Get the last user message
  const lastUserMessage = messages.filter((m: any) => m.role === "caller").pop();
  
  const userText = lastUserMessage?.text || "";
  
  // Simple rule-based responses for demo
  const text = generateAgentResponse(userText);
  
  // Check if a tool should be called
  const toolCalls = checkForToolCall(userText);
  
  return {
    text,
    toolCalls,
    language: "en",
  };
}

function generateAgentResponse(userText: string): string {
  const lower = userText.toLowerCase();
  
  if (lower.includes("emi") || lower.includes("installment")) {
    return "Based on the price and your down payment, the EMI would be around ₹18,500 per month. Would you like to proceed?";
  }
  
  if (lower.includes("test drive") || lower.includes("drive")) {
    return "Great! I can help you book a test drive. What's your city and preferred date?";
  }
  
  if (lower.includes("exchange") || lower.includes("old bike") || lower.includes("old car")) {
    return "Sure! I'll need the make, model and year of your current vehicle, plus the kilometers. We'll evaluate it and call you back with the assessment.";
  }
  
  if (lower.includes("buy") || lower.includes("purchase")) {
    return " wonderful! Let's get you into the showroom. What's your preferred date and time for a visit?";
  }
  
  if (lower.includes("complaint") || lower.includes("problem") || lower.includes("issue")) {
    return "I'm sorry to hear that. Let me create a ticket for our service team to follow up with you. What's your vehicle number?";
  }
  
  if (lower.includes("thank") || lower.includes("good")) {
    return "Thank you! We appreciate your time. Is there anything else I can help you with today?";
  }
  
  return "Namaste! I'm here to help you find the perfect vehicle. Are you looking for a bike or a car today?";
}

function checkForToolCall(userText: string): Array<{name: string, args: any}> | undefined {
  const lower = userText.toLowerCase();
  
  if (lower.includes("calculate emi") || lower.includes("emi for")) {
    // Would need price, down payment, tenure, rate from context
    return undefined;
  }
  
  if (lower.includes("book test drive")) {
    return [{ name: "book_testdrive", args: { model: "unknown", date: "unknown" } }];
  }
  
  if (lower.includes("create ticket")) {
    return [{ name: "create_ticket", args: { category: "service", description: "Customer complaint", severity: "high" } }];
  }
  
  return undefined;
}

// Mock TTS provider - converts text to audio (for demo purposes)
export async function mockTTS(text: string, language?: string): Promise<Buffer> {
  // In a real implementation, this would call ElevenLabs, Sarvam, etc.
  // For now, return a dummy buffer
  console.log(`[TTS] "${text}" in ${language || "en"}`);
  return Buffer.from([0x44, 0xAA, 0xBB, 0xCC]); // dummy audio bytes
}