"""RAG (Retrieval-Augmented Generation) system for Georgian medical knowledge.

Simple in-memory vector-like search using TF-IDF-style term matching.
No external vector DB — uses structured knowledge base with keyword retrieval.
"""

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


class MedicalFact:
    """Single fact in the knowledge base."""

    def __init__(
        self,
        condition: str,
        condition_ka: str,
        category: str,
        facts: list[str],
        facts_ka: list[str],
        symptoms: list[str] = None,
        treatments: list[str] = None,
        specialists: list[str] = None,
        keywords: list[str] = None,
    ) -> None:
        self.condition = condition
        self.condition_ka = condition_ka
        self.category = category
        self.facts = facts
        self.facts_ka = facts_ka
        self.symptoms = symptoms or []
        self.treatments = treatments or []
        self.specialists = specialists or []
        # Build keyword index for retrieval
        self.keywords = set(kw.lower() for kw in (keywords or []))
        # Auto-add condition and category as keywords
        self.keywords.add(condition.lower())
        self.keywords.add(condition_ka.lower())
        self.keywords.add(category.lower())
        for s in self.symptoms:
            self.keywords.add(s.lower())
        for t in self.treatments:
            self.keywords.add(t.lower())


# ═══════════════ KNOWLEDGE BASE ═══════════════

_KNOWLEDGE_BASE: list[MedicalFact] = []


