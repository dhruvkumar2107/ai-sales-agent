import { leadSchema, type Lead } from "@axo/shared";

type Step = {
  type: "question" | "response" | "tool" | "end";
  text: string;
  result?: any;
};
import { searchCatalog, getModelDetails, calculateEMI, saveLead, lookupBooking, lookupJobCard, sendWhatsAppOrSms, transferToHuman, createTicket, endCall } from "../lib/tools";

interface Scenario {
  name: string;
  lead?: Partial<Lead>;
  steps: Step[];
}

const scenarios: Scenario[] = [
  {
    name: "new_enquiry_car_english",
    lead: {
      name: "Rahul Sharma",
      phone: "+919845012345",
      source: "website",
      interestedModel: "Hyundai Creta",
      variant: "E 1.5 Petrol MT",
      fuel: "petrol",
      budget: 1200000,
      timeline: "this_month",
      paymentMode: "loan",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "Hi, I'm looking for a new car. I saw the Hyundai Creta online and want to know more about it." },
      { type: "tool", text: "getModelDetails", result: { model: "Hyundai Creta" } },
      { type: "question", text: "Great! The Hyundai Creta E 1.5 Petrol MT has an ex-showroom price of around ₹11 lakh. What is your budget?" },
      { type: "response", text: "My budget is around ₹12 lakh." },
      { type: "tool", text: "calculateEMI", result: { price: 1200000, downPayment: 200000, tenureMonths: 60, interestRate: 9.5 } },
      { type: "question", text: "Based on ₹12 lakh price, 2 lakh down payment, 5-year tenure at 9.5% interest, the EMI is about ₹18,500 per month. Would you like a test drive?" },
      { type: "response", text: "Yes, I'd like to book a test drive." },
      { type: "tool", text: "saveLead", result: {} },
      { type: "tool", text: "book_testdrive", result: { success: true, testDriveId: "td_001" } },
      { type: "end", text: "Test drive booked! We'll send a confirmation with the address and map. Is there anything else I can help you with?" },
    ],
  },
  {
    name: "new_enquiry_bike_hindi",
    lead: {
      name: "Priya Patel",
      phone: "+919845012346",
      source: "facebook",
      interestedModel: "Honda Shine 125",
      variant: "Disc",
      fuel: "petrol",
      timeline: "this_week",
      paymentMode: "cash",
    },
    steps: [
      { type: "question", text: "Namaste! Aap kaise hain? Is gaadi showroom ka AI assistant bol raha hai. Aap kya dekh rahe hain?" },
      { type: "response", text: "Main theek hoon. Honda Shine 125 dikh rahi hai. main khareedne chahungi." },
      { type: "tool", text: "getModelDetails", result: { model: "Honda Shine 125" } },
      { type: "question", text: "Achha! Honda Shine 125 Disc variant k price ₹85,000 hai. Aapka budget kitna hai?" },
      { type: "response", text: "Mera budget ₹90,000 tak hai." },
      { type: "question", text: "Badhiya. kya aap test drive lena chahengi? Humein aapka city batayen?" },
      { type: "response", text: "Haan, main Delhi se hoon. Test drive chahungi." },
      { type: "tool", text: "saveLead", result: {} },
      { type: "tool", text: "book_testdrive", result: { success: true, testDriveId: "td_002" } },
      { type: "end", text: "Test drive bookle hue hain! Confirmation aapke phone par bhej diya jayega. Aapka shukriya!" },
    ],
  },
  {
    name: "emi_question",
    lead: {
      name: "Amit Kumar",
      phone: "+919845012347",
      source: "inbound_call",
      interestedModel: "Hyundai Creta",
      variant: "E 1.5 Petrol MT",
      fuel: "petrol",
      timeline: "this_month",
      paymentMode: "loan",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "Hi, I'm interested in the Hyundai Creta. Can you tell me the EMI?" },
      { type: "tool", text: "calculateEMI", result: { price: 1200000, downPayment: 200000, tenureMonths: 60, interestRate: 9.5 } },
      { type: "question", text: "Based on ₹12 lakh price, 2 lakh down payment, 5-year tenure at 9.5% interest, the EMI is about ₹18,500 per month. Would you like to proceed?" },
      { type: "response", text: "That seems reasonable. I'll think about it." },
      { type: "end", text: "No problem. We can discuss further when you're ready. Have a good day!" },
    ],
  },
  {
    name: "exchange_enquiry",
    lead: {
      name: "Suresh Menon",
      phone: "+919845012348",
      source: "walk_in",
      interestedModel: "Honda Unicorn",
      variant: "STD",
      fuel: "petrol",
      timeline: "this_month",
      paymentMode: "exchange",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "Hi, I want to exchange my old bike for a new Honda Unicorn." },
      { type: "question", text: "Sure! What is the make, model and year of your current bike?" },
      { type: "response", text: "I have a Honda Activa 6G from 2020." },
      { type: "question", text: "And how many kilometres has it done?" },
      { type: "response", text: "Around 25,000 kilometres." },
      { type: "question", text: "Condition? Any damages?" },
      { type: "response", text: "Just minor scratches, otherwise good." },
      { type: "question", text: "Thank you. We'll evaluate your old bike and call you back with the assessment. Would you like to book a test drive for the Unicorn in the meantime?" },
      { type: "response", text: "Yes, please. I'm visiting today." },
      { type: "tool", text: "saveLead", result: {} },
      { type: "tool", text: "book_testdrive", result: { success: true, testDriveId: "td_003" } },
      { type: "end", text: "Great! Test drive booked. We'll call you back with the exchange evaluation within 2 days. Is there anything else?" },
    ],
  },
  {
    name: "angry_service_complaint",
    lead: {
      name: "Kavita Singh",
      phone: "+919845012349",
      source: "inbound_call",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "I brought my car for service 3 weeks ago and it's still not ready! Very bad service!" },
      { type: "question", text: "Namaste, I'm sorry to hear that. Let me look up your service booking. What is your vehicle number?" },
      { type: "response", text: "MH01 AB 1234" },
      { type: "tool", text: "lookupJobCard", result: { vehicleNo: "MH01 AB 1234" } },
      { type: "question", text: "I see your Creta is ready for delivery. I apologise for the delay. Would you like to book a service ticket for this issue?" },
      { type: "response", text: "Yes, I want a ticket. This is unacceptable." },
      { type: "tool", text: "createTicket", result: { category: "service_quality", severity: "high", description: "Service delayed by 3 weeks" } },
      { type: "question", text: "I've created a high-severity ticket (tk_001). The service manager will call you within 2 hours. Is there anything else I can help with?" },
      { type: "end", text: "Thank you for your patience. We value your feedback. Have a good day." },
    ],
  },
  {
    name: "wrong_number",
    lead: {
      name: "",
      phone: "+919845012350",
      source: "other" as const,
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "Wrong number, I'm looking for someone else." },
      { type: "end", text: "Oh, sorry for the disturbance. Have a good day!" },
    ],
  },
  {
    name: "competitor_comparison",
    lead: {
      name: "Vikram Singh",
      phone: "+919845012351",
      source: "website",
      interestedModel: "Hyundai Creta",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "I'm comparing the Creta with the Seltos. Which is better?" },
      { type: "question", text: "Both are excellent SUVs. As per our configured talking points, we focus on our own features and resale value. Would you like to see the Creta's features?" },
      { type: "response", text: "Yes, show me the features." },
      { type: "end", text: "The Creta has panoramic sunroof, 6 airbags, level 2 ADAS, and 10.25-inch touchscreen. Would you like a test drive?" },
    ],
  },
  {
    name: "buy_today_triggers_transfer",
    lead: {
      name: "Deepak Joshi",
      phone: "+919845012352",
      source: "website",
      interestedModel: "Hyundai Creta",
      timeline: "this_week",
      paymentMode: "loan",
    },
    steps: [
      { type: "question", text: "Namaste! This is AXO Voice Auto. How can I help you today?" },
      { type: "response", text: "Hi, I want to buy today. I've decided I want the Creta." },
      { type: "question", text: "Wonderful! Let me get you connected with a sales executive who can help you complete the purchase. One moment please..." },
      { type: "tool", text: "transferToHuman", result: { reason: "Customer wants to buy today", department: "sales", priority: "instant" } },
      { type: "end", text: "I've transferred you to our sales executive who will help you complete the purchase. They'll call you shortly. Thank you!" },
    ],
  },
];

