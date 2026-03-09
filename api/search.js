/**
 * MedGzuri AI Search API — Serverless Endpoint
 *
 * Orchestrates a multi-AI search pipeline for Georgian-language medical research:
 *
 *   Request  ──►  Cache  ──►  n8n  ──►  Railway  ──►  Perplexity  ──►  Claude  ──►  Response
 *                  hit?      optional    FastAPI        web search       structure
 *                   │           │        agents            │              & translate
 *                   ▼           ▼           ▼              ▼                  │
 *                 return     return      return         fallback ◄────────────┘
 *
 * Pipeline stages:
 *   1. Perplexity API — web search for medical research, clinical trials, clinics
 *   2. Anthropic Claude — analysis, structuring, and Georgian translation
 *   3. OpenAI GPT — verification and fact-checking (Phase 2, not yet active)
 *
 * Search types:
 *   - "research"  — PubMed/ClinicalTrials.gov literature search
 *   - "symptoms"  — test & specialist recommendations (never diagnoses)
 *   - "clinics"   — global hospital/clinic search with pricing
 *   - "report"    — PDF report generation from prior search results
 *
 * Graceful degradation:
 *   n8n failure    →  Railway FastAPI agents
 *   Railway failure →  direct Perplexity+Claude pipeline
 *   Claude failure  →  raw Perplexity results
 *   All fail       →  demo/mock data
 *
 * @module api/search
 */

// ═══════════════ CONFIG ═══════════════
/** @type {string|undefined} */
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
/** @type {string|undefined} */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
/** @type {string|undefined} */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
/** @type {string|undefined} */
const N8N_WEBHOOK_BASE_URL = process.env.N8N_WEBHOOK_BASE_URL;
/** @type {string|undefined} */
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;
/** @type {string|undefined} */
const SUPABASE_URL = process.env.SUPABASE_URL;
/** @type {string|undefined} */
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
/** @type {string|undefined} Railway FastAPI backend URL for agent-based pipelines */
const RAILWAY_BACKEND_URL = process.env.RAILWAY_BACKEND_URL;

// ═══════════════ SHARED SECURITY ═══════════════
const { setCorsHeaders, setSecurityHeaders, sanitizeString, searchRateLimiter, getClientIp } = require('../lib/security');

// ═══════════════ GEORGIAN MEDICAL TERM NORMALIZATION ═══════════════
/**
 * Georgian → English medical term dictionary.
 * Used to normalize Georgian terms before building Perplexity queries.
 * Mirrors medgzuri-backend/app/utils/medical_terms.py (KA_TO_EN).
 */