def build_knowledge_base() -> int:
    """Build the in-memory medical knowledge base. Returns number of facts loaded."""
    global _KNOWLEDGE_BASE

    if _KNOWLEDGE_BASE:
        return len(_KNOWLEDGE_BASE)

    facts = [
        MedicalFact(
            condition="diabetes mellitus",
            condition_ka="შაქრიანი დიაბეტი",
            category="ენდოკრინოლოგია",
            facts=[
                "Type 2 diabetes accounts for ~90% of all diabetes cases worldwide.",
                "HbA1c below 7% is the general target for most adults with diabetes.",
                "Metformin remains the first-line pharmacotherapy for type 2 diabetes.",
                "Regular screening for diabetic retinopathy, nephropathy, and neuropathy is essential.",
                "Lifestyle modifications (diet, exercise) can reduce type 2 diabetes risk by 58%.",
            ],
            facts_ka=[
                "მე-2 ტიპის დიაბეტი მსოფლიოში დიაბეტის შემთხვევების ~90%-ს შეადგენს.",
                "HbA1c 7%-ზე ქვემოთ არის ზოგადი სამიზნე უმრავლესობა მოზრდილთათვის.",
                "მეტფორმინი რჩება პირველი რიგის ფარმაკოთერაპია მე-2 ტიპის დიაბეტისთვის.",
                "აუცილებელია რეტინოპათიის, ნეფროპათიისა და ნეიროპათიის რეგულარული სკრინინგი.",
                "ცხოვრების წესის ცვლილებებმა შეიძლება დიაბეტის რისკი 58%-ით შეამციროს.",
            ],
            symptoms=["thirst", "frequent urination", "fatigue", "blurred vision", "weight loss"],
            treatments=["metformin", "insulin", "GLP-1 agonists", "SGLT2 inhibitors"],
            specialists=["ენდოკრინოლოგი", "ოფთალმოლოგი", "ნეფროლოგი"],
            keywords=["diabetes", "დიაბეტი", "blood sugar", "შაქარი", "insulin", "ინსულინი", "HbA1c"],
        ),
        MedicalFact(
            condition="hypertension",
            condition_ka="ჰიპერტენზია",
            category="კარდიოლოგია",
            facts=[
                "Hypertension affects approximately 1.28 billion adults worldwide.",
                "Target blood pressure is generally <130/80 mmHg for most adults.",
                "First-line medications include ACE inhibitors, ARBs, calcium channel blockers, and thiazide diuretics.",
                "Uncontrolled hypertension is a leading risk factor for stroke, heart attack, and kidney disease.",
                "DASH diet and sodium restriction can lower systolic BP by 8-14 mmHg.",
            ],
            facts_ka=[
                "ჰიპერტენზია მსოფლიოში დაახლოებით 1.28 მილიარდ ზრდასრულ ადამიანს აწუხებს.",
                "სამიზნე არტერიული წნევა ზოგადად <130/80 მმ ვწყ-ია.",
                "პირველი რიგის მედიკამენტები მოიცავს ACE ინჰიბიტორებს, ARB-ებს, კალციუმის ბლოკატორებს.",
                "უკონტროლო ჰიპერტენზია ინსულტის, ინფარქტის და თირკმლის დაავადების მთავარი რისკ-ფაქტორია.",
                "DASH დიეტა და მარილის შეზღუდვა სისტოლური წნევის 8-14 მმ ვწყ-ით შემცირებას უზრუნველყოფს.",
            ],
            symptoms=["headache", "dizziness", "chest pain", "shortness of breath"],
            treatments=["ACE inhibitors", "ARBs", "amlodipine", "hydrochlorothiazide"],
            specialists=["კარდიოლოგი", "ნეფროლოგი"],
            keywords=["hypertension", "ჰიპერტენზია", "blood pressure", "წნევა", "არტერიული"],
        ),
        MedicalFact(
            condition="breast cancer",
            condition_ka="ძუძუს კიბო",
            category="ონკოლოგია",
            facts=[
                "Breast cancer is the most common cancer in women worldwide.",
                "Early detection through mammography screening reduces mortality by 20-40%.",
                "HER2-positive breast cancer responds to targeted therapy (trastuzumab).",
                "BRCA1/BRCA2 mutations increase lifetime breast cancer risk to 45-72%.",
                "5-year survival rate for localized breast cancer exceeds 99%.",
            ],
            facts_ka=[
                "ძუძუს კიბო ქალებში ყველაზე გავრცელებული კიბოა მსოფლიოში.",
                "მამოგრაფიული სკრინინგით ადრეული გამოვლენა სიკვდილიანობას 20-40%-ით ამცირებს.",
                "HER2-დადებითი ძუძუს კიბო ეხმიანება მიზნობრივ თერაპიას (ტრასტუზუმაბი).",
                "BRCA1/BRCA2 მუტაციები ძუძუს კიბოს რისკს 45-72%-მდე ზრდის.",
                "ლოკალიზებული ძუძუს კიბოს 5-წლიანი გადარჩენადობა 99%-ს აღემატება.",
            ],
            symptoms=["breast lump", "nipple discharge", "skin changes", "pain"],
            treatments=["surgery", "chemotherapy", "radiation", "hormonal therapy", "immunotherapy"],
            specialists=["ონკოლოგი", "მამოლოგი", "ქირურგი"],
            keywords=["breast cancer", "ძუძუს კიბო", "mammogram", "BRCA", "HER2", "მამოგრაფია"],
        ),
        MedicalFact(
            condition="stroke",
            condition_ka="ინსულტი",
            category="ნევროლოგია",
            facts=[
                "Ischemic stroke accounts for ~87% of all strokes.",
                "tPA (alteplase) must be administered within 4.5 hours of symptom onset.",
                "FAST acronym: Face drooping, Arm weakness, Speech difficulty, Time to call emergency.",
                "Atrial fibrillation increases stroke risk 5-fold.",
                "Post-stroke rehabilitation should begin within 24-48 hours when medically stable.",
            ],
            facts_ka=[
                "იშემიური ინსულტი ყველა ინსულტის ~87%-ს შეადგენს.",
                "tPA (ალტეპლაზა) სიმპტომების დაწყებიდან 4.5 საათში უნდა შეიყვანოთ.",
                "FAST: სახის ჩამოშვება, ხელის სისუსტე, მეტყველების გაძნელება, დრო სასწრაფოსთვის.",
                "წინაგულთა ფიბრილაცია ინსულტის რისკს 5-ჯერ ზრდის.",
                "ინსულტის შემდგომი რეაბილიტაცია 24-48 საათში უნდა დაიწყოს.",
            ],
            symptoms=["facial drooping", "arm weakness", "speech difficulty", "sudden headache"],
            treatments=["tPA", "thrombectomy", "anticoagulants", "rehabilitation"],
            specialists=["ნევროლოგი", "ნეიროქირურგი", "რეაბილიტოლოგი"],
            keywords=["stroke", "ინსულტი", "brain", "ტვინი", "paralysis", "დამბლა", "tPA"],
        ),
        MedicalFact(
            condition="asthma",
            condition_ka="ბრონქული ასთმა",
            category="პულმონოლოგია",
            facts=[
                "Asthma affects approximately 300 million people worldwide.",
                "Inhaled corticosteroids (ICS) are the cornerstone of asthma maintenance therapy.",
                "Peak flow monitoring helps detect worsening asthma before symptoms appear.",
                "Asthma action plans reduce emergency visits by up to 70%.",
                "Biologic therapies (omalizumab, mepolizumab) target severe refractory asthma.",
            ],
            facts_ka=[
                "ასთმა მსოფლიოში დაახლოებით 300 მილიონ ადამიანს აწუხებს.",
                "საინჰალაციო კორტიკოსტეროიდები ასთმის შემანარჩუნებელი თერაპიის საფუძველია.",
                "პიკური ნაკადის მონიტორინგი ეხმარება ასთმის გაუარესების ადრეულ გამოვლენას.",
                "ასთმის მოქმედების გეგმა გადაუდებელ ვიზიტებს 70%-მდე ამცირებს.",
                "ბიოლოგიური თერაპია (ომალიზუმაბი) მძიმე რეფრაქტერული ასთმის მკურნალობას ემსახურება.",
            ],
            symptoms=["wheezing", "cough", "shortness of breath", "chest tightness"],
            treatments=["inhaled corticosteroids", "bronchodilators", "biologics", "leukotriene modifiers"],
            specialists=["პულმონოლოგი", "ალერგოლოგი"],
            keywords=["asthma", "ასთმა", "breathing", "სუნთქვა", "inhaler", "ინჰალატორი", "wheezing"],
        ),
        MedicalFact(
            condition="depression",
            condition_ka="დეპრესია",
            category="ფსიქიატრია",
            facts=[
                "Major depressive disorder affects ~280 million people globally.",
                "SSRIs are generally first-line pharmacotherapy for depression.",
                "Cognitive behavioral therapy (CBT) is as effective as medication for mild-moderate depression.",
                "Treatment response typically takes 4-6 weeks to assess.",
                "Exercise has been shown to have antidepressant effects comparable to medication in mild cases.",
            ],
            facts_ka=[
                "მაჟორული დეპრესიული აშლილობა მსოფლიოში ~280 მილიონ ადამიანს აწუხებს.",
                "SSRI-ები ზოგადად დეპრესიის პირველი რიგის ფარმაკოთერაპიაა.",
                "კოგნიტურ-ბიჰევიორული თერაპია მსუბუქ-საშუალო დეპრესიაზე მედიკამენტების ტოლფასია.",
                "მკურნალობაზე პასუხის შეფასებას ჩვეულებრივ 4-6 კვირა სჭირდება.",
                "ფიზიკურ აქტივობას მსუბუქ შემთხვევებში ანტიდეპრესანტული ეფექტი აქვს.",
            ],
            symptoms=["sadness", "loss of interest", "fatigue", "sleep problems", "concentration difficulty"],
            treatments=["SSRIs", "SNRIs", "CBT", "psychotherapy", "exercise"],
            specialists=["ფსიქიატრი", "ფსიქოლოგი", "ფსიქოთერაპევტი"],
            keywords=["depression", "დეპრესია", "mental health", "ფსიქიკური", "mood", "განწყობა", "anxiety"],
        ),
        MedicalFact(
            condition="COVID-19",
            condition_ka="კოვიდ-19",
            category="ინფექციური დაავადებები",
            facts=[
                "SARS-CoV-2 primarily spreads through respiratory droplets and aerosols.",
                "Vaccination remains the most effective prevention strategy.",
                "Long COVID symptoms can persist for months after acute infection.",
                "Paxlovid reduces hospitalization risk in high-risk patients by ~89%.",
                "Immunocompromised patients may benefit from pre-exposure prophylaxis.",
            ],
            facts_ka=[
                "SARS-CoV-2 ძირითადად რესპირატორული წვეთებითა და აეროზოლებით ვრცელდება.",
                "ვაქცინაცია პრევენციის ყველაზე ეფექტური სტრატეგია რჩება.",
                "ხანგრძლივი კოვიდის სიმპტომები მწვავე ინფექციის შემდეგ თვეების განმავლობაში გრძელდება.",
                "პაქსლოვიდი მაღალი რისკის პაციენტებში ჰოსპიტალიზაციის რისკს ~89%-ით ამცირებს.",
                "იმუნოკომპრომეტირებული პაციენტები პრე-ექსპოზიციური პროფილაქტიკისგან სარგებლობენ.",
            ],
            symptoms=["fever", "cough", "fatigue", "loss of taste", "shortness of breath"],
            treatments=["paxlovid", "remdesivir", "dexamethasone", "vaccination"],
            specialists=["ინფექციონისტი", "პულმონოლოგი"],
            keywords=["covid", "კოვიდი", "coronavirus", "კორონავირუსი", "SARS-CoV-2", "pandemic"],
        ),
        MedicalFact(
            condition="hypothyroidism",
            condition_ka="ჰიპოთირეოზი",
            category="ენდოკრინოლოგია",
            facts=[
                "Hashimoto's thyroiditis is the most common cause of hypothyroidism in iodine-sufficient areas.",
                "TSH is the primary screening test for thyroid dysfunction.",
                "Levothyroxine is the standard replacement therapy.",
                "Subclinical hypothyroidism (TSH 4.5-10) may not require treatment in all patients.",
                "Thyroid hormone levels should be checked 6-8 weeks after dose changes.",
            ],
            facts_ka=[
                "ჰაშიმოტოს თირეოიდიტი ჰიპოთირეოზის ყველაზე გავრცელებული მიზეზია.",
                "TSH ფარისებრი ჯირკვლის დისფუნქციის პირველადი სკრინინგ-ტესტია.",
                "ლევოთიროქსინი სტანდარტული ჩანაცვლებითი თერაპიაა.",
                "სუბკლინიკური ჰიპოთირეოზი (TSH 4.5-10) ყველა პაციენტში მკურნალობას არ საჭიროებს.",
                "ჰორმონის დონე დოზის ცვლილებიდან 6-8 კვირაში უნდა შემოწმდეს.",
            ],
            symptoms=["fatigue", "weight gain", "cold intolerance", "constipation", "dry skin"],
            treatments=["levothyroxine", "liothyronine"],
            specialists=["ენდოკრინოლოგი"],
            keywords=["thyroid", "ფარისებრი", "TSH", "თიროქსინი", "ჰიპოთირეოზი", "hashimoto"],
        ),
        MedicalFact(
            condition="gastritis",
            condition_ka="გასტრიტი",
            category="გასტროენტეროლოგია",
            facts=[
                "H. pylori infection is the most common cause of chronic gastritis.",
                "NSAIDs are the second most common cause of gastritis.",
                "Triple therapy (PPI + clarithromycin + amoxicillin) is standard H. pylori treatment.",
                "Endoscopy is recommended for persistent symptoms or alarm features.",
                "Proton pump inhibitors (PPIs) are the mainstay of acid suppression therapy.",
            ],
            facts_ka=[
                "H. pylori ინფექცია ქრონიკული გასტრიტის ყველაზე გავრცელებული მიზეზია.",
                "NSAID-ები გასტრიტის მეორე ყველაზე გავრცელებული მიზეზია.",
                "სამწვერა თერაპია (PPI + კლარითრომიცინი + ამოქსიცილინი) H. pylori-ს სტანდარტული მკურნალობაა.",
                "ენდოსკოპია რეკომენდებულია მუდმივი სიმპტომების ან განგაშის ნიშნების დროს.",
                "პროტონული ტუმბოს ინჰიბიტორები მჟავიანობის დათრგუნვის ძირითადი თერაპიაა.",
            ],
            symptoms=["abdominal pain", "nausea", "vomiting", "bloating", "loss of appetite"],
            treatments=["PPIs", "H2 blockers", "triple therapy", "antacids"],
            specialists=["გასტროენტეროლოგი"],
            keywords=["gastritis", "გასტრიტი", "stomach", "კუჭი", "H. pylori", "acid", "მჟავიანობა"],
        ),
        MedicalFact(
            condition="anemia",
            condition_ka="ანემია",
            category="ჰემატოლოგია",
            facts=[
                "Iron deficiency is the most common cause of anemia worldwide.",
                "Hemoglobin <12 g/dL in women and <13 g/dL in men defines anemia (WHO).",
                "Ferritin is the most sensitive test for iron deficiency.",
                "Vitamin B12 deficiency can cause megaloblastic anemia and neurological symptoms.",
                "Iron supplementation should be taken on empty stomach with vitamin C for better absorption.",
            ],
            facts_ka=[
                "რკინის დეფიციტი ანემიის ყველაზე გავრცელებული მიზეზია მსოფლიოში.",
                "ჰემოგლობინი <12 გ/დლ ქალებში და <13 გ/დლ მამაკაცებში ანემიას განსაზღვრავს.",
                "ფერიტინი რკინის დეფიციტის ყველაზე მგრძნობიარე ტესტია.",
                "B12 ვიტამინის დეფიციტმა შეიძლება მეგალობლასტური ანემია და ნევროლოგიური სიმპტომები გამოიწვიოს.",
                "რკინის დანამატი უწამლოდ, ვიტამინ C-სთან ერთად უნდა მიიღოთ უკეთესი შეწოვისთვის.",
            ],
            symptoms=["fatigue", "pale skin", "weakness", "dizziness", "shortness of breath"],
            treatments=["iron supplements", "B12 injections", "folic acid", "erythropoietin"],
            specialists=["ჰემატოლოგი", "თერაპევტი"],
            keywords=["anemia", "ანემია", "iron", "რკინა", "hemoglobin", "ჰემოგლობინი", "B12", "ferritin"],
        ),
    ]

    _KNOWLEDGE_BASE.extend(facts)
    logger.info("Medical RAG knowledge base loaded: %d conditions", len(_KNOWLEDGE_BASE))
    return len(_KNOWLEDGE_BASE)


