import type { CallOutcome } from "@axo/shared";

export type Step = string | { wait: number };

export interface Scenario {
  id: string;
  title: string;
  agentId: string;
  direction?: "inbound" | "outbound";
  callerPhone?: string;
  campaignType?: string;
  steps: Step[];
  expect: {
    tools?: string[];
    notTools?: string[];
    outcome?: CallOutcome[];
    language?: string;
    agentSays?: RegExp[];
    agentNeverSays?: RegExp[];
  };
}

const CAR = "agent-car-showroom";
const BIKE = "agent-two-wheeler";
const SERVICE = "agent-service-center";

/** Scripted caller conversations. Run with `pnpm simulate` (add --llm anthropic for real Claude). */
export const SCENARIOS: Scenario[] = [
  {
    id: "new-enquiry",
    title: "New enquiry: car price question, English",
    agentId: CAR,
    steps: ["Hi, I'm looking for a compact SUV. What's the price of the Venue?", "Okay thanks, that's all for now."],
    expect: { tools: ["get_model_details"], outcome: ["info_provided", "lead_captured"], agentSays: [/lakh/i], agentNeverSays: [/discount guaranteed/i] },
  },
  {
    id: "test-drive-en",
    title: "Test drive booking end to end, English",
    agentId: CAR,
    steps: ["Hello, I want to book a test drive of the Creta tomorrow", "My name is Rahul", "11 am please", "Yes, please confirm", "That's all, thank you"],
    expect: { tools: ["check_testdrive_slots", "book_testdrive"], outcome: ["test_drive_booked"], language: "en" },
  },
  {
    id: "test-drive-hi",
    title: "Test drive booking end to end, Hindi",
    agentId: CAR,
    steps: ["नमस्ते, मुझे क्रेटा की टेस्ट ड्राइव चाहिए कल", "मेरा नाम राहुल है", "सुबह 11 बजे", "हाँ ठीक है", "बस, धन्यवाद"],
    expect: { tools: ["check_testdrive_slots", "book_testdrive"], outcome: ["test_drive_booked"], language: "hi" },
  },
  {
    id: "emi",
    title: "EMI question uses calculator, never invents numbers",
    agentId: CAR,
    steps: ["What would the EMI be for the Creta?", "Thanks, bye"],
    expect: { tools: ["get_model_details", "calculate_emi"], agentSays: [/EMI|estimate/i] },
  },
  {
    id: "exchange",
    title: "Exchange enquiry captures old vehicle, no valuation",
    agentId: CAR,
    steps: ["I want to exchange my old car for a new Verna", "It's an old Honda City, 2017 model, done about 65000 km, condition is good", "No thanks, that's all"],
    expect: { tools: ["save_lead"], agentNeverSays: [/(worth|value of|we can give you)\s.*(lakh|thousand)/i] },
  },
  {
    id: "buy-today",
    title: "Hot lead: 'I want to buy today' triggers live transfer",
    agentId: CAR,
    steps: ["I want to buy the Creta today, I'm visiting the showroom this evening"],
    expect: { tools: ["save_lead", "transfer_to_human"], outcome: ["transferred", "callback_scheduled"] },
  },
  {
    id: "angry-complaint",
    title: "Angry service complaint with safety issue escalates to manager",
    agentId: SERVICE,
    steps: ["This is the worst service ever! I picked up my car yesterday and the brakes are making noise again. Third time!"],
    expect: { tools: ["create_ticket", "transfer_to_human"], outcome: ["transferred", "callback_scheduled"] },
  },
  {
    id: "wrong-number",
    title: "Wrong number ends politely",
    agentId: BIKE,
    steps: ["Sorry, wrong number"],
    expect: { tools: ["end_call"], outcome: ["wrong_number"] },
  },
  {
    id: "silence",
    title: "Silent caller: two re-prompts then hang up",
    agentId: BIKE,
    steps: [{ wait: 2500 }],
    expect: { outcome: ["silence"], agentSays: [/line par|still there|लाइन/i] },
  },
  {
    id: "competitor",
    title: "Competitor comparison uses talking points only",
    agentId: CAR,
    steps: ["Is the Creta better than the Seltos?", "Okay, thanks"],
    expect: { tools: ["get_model_details"], agentNeverSays: [/seltos (is|has) (bad|worse|poor)/i, /worse than/i] },
  },
  {
    id: "opt-out",
    title: "Opt-out request is honoured instantly",
    agentId: BIKE,
    direction: "outbound",
    campaignType: "festive_offer",
    steps: ["Please don't call me again"],
    expect: { tools: ["record_opt_out", "end_call"], outcome: ["opted_out"] },
  },
  {
    id: "service-booking",
    title: "Service booking in Hinglish",
    agentId: SERVICE,
    steps: ["Mujhe gaadi ki service book karni hai", "Number KA01AB1234 hai", "Mera naam Suresh hai, kal subah", "10 baje", "Bas dhanyavaad"],
    expect: { tools: ["check_service_slots", "book_service"], outcome: ["service_booked"], language: "hinglish" },
  },
  {
    id: "service-status",
    title: "Service status verifies the vehicle before sharing",
    agentId: SERVICE,
    callerPhone: "+919845012345",
    steps: ["Is my car ready? Number is KA03MN4567", "Thank you"],
    expect: { tools: ["lookup_job_card"] },
  },
];