const MEDICAL_TERMS_KA_EN = {
    // ═══════════════ NEUROLOGY ═══════════════
    'ჰიპოქსიურ-იშემიური ენცეფალოპათია': 'hypoxic-ischemic encephalopathy',
    'ეპილეფსია': 'epilepsy',
    'ინსულტი': 'stroke',
    'მიგრენი': 'migraine',
    'თავის ტკივილი': 'headache',
    'პარკინსონის დაავადება': 'Parkinson\'s disease',
    'ალცჰაიმერის დაავადება': 'Alzheimer\'s disease',
    'გაფანტული სკლეროზი': 'multiple sclerosis',
    'მენინგიტი': 'meningitis',
    'ენცეფალიტი': 'encephalitis',
    'ნეიროპათია': 'neuropathy',
    'პერიფერიული ნეიროპათია': 'peripheral neuropathy',
    'ტრემორი': 'tremor',
    'დემენცია': 'dementia',
    'ნეიროდეგენერაციული დაავადება': 'neurodegenerative disease',
    'თავბრუსხვევა': 'vertigo',
    'კრუნჩხვა': 'seizure',
    'თავის ტვინის სიმსივნე': 'brain tumor',
    'ცერებრალური დამბლა': 'cerebral palsy',
    'მიასთენია გრავისი': 'myasthenia gravis',
    'გილენ-ბარეს სინდრომი': 'Guillain-Barré syndrome',
    'ჰიდროცეფალია': 'hydrocephalus',
    'ტრიგემინალური ნევრალგია': 'trigeminal neuralgia',
    'ნარკოლეფსია': 'narcolepsy',
    'ატაქსია': 'ataxia',

    // ═══════════════ CARDIOLOGY ═══════════════
    'გულის უკმარისობა': 'heart failure',
    'არითმია': 'arrhythmia',
    'ინფარქტი': 'myocardial infarction',
    'ჰიპერტენზია': 'hypertension',
    'სტენოკარდია': 'angina',
    'ათეროსკლეროზი': 'atherosclerosis',
    'კორონარული დაავადება': 'coronary artery disease',
    'კარდიომიოპათია': 'cardiomyopathy',
    'მიოკარდიტი': 'myocarditis',
    'პერიკარდიტი': 'pericarditis',
    'სარქველის დაავადება': 'valvular heart disease',
    'აორტის ანევრიზმა': 'aortic aneurysm',
    'ფიბრილაცია': 'fibrillation',
    'წინაგულთა ფიბრილაცია': 'atrial fibrillation',
    'ტაქიკარდია': 'tachycardia',
    'ბრადიკარდია': 'bradycardia',
    'ფილტვის ემბოლია': 'pulmonary embolism',
    'ღრმა ვენების თრომბოზი': 'deep vein thrombosis',
    'ენდოკარდიტი': 'endocarditis',
    'ჰიპოტენზია': 'hypotension',

    // ═══════════════ ONCOLOGY ═══════════════
    'ფილტვის კიბო': 'lung cancer',
    'ძუძუს კიბო': 'breast cancer',
    'პროსტატის კიბო': 'prostate cancer',
    'კოლორექტალური კიბო': 'colorectal cancer',
    'ლეიკემია': 'leukemia',
    'ლიმფომა': 'lymphoma',
    'მელანომა': 'melanoma',
    'კუჭის კიბო': 'stomach cancer',
    'ღვიძლის კიბო': 'liver cancer',
    'პანკრეასის კიბო': 'pancreatic cancer',
    'თირკმლის კიბო': 'kidney cancer',
    'შარდის ბუშტის კიბო': 'bladder cancer',
    'საკვერცხის კიბო': 'ovarian cancer',
    'საშვილოსნოს ყელის კიბო': 'cervical cancer',
    'საშვილოსნოს კიბო': 'uterine cancer',
    'ფარისებრი ჯირკვლის კიბო': 'thyroid cancer',
    'ტვინის კიბო': 'brain cancer',
    'ძვლის კიბო': 'bone cancer',
    'სარკომა': 'sarcoma',
    'მიელომა': 'myeloma',
    'გლიობლასტომა': 'glioblastoma',
    'ნეირობლასტომა': 'neuroblastoma',
    'ქიმიოთერაპია': 'chemotherapy',
    'სხივური თერაპია': 'radiation therapy',
    'იმუნოთერაპია': 'immunotherapy',
    'მეტასტაზი': 'metastasis',

    // ═══════════════ ENDOCRINOLOGY ═══════════════
    'დიაბეტი': 'diabetes',
    'ფარისებრი ჯირკვალი': 'thyroid',
    'ჰიპოთირეოზი': 'hypothyroidism',
    'ჰიპერთირეოზი': 'hyperthyroidism',
    'I ტიპის დიაბეტი': 'type 1 diabetes',
    'II ტიპის დიაბეტი': 'type 2 diabetes',
    'ინსულინრეზისტენტობა': 'insulin resistance',
    'ჰიპოგლიკემია': 'hypoglycemia',
    'ჰიპერგლიკემია': 'hyperglycemia',
    'კუშინგის სინდრომი': 'Cushing\'s syndrome',
    'ადისონის დაავადება': 'Addison\'s disease',
    'თირეოიდიტი': 'thyroiditis',
    'ჰაშიმოტოს თირეოიდიტი': 'Hashimoto\'s thyroiditis',
    'გრეივსის დაავადება': 'Graves\' disease',
    'ჰიპერპარათირეოზი': 'hyperparathyroidism',
    'ჰიპოფიზის ადენომა': 'pituitary adenoma',
    'ფეოქრომოციტომა': 'pheochromocytoma',
    'მეტაბოლური სინდრომი': 'metabolic syndrome',

    // ═══════════════ GASTROENTEROLOGY ═══════════════
    'გულისრევა': 'nausea',
    'დიარეა': 'diarrhea',
    'გასტრიტი': 'gastritis',
    'წყლულოვანი კოლიტი': 'ulcerative colitis',
    'კრონის დაავადება': 'Crohn\'s disease',
    'გასტროეზოფაგური რეფლუქსი': 'gastroesophageal reflux disease',
    'ღვიძლის ციროზი': 'liver cirrhosis',
    'ჰეპატიტი A': 'hepatitis A',
    'ჰეპატიტი B': 'hepatitis B',
    'ჰეპატიტი C': 'hepatitis C',
    'პანკრეატიტი': 'pancreatitis',
    'ნაღვლის კენჭი': 'gallstones',
    'ქოლეცისტიტი': 'cholecystitis',
    'ცელიაკია': 'celiac disease',
    'გაღიზიანებული ნაწლავის სინდრომი': 'irritable bowel syndrome',
    'კუჭის წყლული': 'peptic ulcer',
    'ჰელიკობაქტერ პილორი': 'Helicobacter pylori',
    'ყაბზობა': 'constipation',
    'მუცლის ტკივილი': 'abdominal pain',
    'ნაწლავის პოლიპი': 'intestinal polyp',
    'ღვიძლის ცხიმოვანი დაავადება': 'fatty liver disease',
    'ასციტი': 'ascites',

    // ═══════════════ PULMONOLOGY ═══════════════
    'ასთმა': 'asthma',
    'პნევმონია': 'pneumonia',
    'ბრონქიტი': 'bronchitis',
    'ტუბერკულოზი': 'tuberculosis',
    'ქრონიკული ობსტრუქციული ფილტვის დაავადება': 'chronic obstructive pulmonary disease',
    'ფილტვის ფიბროზი': 'pulmonary fibrosis',
    'პლევრიტი': 'pleurisy',
    'პნევმოთორაქსი': 'pneumothorax',
    'სარკოიდოზი': 'sarcoidosis',
    'ფილტვის ჰიპერტენზია': 'pulmonary hypertension',
    'სასუნთქი გზების ინფექცია': 'respiratory tract infection',
    'ობსტრუქციული ძილის აპნოე': 'obstructive sleep apnea',
    'ხველა': 'cough',
    'ემფიზემა': 'emphysema',

    // ═══════════════ ORTHOPEDICS / RHEUMATOLOGY ═══════════════
    'ართრიტი': 'arthritis',
    'ოსტეოპოროზი': 'osteoporosis',
    'რევმატოიდული ართრიტი': 'rheumatoid arthritis',
    'ოსტეოართრიტი': 'osteoarthritis',
    'სპონდილიტი': 'spondylitis',
    'ანკილოზირებული სპონდილიტი': 'ankylosing spondylitis',
    'დისკის თიაქარი': 'herniated disc',
    'სკოლიოზი': 'scoliosis',
    'მენისკის დაზიანება': 'meniscus tear',
    'ტენდინიტი': 'tendinitis',
    'ფიბრომიალგია': 'fibromyalgia',
    'ბურსიტი': 'bursitis',
    'წელის ტკივილი': 'lower back pain',
    'კისრის ტკივილი': 'neck pain',
    'მხრის ტკივილი': 'shoulder pain',
    'მუხლის ტკივილი': 'knee pain',
    'მოტეხილობა': 'fracture',
    'სისტემური წითელი მგლურა': 'systemic lupus erythematosus',
    'პოდაგრა': 'gout',

    // ═══════════════ PSYCHIATRY ═══════════════
    'დეპრესია': 'depression',
    'შფოთვა': 'anxiety',
    'შიზოფრენია': 'schizophrenia',
    'ბიპოლარული აშლილობა': 'bipolar disorder',
    'პანიკური აშლილობა': 'panic disorder',
    'ობსესიურ-კომპულსიური აშლილობა': 'obsessive-compulsive disorder',
    'პოსტტრავმული სტრესული აშლილობა': 'post-traumatic stress disorder',
    'ანორექსია ნერვოზა': 'anorexia nervosa',
    'ბულიმია': 'bulimia',
    'ინსომნია': 'insomnia',
    'აუტიზმი': 'autism spectrum disorder',
    'ყურადღების დეფიციტის ჰიპერაქტიურობის აშლილობა': 'attention deficit hyperactivity disorder',
    'დემენცია': 'dementia',
    'ფსიქოზი': 'psychosis',
    'სოციალური შფოთვა': 'social anxiety disorder',

    // ═══════════════ OPHTHALMOLOGY ═══════════════
    'გლაუკომა': 'glaucoma',
    'კატარაქტა': 'cataract',
    'მაკულის დეგენერაცია': 'macular degeneration',
    'დიაბეტური რეტინოპათია': 'diabetic retinopathy',
    'კონიუნქტივიტი': 'conjunctivitis',
    'ასტიგმატიზმი': 'astigmatism',
    'მიოპია': 'myopia',
    'ჰიპერმეტროპია': 'hyperopia',
    'ბადურის აცილება': 'retinal detachment',
    'მშრალი თვალის სინდრომი': 'dry eye syndrome',

    // ═══════════════ DERMATOLOGY ═══════════════
    'ფსორიაზი': 'psoriasis',
    'ეგზემა': 'eczema',
    'ატოპიური დერმატიტი': 'atopic dermatitis',
    'აკნე': 'acne',
    'როზაცეა': 'rosacea',
    'ვიტილიგო': 'vitiligo',
    'ალოპეცია': 'alopecia',
    'სამარი': 'shingles',
    'ჭინჭარი': 'urticaria',
    'სოკოვანი ინფექცია': 'fungal infection',
    'დერმატიტი': 'dermatitis',
    'კელოიდი': 'keloid',
    'სკლეროდერმია': 'scleroderma',

    // ═══════════════ UROLOGY ═══════════════
    'თირკმლის კენჭი': 'kidney stones',
    'ცისტიტი': 'cystitis',
    'შარდის ინფექცია': 'urinary tract infection',
    'პროსტატიტი': 'prostatitis',
    'პროსტატის ჰიპერპლაზია': 'benign prostatic hyperplasia',
    'შარდის შეუკავებლობა': 'urinary incontinence',
    'პიელონეფრიტი': 'pyelonephritis',
    'თირკმლის კისტა': 'renal cyst',
    'ერექტილური დისფუნქცია': 'erectile dysfunction',
    'ვარიკოცელე': 'varicocele',

    // ═══════════════ GYNECOLOGY ═══════════════
    'ენდომეტრიოზი': 'endometriosis',
    'პოლიკისტოზური საკვერცხე': 'polycystic ovary syndrome',
    'საშვილოსნოს მიომა': 'uterine fibroids',
    'ვაგინიტი': 'vaginitis',
    'მენოპაუზა': 'menopause',
    'დისმენორეა': 'dysmenorrhea',
    'ექტოპიური ორსულობა': 'ectopic pregnancy',
    'პრეეკლამფსია': 'preeclampsia',
    'გესტაციური დიაბეტი': 'gestational diabetes',
    'მასტიტი': 'mastitis',

    // ═══════════════ PEDIATRICS ═══════════════
    'წითელა': 'measles',
    'ყბაყურა': 'mumps',
    'ჩუტყვავილა': 'chickenpox',
    'სკარლატინა': 'scarlet fever',
    'კოხის ხველა': 'whooping cough',
    'მუკოვისციდოზი': 'cystic fibrosis',
    'ქვემოთ სინდრომი': 'Down syndrome',
    'ფენილკეტონურია': 'phenylketonuria',
    'თანდაყოლილი გულის მანკი': 'congenital heart defect',
    'კავასაკის დაავადება': 'Kawasaki disease',
    'რეის სინდრომი': 'Reye\'s syndrome',
    'ჰიდროცეფალია': 'hydrocephalus',

    // ═══════════════ INFECTIOUS DISEASES ═══════════════
    'ჰეპატიტი': 'hepatitis',
    'აივ': 'HIV',
    'მალარია': 'malaria',
    'დენგეს ცხელება': 'dengue fever',
    'სეფსისი': 'sepsis',
    'ზიკას ვირუსი': 'Zika virus',
    'ლაიმის დაავადება': 'Lyme disease',
    'კოვიდ-19': 'COVID-19',
    'გრიპი': 'influenza',
    'ლეგიონერთა დაავადება': 'Legionnaires\' disease',
    'ბრუცელოზი': 'brucellosis',
    'ტოქსოპლაზმოზი': 'toxoplasmosis',
    'ციტომეგალოვირუსი': 'cytomegalovirus',
    'ეპშტეინ-ბარის ვირუსი': 'Epstein-Barr virus',
    'სტაფილოკოკი': 'staphylococcal infection',
    'სტრეპტოკოკი': 'streptococcal infection',
    'კანდიდოზი': 'candidiasis',

    // ═══════════════ HEMATOLOGY ═══════════════
    'ანემია': 'anemia',
    'რკინადეფიციტური ანემია': 'iron deficiency anemia',
    'ნამგლისებრუჯრედოვანი ანემია': 'sickle cell anemia',
    'თალასემია': 'thalassemia',
    'ჰემოფილია': 'hemophilia',
    'თრომბოციტოპენია': 'thrombocytopenia',
    'პოლიციტემია': 'polycythemia',
    'ლიმფოციტოზი': 'lymphocytosis',
    'ნეიტროპენია': 'neutropenia',
    'დისემინირებული ინტრავასკულური კოაგულაცია': 'disseminated intravascular coagulation',

    // ═══════════════ IMMUNOLOGY ═══════════════
    'ალერგია': 'allergy',
    'ანაფილაქსია': 'anaphylaxis',
    'აუტოიმუნური დაავადება': 'autoimmune disease',
    'იმუნოდეფიციტი': 'immunodeficiency',
    'ვასკულიტი': 'vasculitis',
    'სარკოიდოზი': 'sarcoidosis',
    'ამილოიდოზი': 'amyloidosis',
    'მასტოციტოზი': 'mastocytosis',
    'შეგრენის სინდრომი': 'Sjögren\'s syndrome',

    // ═══════════════ GENETICS / RARE DISEASES ═══════════════
    'მარფანის სინდრომი': 'Marfan syndrome',
    'ელერს-დანლოს სინდრომი': 'Ehlers-Danlos syndrome',
    'ჰანტინგტონის დაავადება': 'Huntington\'s disease',
    'ტურნერის სინდრომი': 'Turner syndrome',
    'კლაინფელტერის სინდრომი': 'Klinefelter syndrome',
    'უილსონის დაავადება': 'Wilson\'s disease',
    'გოშეს დაავადება': 'Gaucher disease',
    'ფაბრის დაავადება': 'Fabry disease',
    'ამიოტროფიული ლატერალური სკლეროზი': 'amyotrophic lateral sclerosis',
    'სპინალური მუსკულური ატროფია': 'spinal muscular atrophy',
    'დიუშენის მუსკულური დისტროფია': 'Duchenne muscular dystrophy',
    'პრადერ-ვილის სინდრომი': 'Prader-Willi syndrome',
    'ანგელმანის სინდრომი': 'Angelman syndrome',

    // ═══════════════ NEPHROLOGY ═══════════════
    'თირკმლის უკმარისობა': 'renal failure',
    'ქრონიკული თირკმლის დაავადება': 'chronic kidney disease',
    'გლომერულონეფრიტი': 'glomerulonephritis',
    'ნეფროტიკური სინდრომი': 'nephrotic syndrome',
    'დიალიზი': 'dialysis',
    'თირკმლის ტრანსპლანტაცია': 'kidney transplantation',

    // ═══════════════ GENERAL SYMPTOMS ═══════════════
    'ცხელება': 'fever',
    'სისუსტე': 'weakness',
    'წონის კლება': 'weight loss',
    'ტკივილი': 'pain',
    'შეშუპება': 'swelling',
    'გამონაყარი': 'rash',
    'ქოშინი': 'shortness of breath',
    'გულძმარვა': 'heartburn',
    'ღებინება': 'vomiting',
    'შეკრულობა': 'constipation',
    'სისხლდენა': 'bleeding',
    'ქავილი': 'itching',
    'დაღლილობა': 'fatigue',
    'უძილობა': 'insomnia',
    'ოფლიანობა': 'excessive sweating',
    'წონაში მატება': 'weight gain',
    'მადის დაკარგვა': 'loss of appetite',
    'ტკივილი გულმკერდში': 'chest pain',
    'გულისცემის აჩქარება': 'palpitations',
    'სახსრის ტკივილი': 'joint pain',
    'კუნთის ტკივილი': 'muscle pain',
    'თვალის სიწითლე': 'eye redness',
    'ყურის ტკივილი': 'ear pain',
    'ყელის ტკივილი': 'sore throat',
    'ცხვირის გაჭედვა': 'nasal congestion',
    'სუნთქვის გაძნელება': 'difficulty breathing',
    'შარდვის გაძნელება': 'difficulty urinating',
    'ხშირი შარდვა': 'frequent urination',
    'წყურვილი': 'excessive thirst',
    'მხედველობის დაქვეითება': 'vision loss',
    'სმენის დაქვეითება': 'hearing loss',
    'დაბალი ტემპერატურა': 'hypothermia',
    'ლიმფური კვანძის გადიდება': 'lymph node enlargement',
};

