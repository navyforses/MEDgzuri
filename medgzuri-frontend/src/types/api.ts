export type SearchType = "research" | "symptoms" | "clinics";

export interface ResearchData {
  diagnosis: string;
  ageGroup: string;
  researchType: string;
  context: string;
  regions: string[];
}

export interface SymptomsData {
  symptoms: string;
  age: number | null;
  sex: string;
  existingConditions: string;
  medications: string;
}

export interface ClinicsData {
  diagnosis: string;
  countries: string[];
  budget: string;
  language: string;
  notes: string;
}

export type SearchData = ResearchData | SymptomsData | ClinicsData;

export interface SearchRequest {
  type: SearchType;
  data: SearchData;
}

export interface ResultItem {
  title: string;
  source: string;
  body: string;
  tags: string[];
  url: string;
  priority?: "high" | "medium" | "low";
  rating?: number;
  price?: string;
  phase?: string;
}

export interface ComparisonTable {
  headers: string[];
  rows: string[][];
}

export interface TipItem {
  text: string;
  icon: string;
}

export interface SearchResponse {
  meta: string;
  items: ResultItem[];
  summary?: string;
  comparison?: ComparisonTable;
  tips?: TipItem[];
  nextSteps?: TipItem[];
  disclaimer?: string;
  isDemo?: boolean;
  _pipeline?: { ms: number; source: string };
}