async function runScenario(scenario: Scenario) {
  console.log(`\n=== ${scenario.name} ===`);
  console.log(`Lead: ${JSON.stringify(scenario.lead)}`);

  for (const step of scenario.steps) {
    if (step.type === "question") {
      console.log(`AGENT: ${step.text}`);
    } else if (step.type === "response") {
      console.log(`CALLER: ${step.text}`);
    } else if (step.type === "tool") {
      const [toolName, ...rest] = step.text.split(" ");
      const tool = (tools as any)[toolName as keyof typeof tools];
      if (tool) {
        console.log(`TOOL: ${step.text} =>`);
        try {
          const result = await tool(step.result ? step.result : rest.join(" ").trim());
          console.log(`       => ${JSON.stringify(result)}`);
        } catch (e) {
          console.log(`       => Error: ${(e as Error).message}`);
        }
      } else {
        console.log(`TOOL: ${step.text} => Unknown tool`);
      }
    } else if (step.type === "end") {
      console.log(`AGENT: ${step.text}`);
      break;
    }
  }
}

const tools: any = {
  searchCatalog,
  getModelDetails,
  calculateEMI,
  saveLead,
  lookupBooking,
  lookupJobCard,
  sendWhatsAppOrSms,
  transferToHuman,
  createTicket,
  endCall,
};

async function main() {
  console.log("AXO Voice Auto - Text Call Simulator with Tools");
  console.log("=================================================\n");

  for (const scenario of scenarios) {
    await runScenario(scenario);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log("\n=== All scenarios complete ===");
}

main().catch(console.error);