/**
 * Georgian age group → English mapping
 */
const AGE_GROUPS_KA_EN = {
    'ახალშობილი': 'newborn',
    'ჩვილი': 'infant',
    'ბავშვი': 'child',
    'მოზარდი': 'adolescent',
    'ზრდასრული': 'adult',
    'ხანდაზმული': 'elderly',
    'პედიატრიული': 'pediatric',
};

/**
 * Normalize a Georgian medical term to English.
 * Exact dictionary match first, then substring match.
 * Returns the English term, or the original with a transliteration hint.
 *
 * @param {string} term - Georgian medical term
 * @returns {string} English-normalized term
 */
function normalizeMedicalTerm(term) {
    if (!term || typeof term !== 'string') return term || '';
    const trimmed = term.trim();

    // Exact match
    const exact = MEDICAL_TERMS_KA_EN[trimmed];
    if (exact) return exact;

    // Case-insensitive exact match
    const lowerTrimmed = trimmed.toLowerCase();
    for (const [ka, en] of Object.entries(MEDICAL_TERMS_KA_EN)) {
        if (ka.toLowerCase() === lowerTrimmed) return en;
    }

    // Substring match — if the input contains a known term, replace it
    for (const [ka, en] of Object.entries(MEDICAL_TERMS_KA_EN)) {
        if (trimmed.includes(ka)) {
            return trimmed.replace(ka, en);
        }
    }

    // No dictionary match — check if it's Georgian text
    const georgianRegex = /[\u10A0-\u10FF\u2D00-\u2D2F]/;
    if (georgianRegex.test(trimmed)) {
        // Return original with parenthetical hint for Perplexity
        return `${trimmed} (Georgian medical term)`;
    }
    return trimmed;
}

/**
 * Normalize a Georgian age group to English.
 *
 * @param {string} ageGroup - Age group (possibly Georgian)
 * @returns {string} English-normalized age group
 */
function normalizeAgeGroup(ageGroup) {
    if (!ageGroup || typeof ageGroup !== 'string') return ageGroup || '';
    const trimmed = ageGroup.trim();
    return AGE_GROUPS_KA_EN[trimmed] || trimmed;
}

// ═══════════════ IN-MEMORY CACHE (LRU + TTL) ═══════════════
/**
 * LRU cache with time-based expiration.
 *
 * Uses a Map (insertion-ordered) for O(1) get/set/delete.
 * On access, entries are moved to the tail (most-recently-used).
 * On insert beyond capacity, the head (least-recently-used) is evicted.
 *
 * Complexity:
 *   getCacheKey — O(n) where n = JSON-serialized input length (unavoidable)
 *   cacheGet    — O(1) amortized (Map.get + delete + set)
 *   cacheSet    — O(1) amortized
 *
 * Previous issue: TTL-expired entries were never proactively purged, only
 * evicted by LRU pressure. Now a periodic sweep removes stale entries,
 * bounding memory to min(CACHE_MAX_SIZE, active entries).
 */
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();

/**
 * Build a cache key from search type + input data.
 * Uses djb2 hash over the canonical JSON representation.
 *
 * @param {string} type  - Search type (research|symptoms|clinics)
 * @param {object} data  - Search parameters
 * @returns {string}       Cache key in the form "type:hash"
 */
function getCacheKey(type, data) {
    const normalized = JSON.stringify({ type, ...data });
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return `${type}:${hash}`;
}

/**
 * Retrieve a cached entry, returning null on miss or expiry.
 * Promotes the entry to most-recently-used on hit.
 *
 * @param {string} key
 * @returns {object|null}
 */
function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    // Move to end (LRU promotion) — O(1)
    cache.delete(key);
    cache.set(key, entry);
    return entry.data;
}

/**
 * Store a result in the cache, evicting the LRU entry if at capacity.
 *
 * @param {string} key
 * @param {object} data
 */
function cacheSet(key, data) {
    // If updating an existing key, delete first to refresh LRU position
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= CACHE_MAX_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, { data, ts: Date.now() });
}

/**
 * Periodic TTL sweep — removes expired entries to prevent memory creep.
 * Runs every 5 minutes. O(n) scan but n ≤ CACHE_MAX_SIZE = 100.
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.ts > CACHE_TTL_MS) {
            cache.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ═══════════════ SEARCH LOGGING (Supabase) ═══════════════
/**
 * Fire-and-forget search telemetry to Supabase.
 *
 * Called without `await` in the handler so it never blocks the response.
 * Failures are silently logged — logging should never degrade the user experience.
 *
 * @param {string} type       - Search type
 * @param {object} data       - Original request payload
 * @param {object} resultMeta - API result (used for item count)
 * @param {number} pipelineMs - Total pipeline duration in ms
 * @param {string} source     - Which pipeline served the result (n8n|direct|cache)
 * @param {string} clientIp   - Client IP for analytics
 */
