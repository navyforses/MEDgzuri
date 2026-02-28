"""Demo/mock data returned when no API keys are configured."""

from app.orchestrator.schemas import ReportSection, ResultItem, SearchResponse, TipItem


def get_demo_data(pipeline_type: str, data: dict) -> SearchResponse:
    """Return pipeline-specific mock data."""
    if pipeline_type == "research_search":
        return _demo_research()
    elif pipeline_type == "symptom_navigation":
        return _demo_symptoms()
    elif pipeline_type == "clinic_search":
        return _demo_clinics()
    elif pipeline_type == "report_generation":
        return _demo_report(data)
    return SearchResponse(meta="სადემონსტრაციო რეჟიმი", isDemo=True)


def _demo_research() -> SearchResponse:
    return SearchResponse(
        meta="ნაპოვნია 3 კვლევა (სადემონსტრაციო რეჟიმი)",
        isDemo=True,
        items=[
            ResultItem(
                title="უახლესი კვლევები",
                source="PubMed / ClinicalTrials.gov",
                body="ეს არის სადემონსტრაციო შედეგი. რეალური ძიებისთვის საჭიროა API კონფიგურაცია.\n\n"
                     "PubMed-ის მონაცემთა ბაზა მოიცავს 38 მილიონზე მეტ სამედიცინო კვლევას.",
                tags=["კვლევა", "PubMed"],
                url="https://pubmed.ncbi.nlm.nih.gov/",
            ),
            ResultItem(
                title="კლინიკური კვლევები",
                source="ClinicalTrials.gov",
                body="აქტიური კლინიკური კვლევების ძიება ხელმისაწვდომია.\n\n"
                     "რეგისტრაცია კლინიკურ კვლევაში შეიძლება იყოს ალტერნატიული გზა მკურნალობისთვის.",
                tags=["კლინიკური კვლევა", "მკურნალობა"],
                url="https://clinicaltrials.gov/",
            ),
            ResultItem(
                title="მკურნალობის მიმოხილვა",
                source="სამედიცინო ლიტერატურა",
                body="სტანდარტული და ინოვაციური მკურნალობის მეთოდების მიმოხილვა.\n\n"
                     "რეკომენდირებულია ყველა ინფორმაციის განხილვა თქვენს ექიმთან.",
                tags=["მკურნალობა", "მიმოხილვა"],
            ),
        ],
        disclaimer="⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
    )


def _demo_symptoms() -> SearchResponse:
    return SearchResponse(
        meta="სიმპტომების ანალიზი (სადემონსტრაციო რეჟიმი)",
        isDemo=True,
        items=[
            ResultItem(
                title="რეკომენდებული გამოკვლევები",
                body="ეს არის სადემონსტრაციო შედეგი.\n\n"
                     "- სრული სისხლის ანალიზი\n- ბიოქიმიური ანალიზი\n"
                     "- სპეციფიკური მარკერები",
                tags=["გამოკვლევა", "ლაბორატორია"],
            ),
            ResultItem(
                title="სპეციალისტთან კონსულტაცია",
                body="თქვენი ოჯახის ექიმი განსაზღვრავს ოპტიმალურ მიმართულებას.",
                tags=["სპეციალისტი", "კონსულტაცია"],
            ),
        ],
        disclaimer="⚕️ ეს არ არის დიაგნოზი. მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
    )


def _demo_clinics() -> SearchResponse:
    return SearchResponse(
        meta="ნაპოვნია 3 კლინიკა (სადემონსტრაციო რეჟიმი)",
        isDemo=True,
        items=[
            ResultItem(
                title="Charité University Hospital",
                source="გერმანია, ბერლინი",
                body="ევროპის ერთ-ერთი წამყვანი უნივერსიტეტის საავადმყოფო.\n\n"
                     "სავარაუდო ფასი: ინდივიდუალური შეფასება\nენა: ინგლისური, გერმანული",
                tags=["გერმანია", "უნივერსიტეტის კლინიკა"],
                url="https://www.charite.de/en/",
            ),
            ResultItem(
                title="Memorial Healthcare Group",
                source="თურქეთი, ისტანბული",
                body="თურქეთის წამყვანი კერძო ჰოსპიტალური ქსელი.\n\n"
                     "სავარაუდო ფასი: გერმანიაზე 40-60% ნაკლები\nენა: ინგლისური, თურქული, რუსული",
                tags=["თურქეთი", "აკრედიტებული"],
                url="https://www.memorial.com.tr/en/",
            ),
            ResultItem(
                title="Sheba Medical Center",
                source="ისრაელი, რამატ განი",
                body="ისრაელის უმსხვილესი სამედიცინო ცენტრი.\n\n"
                     "სავარაუდო ფასი: პრემიუმ სეგმენტი\nენა: ინგლისური, ებრაული",
                tags=["ისრაელი", "მსოფლიო წამყვანი"],
                url="https://www.shebaonline.org/",
            ),
        ],
        disclaimer="⚕️ ფასები საინფორმაციო ხასიათისაა. მედგზური არ ანაცვლებს ექიმის კონსულტაციას.",
    )


def _demo_report(data: dict) -> SearchResponse:
    search_result = data.get("searchResult", data.get("search_result", {}))
    query = search_result.get("meta", "სამედიცინო მოთხოვნა") if search_result else "სამედიცინო მოთხოვნა"
    return SearchResponse(
        title=f"სამედიცინო ანგარიში — {query}",
        isDemo=True,
        sections=[
            ReportSection(
                heading="შესავალი",
                content="წინამდებარე ანგარიში წარმოადგენს სადემონსტრაციო დოკუმენტს. "
                        "რეალური ანგარიშის გენერაციისთვის საჭიროა სისტემის სრული კონფიგურაცია.",
            ),
            ReportSection(
                heading="მიმოხილვა",
                content="ძიების შედეგების ანალიზის საფუძველზე გამოვლინდა რამდენიმე მნიშვნელოვანი მიგნება. "
                        "აღნიშნული მიგნებები ეფუძნება თანამედროვე სამედიცინო კვლევებსა და კლინიკურ პრაქტიკას.",
            ),
            ReportSection(
                heading="რეკომენდაციები",
                content="რეკომენდირებულია კონსულტაცია შესაბამის სამედიცინო სპეციალისტთან. "
                        "დამატებითი გამოკვლევების ჩატარება დაგეხმარებათ უფრო ზუსტი სურათის შექმნაში.",
            ),
            ReportSection(
                heading="დასკვნა",
                content="ეს სადემონსტრაციო ანგარიში ასახავს დოკუმენტის სტრუქტურასა და ფორმატს. "
                        "სრული ანგარიში მოიცავს დეტალურ ანალიზს, წყაროების მითითებას და პერსონალიზებულ რეკომენდაციებს.",
            ),
        ],
        disclaimer="ეს ანგარიში არ ჩაანაცვლებს ექიმის კონსულტაციას. "
                   "ყველა სამედიცინო გადაწყვეტილება უნდა მიიღოთ კვალიფიციურ სპეციალისტთან ერთად.",
    )
