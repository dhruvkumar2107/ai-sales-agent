// Standalone seed script - writes demo data to .data/seed.json
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const modelsData = [
  { brand: "Honda", model: "Shine 125", type: "bike", fuel: "petrol", variants: ["Drum", "Disc"], price: 80000 },
  { brand: "Honda", model: "SP 125", type: "bike", fuel: "petrol", variants: ["Disc"], price: 91000 },
  { brand: "Honda", model: "Activa 6G", type: "scooter", fuel: "petrol", variants: ["STD", "H-Smart"], price: 78000 },
  { brand: "Honda", model: "Dio 125", type: "scooter", fuel: "petrol", variants: ["Smart"], price: 90000 },
  { brand: "Honda", model: "Unicorn", type: "bike", fuel: "petrol", variants: ["STD"], price: 112000 },
  { brand: "Honda", model: "Hornet 2.0", type: "bike", fuel: "petrol", variants: ["STD"], price: 140000 },
  { brand: "Honda", model: "CB350", type: "bike", fuel: "petrol", variants: ["DLX Pro"], price: 210000 },
  { brand: "Honda", model: "Activa e", type: "scooter", fuel: "ev", variants: ["Standard"], price: 117000 },
  { brand: "Hyundai", model: "Creta", type: "car", fuel: "petrol", variants: ["E 1.5 Petrol MT", "SX 1.5 Diesel AT"], price: 1100000 },
  { brand: "Hyundai", model: "Venue", type: "car", fuel: "petrol", variants: ["S 1.2 Petrol MT", "SX(O) 1.0 Turbo DCT"], price: 850000 },
  { brand: "Hyundai", model: "i20", type: "car", fuel: "petrol", variants: ["Sportz 1.2 MT"], price: 820000 },
  { brand: "Hyundai", model: "Exter", type: "car", fuel: "cng", variants: ["S CNG"], price: 850000 },
  { brand: "Hyundai", model: "Verna", type: "car", fuel: "petrol", variants: ["SX 1.5 Petrol IVT"], price: 1450000 },
  { brand: "Hyundai", model: "Alcazar", type: "car", fuel: "diesel", variants: ["Prestige 1.5 Diesel AT"], price: 2050000 },
  { brand: "Hyundai", model: "Ioniq 5", type: "car", fuel: "ev", variants: ["Long Range RWD"], price: 4600000 },
  { brand: "BMW", model: "G 310 R", type: "bike", fuel: "petrol", variants: ["Standard"], price: 300000 },
  { brand: "Royal Enfield", model: "Classic 350", type: "bike", fuel: "petrol", variants: ["Standard", "Diesel"], price: 200000 },
];

const names = ["Rahul Sharma", "Priya Patel", "Amit Kumar", "Suresh Menon", "Kavita Singh", "Vikram Singh", "Anita Roy", "Sunil Gupta", "Pooja Desai", "Rajesh Patel"];

const leadSources = ["inbound_call", "facebook", "instagram", "website", "walk_in"];
const leadStages = ["new", "contacted", "test_drive_booked", "negotiation", "won", "lost"];
const leadScores = ["hot", "warm", "cold"];
const timelines = ["this_week", "this_month", "three_months_plus", "unknown"];
const paymentModes = ["cash", "loan", "exchange"];

const leads: any[] = [];

for (let i = 0; i < 40; i++) {
  const model = modelsData[i % modelsData.length];
  const source = leadSources[i % leadSources.length];
  const stage = leadStages[i % leadStages.length];
  const score = leadScores[i % leadScores.length];
  const timeline = timelines[i % timelines.length];
  const paymentMode = paymentModes[i % paymentModes.length];
  const isNew = i % 3 !== 0;
  const hasExchange = i % 5 === 0;
  const phone = `+91${String(8000000000 + i)}`;
  const name = names[i % names.length];

  leads.push({
    id: `lead_${i}`,
    orgId: "demo-org",
    phone,
    name,
    stage,
    score,
    scoreValue: score === "hot" ? 100 : score === "warm" ? 50 : 0,
    source,
    language: ["en", "hi", "kn", "hinglish"][i % 4],
    interestedModel: model.model,
    variant: model.variants[0],
    fuel: model.fuel,
    budget: i % 10 === 0 ? model.price : undefined,
    newOrUsed: isNew ? "new" : "used",
    timeline,
    paymentMode,
    hasExchange,
    exchangeVehicle: hasExchange ? { make: "Honda", model: "Activa 6G", year: 2020, kilometres: 20000, condition: "good" } : undefined,
    notesLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

// Ensure .data directory exists
mkdirSync(path.resolve(".data"), { recursive: true });

const seedData = {
  leads,
  catalogModels: modelsData.map(md => ({
    id: `${md.brand.toLowerCase()}-${md.model.toLowerCase().replace(/\s+/g, "-")}`,
    brand: md.brand,
    model: md.model,
    type: md.type,
    variants: md.variants.map((v: string) => ({ name: v, fuel: md.fuel, transmission: "manual", exShowroomPrice: md.price })),
    colors: ["Black", "White", "Red"],
    keyFeatures: ["Feature 1", "Feature 2"],
    active: true,
  })),
};

writeFileSync(path.resolve(".data/seed.json"), JSON.stringify(seedData, null, 2));
console.log(`Seed complete: ${leads.length} leads, ${seedData.catalogModels.length} catalog models`);