async function logSearch(type, data, resultMeta, pipelineMs, source, clientIp) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/search_logs`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                search_type: type,
                query: data.diagnosis || data.symptoms || data.notes || '',
                result_count: resultMeta?.items?.length || 0,
                pipeline_ms: pipelineMs,
                source,
                client_ip: clientIp,
                created_at: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error('[MedGzuri] Search log failed:', err.message);
    }
}

// ═══════════════ HANDLER ═══════════════

/** Set of valid search types — O(1) lookup vs O(n) Array.includes */
const VALID_TYPES = new Set(['research', 'symptoms', 'clinics', 'report']);

/** Dispatch table mapping search types to their handler functions */
const SEARCH_HANDLERS = {
    research: (data) => searchResearch(data),
    symptoms: (data) => analyzeSymptoms(data),
    clinics:  (data) => searchClinics(data),
    report:   (data) => generateReport(data.reportType, data.searchResult),
};

/**
 * Main request handler — Vercel serverless entry point.
 *
 * Flow:
 *   1. CORS + method check
 *   2. Rate limiting by IP
 *   3. Input validation (type, text lengths, age range)
 *   4. LRU cache check (skip for reports)
 *   5. Demo mode fallback if no API keys
 *   6. n8n multi-agent pipeline attempt
 *   7. Railway FastAPI agent pipeline attempt
 *   8. Direct Perplexity → Claude pipeline fallback
 *   9. Cache result + async logging
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
module.exports = async function handler(req, res) {
    // CORS & security headers (shared from lib/security.js)
    setSecurityHeaders(res);
    if (setCorsHeaders(req, res)) return; // OPTIONS handled

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Rate limiting — uses shared limiter from lib/security.js
        const clientIp = getClientIp(req);
        if (searchRateLimiter(clientIp)) {
            return res.status(429).json({
                error: 'ძალიან ბევრი მოთხოვნა. გთხოვთ მოიცადოთ ერთი წუთი.'
            });
        }

        const { type, data } = req.body;

        if (!type || !data) {
            return res.status(400).json({ error: 'Missing type or data' });
        }

        // Validate search type — O(1) Set lookup instead of O(n) array scan
        if (!VALID_TYPES.has(type)) {
            return res.status(400).json({ error: 'Invalid search type' });
        }

        // Input validation — guard against oversized payloads
        const MAX_TEXT_LENGTH = 2000;
        const textFields = [
            data.diagnosis, data.symptoms, data.context,
            data.notes, data.existingConditions, data.medications
        ];
        for (const field of textFields) {
            if (field && typeof field === 'string' && field.length > MAX_TEXT_LENGTH) {
                return res.status(400).json({ error: 'Input too long' });
            }
        }
        if (data.age && (isNaN(data.age) || data.age < 0 || data.age > 150)) {
            return res.status(400).json({ error: 'Invalid age' });
        }

        // Cache check — compute key once, reuse for both get and set
        let cacheKey;
        if (type !== 'report') {
            cacheKey = getCacheKey(type, data);
            const cached = cacheGet(cacheKey);
            if (cached) {
                console.log(`[MedGzuri] Cache HIT for ${type}`);
                cached._cached = true;
                cached._pipeline = { ms: 0, source: 'cache' };
                return res.status(200).json(cached);
            }
        }

        // Demo mode — return mock data when no API keys are configured
        if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
            console.log('[MedGzuri] No API keys configured, returning demo data');
            const demoResult = type === 'report'
                ? getDemoReport(data.reportType, data.searchResult)
                : getDemoResult(type, data);
            demoResult.isDemo = true;
            return res.status(200).json(demoResult);
        }

        // Hard gate: search must be web-grounded
        if (['research', 'symptoms', 'clinics'].includes(type) && !PERPLEXITY_API_KEY) {
            return res.status(503).json({
                error: 'ონლაინ ძიება მიუწვდომელია: PERPLEXITY_API_KEY არ არის კონფიგურირებული.',
                missingEnv: ['PERPLEXITY_API_KEY']
            });
        }

        // Pipeline execution
        const pipelineStart = Date.now();

        // Try n8n multi-agent pipeline first
        let result = await proxyToN8n(type, data);
        const n8nStatus = result ? 'success' : (N8N_WEBHOOK_BASE_URL ? 'failed' : 'skipped');

        // Try Railway FastAPI backend (agent-based pipelines)
        let railwayStatus = 'skipped';
        if (!result) {
            result = await proxyToRailway(type, data);
            railwayStatus = result ? 'success' : (RAILWAY_BACKEND_URL ? 'failed' : 'skipped');
        }

        // Fallback to direct pipeline via dispatch table (eliminates switch/case)
        if (!result) {
            result = await SEARCH_HANDLERS[type](data);
        }

        // Pipeline metadata
        const pipelineMs = Date.now() - pipelineStart;
        const pipelineSource = n8nStatus === 'success' ? 'n8n'
            : railwayStatus === 'success' ? 'railway'
            : 'direct';
        console.log(`[MedGzuri] Pipeline completed in ${pipelineMs}ms | source: ${pipelineSource} | n8n: ${n8nStatus} | railway: ${railwayStatus} | type: ${type}`);
        result._pipeline = { ms: pipelineMs, n8n: n8nStatus, railway: railwayStatus };

        // Cache the result (reports are unique, skip caching)
        if (cacheKey) {
            cacheSet(cacheKey, result);
        }

        // Log search to Supabase (fire-and-forget — never blocks response)
        logSearch(type, data, result, pipelineMs, pipelineSource, clientIp);

        return res.status(200).json(result);

    } catch (err) {
        console.error('[MedGzuri] Search error:', err);
        return res.status(500).json({
            error: 'ძიება ვერ შესრულდა. გთხოვთ სცადოთ მოგვიანებით.'
        });
    }
};

// ═══════════════ SEARCH: RESEARCH ═══════════════
/**
 * Research pipeline: Perplexity web search → Claude structuring.
 *
 * Searches PubMed, ClinicalTrials.gov, and medical literature for the
 * given diagnosis, then structures results into Georgian-language items.
 *
 * @param {object} data - { diagnosis, ageGroup, researchType, context, regions }
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function searchResearch(data) {
    const { diagnosis, ageGroup, researchType, context, regions, language } = data;

    const searchQuery = buildResearchQuery(diagnosis, ageGroup, researchType, context);
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'research',
        query: diagnosis,
        searchResults,
        context: { ageGroup, researchType, regions, additionalContext: context },
        language
    });
}

// ═══════════════ SEARCH: SYMPTOMS ═══════════════
/**
 * Symptom analysis pipeline: Perplexity search → Claude analysis.
 *
 * Recommends tests and specialists — never provides a diagnosis.
 *
 * @param {object} data - { symptoms, age, sex, existingConditions, medications }
 * @returns {Promise<object>} Analysis result with meta + items[]
 */
async function analyzeSymptoms(data) {
    const { symptoms, age, sex, existingConditions, medications, language } = data;

    const normalizedSymptoms = normalizeMedicalTerm(symptoms);
    const normalizedConditions = existingConditions ? normalizeMedicalTerm(existingConditions) : 'none';
    const searchQuery = `medical tests and examinations for symptoms: ${normalizedSymptoms}. Patient age: ${age || 'not specified'}, sex: ${sex || 'not specified'}. Existing conditions: ${normalizedConditions}`;
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'symptoms',
        query: symptoms,
        searchResults,
        context: { age, sex, existingConditions, medications },
        language
    });
}

// ═══════════════ SEARCH: CLINICS ═══════════════
/**
 * Clinic search pipeline: Perplexity search → Claude structuring.
 *
 * Finds hospitals and clinics worldwide with pricing and treatment details.
 *
 * @param {object} data - { diagnosis, countries, budget, language, notes }
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function searchClinics(data) {
    const { diagnosis, countries, budget, language, notes } = data;

    const normalizedDiagnosis = normalizeMedicalTerm(diagnosis);
    const countryStr = countries.length > 0 ? countries.join(', ') : 'worldwide';
    const searchQuery = `best hospitals and clinics for ${normalizedDiagnosis} in ${countryStr}. Treatment options, estimated costs, patient reviews. ${budget ? `Budget range: ${budget}` : ''} ${notes || ''}`;
    const searchResults = await perplexitySearch(searchQuery);

    return claudeAnalyze({
        role: 'clinics',
        query: diagnosis,
        searchResults,
        context: { countries, budget, language, notes },
        language
    });
}

// ═══════════════ REPORT GENERATION ═══════════════
async function generateReport(reportType, searchResult) {
    if (!ANTHROPIC_API_KEY) {
        return getDemoReport(reportType, searchResult);
    }

    const reportPrompt = `შენ ხარ მედგზურის სამედიცინო ანგარიშის ავტორი. მოგეცემა ძიების შედეგები და შენ უნდა შექმნა სრული, პროფესიული, დეტალური სამედიცინო ანგარიში ქართულ ენაზე.

ენობრივი მოთხოვნები:
- გამოიყენე ლიტერატურული ქართული ენა, სწორი ბრუნვები და ზმნის ფორმები
- სამედიცინო ტერმინოლოგია მხოლოდ ქართულად
- წინადადებები სრული, გრამატიკულად გამართული და პროფესიული ტონით
- აბზაცები ლოგიკურად დაკავშირებული და თანმიმდევრული

ანგარიშის სტრუქტურა (მინიმუმ 6 სექცია, თითოეული მინიმუმ 3-4 აბზაცი):
1. შესავალი — თემის დეტალური აღწერა, ეპიდემიოლოგია, აქტუალობა და ანგარიშის მიზანი
2. მიმოხილვა — ძირითადი მიგნებები და არსებული მონაცემების სიღრმისეული ანალიზი
3. დეტალური ანალიზი — თითოეული მნიშვნელოვანი აღმოჩენის დეტალური განხილვა, კვლევების აღწერა, მეთოდოლოგია და შედეგები
4. მკურნალობის ვარიანტები — არსებული თერაპიული მიდგომები, მათი უპირატესობები და ნაკლოვანებები
5. რეკომენდაციები — კონკრეტული, ქმედითი რჩევები პაციენტისთვის, რა გამოკვლევები ჩაატაროს, რომელ სპეციალისტს მიმართოს
6. დასკვნა — შეჯამება და შემდეგი ნაბიჯები

მნიშვნელოვანი: ანგარიში უნდა იყოს ვრცელი და ინფორმატიული (მინიმუმ 2000 სიტყვა). თითოეულ სექციაში ჩაწერე სრული, დეტალური აბზაცები. არ დაზოგო ტექსტი — ეს არის სამედიცინო ანგარიში, რომელსაც პაციენტი ექიმთან წაიღებს.

პასუხი მხოლოდ JSON ფორმატში:
{
  "title": "ანგარიშის სათაური",
  "sections": [
    { "heading": "სექციის სათაური", "content": "სრული ტექსტი აბზაცებით (\\n-ით გამოყოფილი)" }
  ],
  "disclaimer": "სამედიცინო პასუხისმგებლობის უარყოფა"
}`;

    const originalQuery = searchResult?.originalQuery || searchResult?.meta || '';
    const userMessage = `ანგარიშის ტიპი: ${reportType || 'research'}