# ═══════════════ RETRIEVAL ═══════════════

def retrieve_relevant(query: str, top_k: int = 5) -> list[MedicalFact]:
    """Retrieve the most relevant facts for a query using keyword matching.

    Args:
        query: Medical query (English or Georgian).
        top_k: Maximum number of facts to return.

    Returns:
        List of MedicalFact objects sorted by relevance score.
    """
    if not _KNOWLEDGE_BASE:
        build_knowledge_base()

    query_lower = query.lower()
    query_tokens = set(re.split(r'\s+', query_lower))

    scored: list[tuple[float, MedicalFact]] = []

    for fact in _KNOWLEDGE_BASE:
        score = 0.0

        # Exact condition match (highest weight)
        if fact.condition.lower() in query_lower or fact.condition_ka in query_lower:
            score += 10.0

        # Keyword overlap
        common = query_tokens & fact.keywords
        if common:
            score += len(common) * 2.0

        # Partial keyword match (substring)
        for kw in fact.keywords:
            if len(kw) > 3 and kw in query_lower:
                score += 1.5

        # Symptom match
        for symptom in fact.symptoms:
            if symptom.lower() in query_lower:
                score += 1.0

        if score > 0:
            scored.append((score, fact))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)
    return [fact for _, fact in scored[:top_k]]


def augment_prompt(query: str, context_facts: list[MedicalFact] | None = None) -> str:
    """Build an enriched prompt by injecting relevant medical facts.

    Args:
        query: User's medical query.
        context_facts: Pre-retrieved facts. If None, retrieves automatically.

    Returns:
        Enriched prompt string with context.
    """
    if context_facts is None:
        context_facts = retrieve_relevant(query, top_k=5)

    if not context_facts:
        return query

    context_parts = []
    for fact in context_facts:
        facts_str = "\n".join(f"  • {f}" for f in fact.facts_ka[:3])
        specialists_str = ", ".join(fact.specialists) if fact.specialists else ""
        treatments_str = ", ".join(fact.treatments[:4]) if fact.treatments else ""

        part = f"📋 {fact.condition_ka} ({fact.category}):\n{facts_str}"
        if specialists_str:
            part += f"\n  სპეციალისტები: {specialists_str}"
        if treatments_str:
            part += f"\n  მკურნალობა: {treatments_str}"
        context_parts.append(part)

    context = "\n\n".join(context_parts)
    return (
        f"სამედიცინო კონტექსტი (სანდო წყაროებიდან):\n{context}\n\n"
        f"მომხმარებლის მოთხოვნა: {query}"
    )
