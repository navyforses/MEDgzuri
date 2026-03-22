"""Georgian-English medical term dictionary for common terms.

Used as a fallback when LLM-based translation is unavailable.
"""

# Georgian → English medical terms (most common)
KA_TO_EN = {
    # Cancers
    "ფილტვის კიბო": "lung cancer",
    "ძუძუს კიბო": "breast cancer",
    "სიმსივნე": "tumor",
    "თავის ტვინის სიმსივნე": "brain tumor",
    "პროსტატის კიბო": "prostate cancer",
    "კუჭის კიბო": "stomach cancer",
    "ნაწლავის კიბო": "colon cancer",
    "ღვიძლის კიბო": "liver cancer",
    "ლეიკემია": "leukemia",
    "ლიმფომა": "lymphoma",
    "მელანომა": "melanoma",
    "კიბო": "cancer",
    "იმუნოთერაპია": "immunotherapy",
    "ქიმიოთერაპია": "chemotherapy",
    "სხივური თერაპია": "radiation therapy",
    # Cardiology
    "გულის უკმარისობა": "heart failure",
    "არითმია": "arrhythmia",
    "ინფარქტი": "myocardial infarction",
    "ჰიპერტენზია": "hypertension",
    "ათეროსკლეროზი": "atherosclerosis",
    # Neurology
    "თავის ტკივილი": "headache",
    "მიგრენი": "migraine",
    "ეპილეფსია": "epilepsy",
    "ინსულტი": "stroke",
    "პარკინსონის დაავადება": "Parkinson's disease",
    "ალცჰეიმერის დაავადება": "Alzheimer's disease",
    "გაფანტული სკლეროზი": "multiple sclerosis",
    "მხედველობის დაბინდვა": "blurred vision",
    # Endocrinology
    "დიაბეტი": "diabetes mellitus",
    "ფარისებრი ჯირკვალი": "thyroid",
    "ჰიპოთირეოზი": "hypothyroidism",
    "ჰიპერთირეოზი": "hyperthyroidism",
    # Gastroenterology
    "გულისრევა": "nausea",
    "ღებინება": "vomiting",
    "დიარეა": "diarrhea",
    "ყაბზობა": "constipation",
    "გასტრიტი": "gastritis",
    # Symptoms
    "ცხელება": "fever",
    "სისუსტე": "weakness",
    "წონის კლება": "weight loss",
    "ტკივილი": "pain",
    "სუნთქვის გაძნელება": "dyspnea",
    "ხველა": "cough",
    "გამონაყარი": "rash",
    "შეშუპება": "edema",
    "თავბრუსხვევა": "dizziness",
}

# Common medications Georgian → English
MEDICATIONS_KA_TO_EN = {
    "მეტფორმინი": "metformin",
    "ამლოდიპინი": "amlodipine",
    "ომეპრაზოლი": "omeprazole",
    "იბუპროფენი": "ibuprofen",
    "პარაცეტამოლი": "paracetamol",
    "ასპირინი": "aspirin",
}


def translate_term(term_ka: str) -> str | None:
    """Look up a Georgian medical term in the dictionary."""
    return KA_TO_EN.get(term_ka)