მომხმარებლის მოთხოვნა: ${originalQuery}
ძიების შედეგები: ${JSON.stringify(searchResult)}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 8000,
                system: reportPrompt,
                messages: [{ role: 'user', content: userMessage }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Claude report error:', response.status, errorBody);
            return getDemoReport(reportType, searchResult);
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        const parsed = extractJSON(text);
        if (parsed && parsed.sections) {
            return parsed;
        }

        return {
            title: 'სამედიცინო ანგარიში',
            sections: [{ heading: 'ანგარიში', content: text }],
            disclaimer: 'ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას.'
        };
    } catch (err) {
        console.error('[MedGzuri] Report generation failed:', err.message);
        return getDemoReport(reportType, searchResult);
    }
}

function getDemoReport(reportType, searchResult) {
    const query = searchResult?.originalQuery || searchResult?.meta || 'სამედიცინო მოთხოვნა';

    // Extract item details from search results for enriched demo
    const items = searchResult?.items || searchResult?.sections?.flatMap(s => s.items || []) || [];
    const itemSummaries = items.map(item =>
        `${item.title || ''}: ${item.body || ''}`
    ).filter(s => s.length > 2);

    const detailSection = itemSummaries.length > 0
        ? itemSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n\n')
        : 'მოძიებული მონაცემები მოიცავს თანამედროვე სამედიცინო კვლევებს, კლინიკურ ცდებს და სპეციალისტთა რეკომენდაციებს. თითოეული წყარო შეფასებულია სანდოობისა და აქტუალობის მიხედვით. კვლევების უმრავლესობა გამოქვეყნებულია ბოლო 5 წლის განმავლობაში რეცენზირებად სამედიცინო ჟურნალებში.';

    return {
        title: `სამედიცინო ანგარიში — ${query}`,
        isDemo: true,
        sections: [
            {
                heading: 'შესავალი',
                content: `წინამდებარე ანგარიში მომზადებულია MED&გზურის სამედიცინო საძიებო სისტემის მიერ, თქვენი მოთხოვნის საფუძველზე: "${query}".\n\nანგარიშის მიზანია მოგაწოდოთ სისტემატიზებული ინფორმაცია თანამედროვე სამედიცინო კვლევებისა და კლინიკური პრაქტიკის შესახებ. ინფორმაცია მოძიებულია საერთაშორისო სამედიცინო მონაცემთა ბაზებიდან, მათ შორის PubMed, ClinicalTrials.gov და სხვა ავტორიტეტული წყაროებიდან.\n\nგთხოვთ გაითვალისწინოთ, რომ ეს ანგარიში არ ჩაანაცვლებს კვალიფიციური ექიმის კონსულტაციას. იგი განკუთვნილია საინფორმაციო მიზნებისთვის და დაგეხმარებათ უფრო ინფორმირებული საუბარი გქონდეთ თქვენს მკურნალ ექიმთან.`
            },
            {
                heading: 'მიმოხილვა',
                content: `ძიების შედეგების ანალიზის საფუძველზე გამოვლინდა რამდენიმე მნიშვნელოვანი მიგნება, რომლებიც ეფუძნება თანამედროვე სამედიცინო კვლევებსა და კლინიკურ პრაქტიკას.\n\nსამედიცინო ლიტერატურის მიმოხილვა აჩვენებს, რომ ამ სფეროში აქტიური კვლევა მიმდინარეობს მთელ მსოფლიოში. ბოლო წლებში მნიშვნელოვანი წინსვლა აღინიშნება როგორც დიაგნოსტიკის, ისე მკურნალობის მეთოდების სრულყოფაში.\n\nგანსაკუთრებით აღსანიშნავია ახალი თერაპიული მიდგომების განვითარება, რომლებიც მიზნად ისახავს მკურნალობის ეფექტურობის გაზრდასა და გვერდითი ეფექტების მინიმიზაციას. კვლევების უმრავლესობა ჩატარებულია მსხვილ სამედიცინო ცენტრებში და შედეგები გამოქვეყნებულია რეცენზირებად ჟურნალებში.`
            },
            {
                heading: 'დეტალური ანალიზი',
                content: detailSection
            },
            {
                heading: 'მკურნალობის ვარიანტები',
                content: 'თანამედროვე მედიცინა გვთავაზობს მკურნალობის მრავალ ვარიანტს, რომელთა შერჩევა ხდება ინდივიდუალურად, პაციენტის მდგომარეობის, ასაკის, თანმხლები დაავადებებისა და სხვა ფაქტორების გათვალისწინებით.\n\nმედიკამენტური თერაპია წარმოადგენს მკურნალობის ერთ-ერთ ძირითად მიმართულებას. ბოლო წლებში დამტკიცებულია რამდენიმე ახალი პრეპარატი, რომლებიც აჩვენებს მაღალ ეფექტურობას კლინიკური კვლევების მიხედვით.\n\nქირურგიული ჩარევის საჭიროება ფასდება ინდივიდუალურად. მინიმალურად ინვაზიური ტექნიკების განვითარებამ საგრძნობლად შეამცირა ოპერაციის შემდგომი გართულებების რისკი და გაამოკლა რეაბილიტაციის პერიოდი.\n\nფიზიკური რეაბილიტაცია და ცხოვრების წესის კორექცია ხშირად მკურნალობის აუცილებელი ნაწილია. სპეციალისტების მიერ შედგენილი ინდივიდუალური პროგრამა მნიშვნელოვნად აუმჯობესებს მკურნალობის საერთო შედეგს.'
            },
            {
                heading: 'რეკომენდაციები',
                content: 'წარმოდგენილი მონაცემების საფუძველზე, რეკომენდირებულია შემდეგი ნაბიჯები:\n\n• მიმართეთ შესაბამის სპეციალისტს კონსულტაციისთვის და წარუდგინეთ ეს ანგარიში\n• ჩაიტარეთ რეკომენდებული დამატებითი გამოკვლევები სრული კლინიკური სურათის მისაღებად\n• განიხილეთ მკურნალობის ვარიანტები თქვენს მკურნალ ექიმთან ერთად\n• აწარმოეთ სიმპტომების დღიური — ეს დაეხმარება ექიმს დინამიკის შეფასებაში\n• არ შეწყვიტოთ მიმდინარე მკურნალობა ექიმის თანხმობის გარეშე\n\nდამატებითი გამოკვლევების ჩატარება დაგეხმარებათ უფრო ზუსტი დიაგნოსტიკური სურათის შექმნასა და ოპტიმალური მკურნალობის გეგმის შედგენაში.'
            },
            {
                heading: 'დასკვნა',
                content: `ამ ანგარიშში წარმოდგენილი ინფორმაცია ეფუძნება საერთაშორისო სამედიცინო მონაცემთა ბაზებში არსებულ კვლევებსა და პუბლიკაციებს.\n\nმნიშვნელოვანია, რომ ყველა სამედიცინო გადაწყვეტილება მიღებული იყოს კვალიფიციურ სპეციალისტთან კონსულტაციის შემდეგ. ანგარიშში წარმოდგენილი ინფორმაცია დაგეხმარებათ ექიმთან უფრო ინფორმირებული და პროდუქტიული საუბრის წარმართვაში.\n\nMED&გზური მზადაა გაგიწიოთ შემდგომი დახმარება — დამატებითი კვლევების მოძიება, კლინიკებთან კომუნიკაცია ან სამედიცინო დოკუმენტაციის თარგმანი.`
            }
        ],
        disclaimer: 'ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას. ყველა სამედიცინო გადაწყვეტილება უნდა მიიღოთ კვალიფიციურ სპეციალისტთან ერთად. MED&გზური არ არის სამედიცინო დაწესებულება და არ ახორციელებს დიაგნოსტიკურ ან სამკურნალო საქმიანობას.'
    };
}

// ═══════════════ PERPLEXITY API ═══════════════
/**
 * Search the web for medical information using Perplexity AI.
 *
 * Returns structured search results with citations, or null on failure.
 * Uses the "sonar" model with low temperature for factual responses.
 * Timeout: 60 seconds.
 *
 * @param {string} query - Natural language search query
 * @returns {Promise<{text: string, citations: string[]}|null>}
 */
async function perplexitySearch(query) {
    if (!PERPLEXITY_API_KEY) {
        console.log('[MedGzuri] Perplexity API key not set, skipping');
        return null;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a medical research assistant for MedGzuri, a Georgian healthcare platform. Search for the most recent, evidence-based medical information. Structure your response as clearly numbered points. For each finding include: the study/source name, key results, and clinical relevance. Include specific studies, clinical trials, hospital names, treatment details, and costs where available. Always cite sources with URLs. IMPORTANT: Write your response in Georgian (ქართული ენა). Use Georgian script for all text except proper nouns, journal names, and URLs. Medical terminology should be in Georgian with Latin/English terms in parentheses where helpful.'
                    },
                    { role: 'user', content: query }
                ],
                max_tokens: 2000,
                temperature: 0.1,
                return_citations: true
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Perplexity error:', response.status, errorBody);
            return null;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';
        console.log(`[MedGzuri] Perplexity success: ${content.length} chars, ${(result.citations || []).length} citations`);
        return {
            text: content,
            citations: result.citations || []
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] Perplexity request timed out (30s)');
        } else {
            console.error('[MedGzuri] Perplexity request failed:', err.message);
        }
        return null;
    }
}

// ═══════════════ CLAUDE API ═══════════════
/**
 * Analyze and structure search results using Anthropic Claude.
 *
 * Takes raw Perplexity search results and transforms them into structured,
 * Georgian-language JSON with items, tags, and metadata.
 *
 * Includes a Georgian content validation step: if < 50% of items contain
 * Georgian text, a follow-up translation request is made (with its own timeout).
 *
 * Fallback chain: Claude failure → raw Perplexity results → demo data
 *
 * @param {object} params
 * @param {string} params.role          - System prompt key (research|symptoms|clinics)
 * @param {string} params.query         - Original user query
 * @param {object|null} params.searchResults - Perplexity results { text, citations }
 * @param {object} params.context       - Additional search context
 * @returns {Promise<object>} Structured result with meta + items[]
 */
async function claudeAnalyze({ role, query, searchResults, context, language }) {
    const isEnglish = language === 'en';
    if (!ANTHROPIC_API_KEY) {
        // Fallback: return raw search results formatted
        if (searchResults?.text) {
            return await formatRawResults(role, query, searchResults);
        }
        return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
    }

    const grammarRules = isEnglish ? `

Critical language requirements (mandatory):
- All text, titles, descriptions, and tags must be in English
- Use professional medical register
- Each item body: minimum 3-5 complete, substantive sentences. Use markdown formatting (bold, lists, headers)
- body field may use: **bold** text, - bullet lists, ### subheadings, [link text](url) format
- CRITICAL: do not split information into many small items. Prefer 3-4 detailed items over 8-10 empty ones` : `

კრიტიკული ენობრივი მოთხოვნები (სავალდებულო):
- ყველა ტექსტი, სათაური, აღწერა და ტეგი უნდა იყოს მხოლოდ ქართულ ენაზე
- აკრძალულია ინგლისური ტექსტის გამოყენება (გარდა URL ლინკებისა და სამეცნიერო ჟურნალის სახელებისა)
- გამოიყენე ლიტერატურული ქართული ენა, სწორი ბრუნვები და ზმნის ფორმები
- სამედიცინო ტერმინოლოგია ქართულად (შეგიძლია ფრჩხილებში მიუთითო ლათინური/ინგლისური ტერმინი საჭიროებისას)
- წინადადებები სრული და გრამატიკულად გამართული უნდა იყოს
- გამოიყენე პროფესიული სამედიცინო რეგისტრი
- თითოეულ item-ის body ველში: მინიმუმ 3-5 სრული, შინაარსიანი წინადადება. გამოიყენე markdown ფორმატირება (bold, lists, headers)
- body ველში შეგიძლია გამოიყენო: **bold** ტექსტი, - ბულეტ სიები, ### ქვესათაურები, [ლინკის ტექსტი](url) ფორმატი
- JSON ველების მნიშვნელობები (title, body, source, tags, meta) - ყველა ქართულად!
- CRITICAL: არ დაყო ინფორმაცია მრავაზ პატარა item-ად. ჯობია 3-4 ვრცელი item, ვიდრე 8-10 ცარიელი`;

    const hardenedRules = `

კრიტიკული წესები (სავალდებულო):
- აკრძალულია მეტა-ტექსტი: "როგორც AI...", "მე ვაპირებ...", "ჩემი პასუხი იქნება...", "აქ არის..."
- აკრძალულია დაუდასტურებელი ინფორმაცია: URL გარეშე ფაქტი = არარსებული ფაქტი
- ყოველ item-ს უნდა ჰქონდეს: title, source, body, url
- თუ citations/URL-ები არ არის: { "meta":"შედეგები არასაკმარისია", "summary":"საჭიროა ხელახლა ძიება", "items":[] }
- მხოლოდ JSON. სხვა ტექსტი აკრძალულია.`;

    const systemPrompts = {
        research: `შენ ხარ MED&გზურის ძიების პასუხის გენერატორი. შენ იღებ "ინტერნეტ ძიების შედეგებს" (ტექსტი + URL-ები) და მხოლოდ მათზე დაყრდნობით უნდა დააბრუნო სტრუქტურირებული JSON.

პასუხი უნდა მოიცავდეს:
1. executive_summary — 3 წინადადებიანი შეჯამება (რა მოიძებნა, მთავარი მიგნება, რეკომენდაცია)
2. დაავადების მოკლე მიმოხილვა
3. უახლესი კვლევები (სათაური, წყარო, ძირითადი მიგნებები)
4. აქტიური კლინიკური კვლევები (თუ არსებობს)
5. მკურნალობის ვარიანტები (სტანდარტული და ექსპერიმენტული)
6. comparison_table — თუ რამდენიმე მკურნალობის ვარიანტი მოიძებნა, შეადარე ცხრილით
7. action_steps — 3-5 კონკრეტული ნაბიჯი (რა უნდა გააკეთოს პაციენტმა)

მტკიცებულების დონეები — თითოეულ item-ს მიანიჭე evidence_level:
- "I" = სისტემატური მიმოხილვა / მეტა-ანალიზი (🟢)
- "II" = რანდომიზებული კონტროლირებული კვლევა (🔵)
- "III" = კოჰორტული / შემთხვევა-კონტროლი (🟡)
- "IV" = შემთხვევის აღწერა (🟠)
- "V" = ექსპერტის მოსაზრება (⚪)

ვერიფიკაციის ნოტები — თითოეულ item-ში მიუთითე:
- verification_note: "დადასტურებულია 2+ წყაროდან" ან "ერთი წყაროდან" ან "საჭიროა დამატებითი დადასტურება"
- თუ კვლევა 5 წელზე ძველია, მიუთითე: "[⚠️ მოძველებული კვლევა: YYYY წ.]"
${grammarRules}${hardenedRules}

პასუხი უნდა იყოს მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ისაგ გარეთ):
{
  "meta": "ნაპოვნია X კვლევა, Y კლინიკური კვლევა",
  "executive_summary": "3 წინადადებიანი შეჯამება",
  "items": [
    { "title": "სათაური", "source": "წყარო", "body": "აღწერა", "tags": ["ტეგი"], "url": "ლინკი", "evidence_level": "I", "verification_note": "დადასტურებულია 2+ წყაროდან" }
  ],
  "comparison_table": { "headers": ["მკურნალობა", "ეფექტურობა", "გვერდითი მოვლენები", "ღირებულება", "ხელმისაწვდომობა"], "rows": [["...", "...", "...", "...", "..."]] },
  "action_steps": ["1. ექიმთან კონსულტაცია", "2. ...", "3. ..."]
}`,

        symptoms: `შენ ხარ MED&გზურის ძიების პასუხის გენერატორი. შენ იღებ "ინტერნეტ ძიების შედეგებს" (ტექსტი + URL-ები) და მხოლოდ მათზე დაყრდნობით უნდა დააბრუნო სტრუქტურირებული JSON.

მნიშვნელოვანი: არ დაასახელო კონკრეტული დიაგნოზი. მხოლოდ შემოთავაზე:
1. executive_summary — 3 წინადადებიანი შეჯამება
2. რა ტიპის გამოკვლევები არსებობს ამ სიმპტომებისთვის
3. რომელ სპეციალისტთან შეიძლება მიმართვა
4. რა კვლევები არსებობს ამ სიმპტომატიკასთან დაკავშირებით
5. action_steps — 3-5 კონკრეტული ნაბიჯი (რა უნდა გააკეთოს პაციენტმა)
${grammarRules}${hardenedRules}

პასუხი მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ის გარეთ):
{
  "meta": "სიმპტომების ანალიზი",
  "executive_summary": "3 წინადადებიანი შეჯამება",
  "summary": "ზოგადი მიმოხილვა",
  "items": [
    { "title": "რეკომენდებული გამოკვლევა/სპეციალისტი", "body": "აღწერა", "tags": ["ტეგი"] }
  ],
  "action_steps": ["1. ექიმთან კონსულტაცია", "2. ...", "3. ..."]
}`,

        clinics: `შენ ხარ MED&გზურის ძიების პასუხის გენერატორი. შენ იღებ "ინტერნეტ ძიების შედეგებს" (ტექსტი + URL-ები) და მხოლოდ მათზე დაყრდნობით უნდა დააბრუნო სტრუქტურირებული JSON.

პასუხი უნდა მოიცავდეს:
1. executive_summary — 3 წინადადებიანი შეჯამება
2. რეკომენდებული კლინიკები (სახელი ქართულად და ინგლისურად, ქვეყანა, სპეციალიზაცია)
3. სავარაუდო ფასები: მკურნალობის ღირებულება + მგზავრობა + საცხოვრებელი = სრული ღირებულება
4. მკურნალობის ტექნოლოგიები და ხარისხის ინდიკატორები (JCI, უნივერსიტეტი)
5. საკონტაქტო ინფორმაცია ან ვებსაიტი
6. comparison_table — კლინიკების შედარება ცხრილით (მკურნალობის ფასი + სრული ღირებულება მგზავრობით)
7. action_steps — 3-5 კონკრეტული ნაბიჯი კლინიკაში მიმართვისთვის
8. "რეკომენდებული ქართველი პაციენტებისთვის" სექცია — კლინიკები ქართულენოვანი მომსახურებით, სიახლოვით, ხელმისაწვდომი ფასებით

თითოეული კლინიკისთვის მიუთითე:
- მკურნალობის სავარაუდო ფასი (USD დიაპაზონი)
- ავიაბილეთი თბილისიდან
- საცხოვრებელი ხარჯი (დღიური)
- ვიზის საჭიროება
- ენების მხარდაჭერა (განსაკუთრებით ქართული/რუსული)
${grammarRules}${hardenedRules}

პასუხი მხოლოდ JSON ფორმატში (არანაირი დამატებითი ტექსტი JSON-ისაგ გარეთ):
{
  "meta": "ნაპოვნია X კლინიკა Y ქვეყანაში",
  "executive_summary": "3 წინადადებიანი შეჯამება",
  "items": [
    { "title": "კლინიკის სახელი", "source": "ქვეყანა", "body": "აღწერა, ფასი, ტექნოლოგია, სრული ღირებულება", "tags": ["ტეგი"], "url": "ვებსაიტი", "price": "სრული ღირებულება" }
  ],
  "comparison_table": { "headers": ["კლინიკა", "ქვეყანა", "მკურნალობა", "სრული ღირებულება", "ქულა", "ვიზა"], "rows": [["...", "...", "...", "...", "...", "..."]] },
  "action_steps": ["1. ექიმთან კონსულტაცია", "2. ...", "3. ..."]
}`
    };

    // Gate: თუ search results არ გვაქვს — არ ვგენერირებთ
    if (!searchResults?.text) {
        return {
            meta: 'ინტერნეტ ძიება ვერ შესრულდა',
            summary: 'ვერ მოვიძიეთ ონლაინ წყაროები. შეამოწმეთ PERPLEXITY_API_KEY.',
            items: [],
            _grounded: false
        };
    }
    const searchSection = `\nინტერნეტ ძიების შედეგები:\n${searchResults.text}`;
    const citationSection = searchResults?.citations?.length
        ? `\nწყაროები: ${searchResults.citations.join(', ')}`
        : '';

    const userMessage = `ძიების მოთხოვნა: ${query}
კონტექსტი: ${JSON.stringify(context)}${searchSection}${citationSection}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: systemPrompts[role] || systemPrompts.research,
                messages: [{ role: 'user', content: userMessage }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'unable to read body');
            console.error('[MedGzuri] Claude error:', response.status, errorBody);
            if (searchResults?.text) {
                return await formatRawResults(role, query, searchResults);
            }
            // Fallback to demo data instead of throwing
            return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || '';

        // Try to parse JSON from response
        const parsed = extractJSON(text);
        if (parsed && parsed.items && parsed.items.length > 0) {
            // Skip Georgian validation when language is English
            if (isEnglish) return parsed;

            // Validate Georgian content — check if at least 60% of items have Georgian text
            const georgianRegex = /[\u10A0-\u10FF\u2D00-\u2D2F]/;
            const georgianItems = parsed.items.filter(item =>
                georgianRegex.test(item.title || '') || georgianRegex.test(item.body || '')
            );
            const georgianRatio = georgianItems.length / parsed.items.length;

            if (georgianRatio < 0.5) {
                console.warn(`[MedGzuri] Low Georgian ratio: ${(georgianRatio * 100).toFixed(0)}% — attempting translation fix`);
                // Items are mostly English — request Georgian translation with its own timeout
                const fixController = new AbortController();
                const fixTimeoutId = setTimeout(() => fixController.abort(), 60000);
                try {
                    const fixResponse = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'claude-sonnet-4-6',
                            max_tokens: 3000,
                            messages: [{
                                role: 'user',
                                content: `თარგმნე ეს JSON ქართულ ენაზე. ყველა title, body, source, tags ველი უნდა იყოს ქართულად. URL-ები არ შეცვალო. დააბრუნე მხოლოდ JSON, სხვა ტექსტი არ დაწერო.\n\n${JSON.stringify(parsed)}`
                            }]
                        }),
                        signal: fixController.signal
                    });
                    clearTimeout(fixTimeoutId);
                    if (fixResponse.ok) {
                        const fixResult = await fixResponse.json();
                        const fixText = fixResult.content?.[0]?.text || '';
                        const fixParsed = extractJSON(fixText);
                        if (fixParsed && fixParsed.items && fixParsed.items.length > 0) {
                            console.log('[MedGzuri] Georgian translation fix succeeded');
                            return fixParsed;
                        }
                    }
                } catch (fixErr) {
                    clearTimeout(fixTimeoutId);
                    console.error('[MedGzuri] Georgian fix failed:', fixErr.message);
                }
            }
            return parsed;
        }

        // Claude responded but not in valid JSON — try to use the text as Georgian content
        if (text.length > 50) {
            // Check if text contains Georgian characters
            const hasGeorgian = /[\u10A0-\u10FF]/.test(text);
            return {
                meta: 'ძიების შედეგები',
                items: [{
                    title: query || 'სამედიცინო ინფორმაცია',
                    body: hasGeorgian ? text : 'ძიების შედეგები დამუშავდა, მაგრამ ფორმატირება ვერ მოხერხდა. გთხოვთ სცადოთ თავიდან.',
                    tags: ['ძიება']
                }],
                summary: hasGeorgian ? undefined : text
            };
        }

        return {
            meta: 'ძიების შედეგები (არასტრუქტურირებული)',
            summary: text,
            items: []
        };

    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] Claude request timed out (45s)');
        } else {
            console.error('[MedGzuri] Claude request failed:', err.message);
        }
        if (searchResults?.text) {
            return await formatRawResults(role, query, searchResults);
        }
        // Fallback to demo data instead of throwing
        return getDemoResult(role === 'symptoms' ? 'symptoms' : role === 'clinics' ? 'clinics' : 'research', { diagnosis: query });
    }
}

// ═══════════════ N8N PROXY ═══════════════
/**
 * Proxy a search request to the n8n multi-agent workflow.
 *
 * Returns null if n8n is not configured, if the type is unsupported,
 * or if the request fails/times out (30s). The caller falls back to
 * the direct Perplexity+Claude pipeline.
 *
 * @param {string} type - Search type
 * @param {object} data - Search parameters
 * @returns {Promise<object|null>} Structured result or null
 */
async function proxyToN8n(type, data) {
    if (!N8N_WEBHOOK_BASE_URL) return null;

    const webhookPaths = {
        research: '/research',
        symptoms: '/symptoms',
        clinics: '/clinics'
    };

    if (!webhookPaths[type]) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(`${N8N_WEBHOOK_BASE_URL}${webhookPaths[type]}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': N8N_WEBHOOK_SECRET || ''
            },
            body: JSON.stringify({ type, data }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[MedGzuri] n8n webhook error: ${response.status}`);
            return null;
        }

        const result = await response.json();
        return ensureBackwardCompat(result);
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] n8n proxy timed out (30s)');
        } else {
            console.error('[MedGzuri] n8n proxy failed:', err.message);
        }
        return null;
    }
}

/**
 * Normalize n8n response to match the frontend's expected format.
 * Converts sections-based responses to flat items[] when needed.
 *
 * @param {object} result - Raw n8n response
 * @returns {object} Normalized result
 */
function ensureBackwardCompat(result) {
    // Handle raw Anthropic messages payload (common from n8n HTTP Request)
    if (!result.items && !result.sections && Array.isArray(result.content) && result.content[0]?.text) {
        const parsed = extractJSON(result.content[0].text);
        if (parsed) return ensureBackwardCompat(parsed);
        result.summary = result.content[0].text;
        result.items = [];
    }

    if (result.sections && (!result.items || result.items.length === 0)) {
        result.items = result.sections.flatMap(s => s.items || []);
    }
    if (!result.meta) {
        result.meta = 'ძიების შედეგები';
    }
    return result;
}

// ═══════════════ RAILWAY BACKEND PROXY ═══════════════
/**
 * Proxy search requests to the Railway FastAPI backend (agent-based pipelines).
 * Supports research, symptoms, and clinics types.
 * Returns null on failure so the caller can fall back to the direct pipeline.
 *
 * @param {string} type - Search type (research|symptoms|clinics)
 * @param {object} data - Search parameters
 * @returns {Promise<object|null>} Parsed result or null on failure
 */
async function proxyToRailway(type, data) {
    if (!RAILWAY_BACKEND_URL) return null;

    const PROXY_TYPES = new Set(['research', 'symptoms', 'clinics']);
    if (!PROXY_TYPES.has(type)) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 240000);

    try {
        const response = await fetch(`${RAILWAY_BACKEND_URL}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, data }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[MedGzuri] Railway proxy error: ${response.status}`);
            return null;
        }

        const result = await response.json();
        return ensureBackwardCompat(result);
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error('[MedGzuri] Railway proxy timed out (240s)');
        } else {
            console.error('[MedGzuri] Railway proxy failed:', err.message);
        }
        return null;
    }
}

// ═══════════════ JSON EXTRACTION ═══════════════
/**
 * Extract a valid JSON object from potentially messy LLM output.
 *
 * Uses three strategies in order of likelihood:
 *   1. Code fence (```json { ... } ```) — most structured responses
 *   2. Full text as JSON                — when LLM returns pure JSON
 *   3. Balanced-brace extraction        — when LLM wraps JSON in prose
 *
 * Validates that the parsed object contains expected keys (items/meta/summary/sections).
 *
 * Performance note (Strategy 3): Previous version called JSON.parse() at every
 * depth-0 closing brace, making it O(n * k) where k = number of top-level `}`.
 * Now it only parses the FIRST complete balanced object, then stops — O(n) scan
 * + one parse attempt. If the first candidate fails, it continues to the next.
 *
 * @param {string} text - Raw LLM response text
 * @returns {object|null} Parsed JSON object, or null if extraction fails
 */
function extractJSON(text) {
    // Strategy 1: Try code fence (```json ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
        const result = tryParseValid(fenceMatch[1]);
        if (result) return result;
    }

    // Strategy 2: Try full text as JSON (avoid regex overhead)
    const trimmed = text.trim();
    if (trimmed.charCodeAt(0) === 123) { // '{' char code — faster than startsWith
        const result = tryParseValid(trimmed);
        if (result) return result;
    }

    // Strategy 3: Balanced braces extraction — single O(n) scan
    let searchFrom = 0;
    while (searchFrom < text.length) {
        const startIdx = text.indexOf('{', searchFrom);
        if (startIdx === -1) break;

        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = text.substring(startIdx, i + 1);
                    const result = tryParseValid(candidate);
                    if (result) return result;
                    // This candidate wasn't valid — search for next '{' after this block
                    searchFrom = i + 1;
                    break;
                }
            }
        }
        // If we exit the loop without depth reaching 0, no more valid JSON
        if (depth !== 0) break;
    }

    return null;
}

/**
 * Attempt to parse a string as JSON and validate it has expected MedGzuri keys.
 *
 * @param {string} str - JSON candidate string
 * @returns {object|null} Parsed object if valid, null otherwise
 */
function tryParseValid(str) {
    try {
        const parsed = JSON.parse(str);
        if (parsed && (parsed.items || parsed.meta || parsed.summary || parsed.sections)) {
            return parsed;
        }
    } catch { /* not valid JSON */ }
    return null;
}

// ═══════════════ HELPERS ═══════════════
/**
 * Build a natural-language search query for the Perplexity research endpoint.
 *
 * @param {string} diagnosis    - Medical condition or diagnosis
 * @param {string} ageGroup     - Patient age group (e.g., "adult", "pediatric")
 * @param {string} researchType - Filter: clinical_trial, systematic_review, etc.
 * @param {string} context      - Additional free-text context
 * @returns {string} Constructed search query
 */
function buildResearchQuery(diagnosis, ageGroup, researchType, context) {
    const normalizedDiagnosis = normalizeMedicalTerm(diagnosis);
    const normalizedAgeGroup = normalizeAgeGroup(ageGroup);
    let query = `Latest medical research, clinical trials, and treatment options for ${normalizedDiagnosis}.`;
    if (normalizedAgeGroup) query += ` Patient age group: ${normalizedAgeGroup}.`;
    if (researchType && researchType !== 'all') {
        const types = {
            clinical_trial: 'clinical trials',
            systematic_review: 'systematic reviews',
            case_study: 'case studies',
            meta_analysis: 'meta-analyses'
        };
        query += ` Focus on ${types[researchType] || researchType}.`;
    }
    if (context) query += ` Additional context: ${context}`;
    return query;
}

// ═══════════════ FORMAT RAW RESULTS ═══════════════
/**
 * Wrap raw Perplexity text into the standard MedGzuri response format.
 * Used as a fallback when Claude is unavailable.
 *
 * @param {string} role          - Search role (unused, kept for signature consistency)
 * @param {string} query         - Original search query
 * @param {object} searchResults - Raw Perplexity results { text, citations }
 * @returns {Promise<object>} Formatted result
 */
async function formatRawResults(role, query, searchResults) {
    return {
        meta: 'ძიების შედეგები',
        items: [{
            title: query || 'სამედიცინო ინფორმაცია',
            body: searchResults.text || '',
            tags: ['ძიება'],
            source: 'Perplexity AI'
        }],
        _rawFallback: true
    };
}

// ═══════════════ DEMO DATA ═══════════════
/**
 * Return static Georgian mock data for demo/development mode.
 * Activated when no API keys are configured.
 *
 * @param {string} type - Search type (research|symptoms|clinics)
 * @param {object} data - Search parameters (used for context in future)
 * @returns {object} Demo result in standard MedGzuri response format
 */
function getDemoResult(type, data) {
    if (type === 'research') {
        return {
            meta: 'ნაპოვნია 3 კვლევა (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'უახლესი კვლევები',
                    source: 'PubMed / ClinicalTrials.gov',
                    body: 'ეს არის სადემონსტრაციო შედეგი. რეალური ძიებისთვის საჭიროა API კონფიგურაცია.\n\nPubMed-ის მონაცემთა ბაზა მოიცავს 38 მილიონზე მეტ სამედიცინო კვლევას. ჩვენი სისტემა ახდენს მათ ანალიზს და თარგმნის ქართულად.',
                    tags: ['კვლევა', 'PubMed'],
                    url: 'https://pubmed.ncbi.nlm.nih.gov/'
                },
                {
                    title: 'კლინიკური კვლევები',
                    source: 'ClinicalTrials.gov',
                    body: 'აქტიური კლინიკური კვლევების ძიება ხელმისაწვდომია. კლინიკური კვლევები წარმოადგენს ახალი მკურნალობის მეთოდების შემოწმების საშუალებას.\n\nრეგისტრაცია კლინიკურ კვლევაში შეიძლება იყოს ალტერნატიული გზა მკურნალობისთვის.',
                    tags: ['კლინიკური კვლევა', 'მკურნალობა'],
                    url: 'https://clinicaltrials.gov/'
                },
                {
                    title: 'მკურნალობის მიმოხილვა',
                    source: 'სამედიცინო ლიტერატურა',
                    body: 'სტანდარტული და ინოვაციური მკურნალობის მეთოდების მიმოხილვა. მოიცავს ფარმაკოლოგიურ და არაფარმაკოლოგიურ მიდგომებს.\n\nრეკომენდირებულია ყველა ინფორმაციის განხილვა თქვენს ექიმთან.',
                    tags: ['მკურნალობა', 'მიმოხილვა']
                }
            ]
        };
    }

    if (type === 'symptoms') {
        return {
            meta: 'სიმპტომების ანალიზი (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'რეკომენდებული გამოკვლევები',
                    body: 'ეს არის სადემონსტრაციო შედეგი. რეალური ანალიზისთვის საჭიროა სისტემის სრული კონფიგურაცია.\n\nაღწერილი სიმპტომების საფუძველზე, შეიძლება მიზანშეწონილი იყოს შემდეგი გამოკვლევების განხილვა თქვენს ექიმთან ერთად:\n• სრული სისხლის ანალიზი\n• ბიოქიმიური ანალიზი\n• სპეციფიკური მარკერები დიაგნოზის მიხედვით',
                    tags: ['გამოკვლევა', 'ლაბორატორია']
                },
                {
                    title: 'სპეციალისტთან კონსულტაცია',
                    body: 'აღწერილი სიმპტომატიკით შეიძლება საჭირო გახდეს შესაბამისი სპეციალისტის კონსულტაცია. თქვენი ოჯახის ექიმი განსაზღვრავს ოპტიმალურ მიმართულებას.',
                    tags: ['სპეციალისტი', 'კონსულტაცია']
                }
            ]
        };
    }

    if (type === 'clinics') {
        return {
            meta: 'ნაპოვნია 3 კლინიკა (სადემონსტრაციო რეჟიმი)',
            items: [
                {
                    title: 'Charit\u00e9 University Hospital',
                    source: 'გერმანია, ბერლინი',
                    body: 'ევროპის ერთ-ერთი წამყვანი უნივერსიტეტის საავადმყოფო (სადემონსტრაციო). 100+ კლინიკა და ინსტიტუტი. საერთაშორისო პაციენტების ოფისი ხელმისაწვდომია.\n\nსავარაუდო ფასი: ინდივიდუალური შეფასება\nენა: ინგლისური, გერმანული',
                    tags: ['გერმანია', 'უნივერსიტეტის კლინიკა', 'ევროპის წამყვანი'],
                    url: 'https://www.charite.de/en/'
                },
                {
                    title: 'Memorial Healthcare Group',
                    source: 'თურქეთი, ისტანბული',
                    body: 'თურქეთის წამყვანი კერძო ჰოსპიტალური ქსელი (სადემონსტრაციო). საერთაშორისო აკრედიტაცია. რუსულენოვანი პერსონალი ხელმისაწვდომია.\n\nსავარაუდო ფასი: გერმანიაზე 40-60% ნაკლები\nენა: ინგლისური, თურქული, რუსული',
                    tags: ['თურქეთი', 'აკრედიტებული', 'საერთაშორისო'],
                    url: 'https://www.memorial.com.tr/en/'
                },
                {
                    title: 'Sheba Medical Center',
                    source: 'ისრაელი, რამატ განი',
                    body: 'ისრაელის უმსხვილესი სამედიცინო ცენტრი (სადემონსტრაციო). მსოფლიოს წამყვან საავადმყოფოთა რიცხვში. ინოვაციური მკურნალობის მეთოდები.\n\nსავარაუდო ფასი: პრემიუმ სეგმენტი\nენა: ინგლისური, ებრაული',
                    tags: ['ისრაელი', 'მსოფლიო წამყვანი', 'ინოვაცია'],
                    url: 'https://www.shebaonline.org/'
                }
            ]
        };
    }

    return { meta: 'სადემონსტრაციო რეჟიმი', items: [] };
}
