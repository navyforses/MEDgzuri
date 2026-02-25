"""Shared test fixtures and configuration."""

import os
import pytest

# Ensure we're in demo mode during tests (no real API keys)
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("NCBI_API_KEY", "")


@pytest.fixture
def sample_ct_study():
    """Sample ClinicalTrials.gov API v2 study response."""
    return {
        "protocolSection": {
            "identificationModule": {
                "nctId": "NCT12345678",
                "briefTitle": "Study of Drug X in Lung Cancer",
                "officialTitle": "A Phase III Study of Drug X vs Placebo in NSCLC",
            },
            "statusModule": {
                "overallStatus": "RECRUITING",
                "startDateStruct": {"date": "2024-01-15"},
                "completionDateStruct": {"date": "2026-06-30"},
            },
            "designModule": {
                "phases": ["PHASE3"],
                "enrollmentInfo": {"count": 500},
                "studyType": "INTERVENTIONAL",
            },
            "conditionsModule": {
                "conditions": ["Non-Small Cell Lung Cancer", "NSCLC"],
            },
            "eligibilityModule": {
                "minimumAge": "18 Years",
                "maximumAge": "75 Years",
                "sex": "ALL",
                "eligibilityCriteria": "Key inclusion: histologically confirmed NSCLC",
            },
            "contactsLocationsModule": {
                "locations": [
                    {
                        "facility": "Charité University Hospital",
                        "city": "Berlin",
                        "country": "Germany",
                        "contacts": [
                            {"name": "Dr. Schmidt", "email": "schmidt@charite.de"}
                        ],
                    },
                    {
                        "facility": "Memorial Hospital Istanbul",
                        "city": "Istanbul",
                        "country": "Türkiye",
                        "contacts": [
                            {"name": "Dr. Yilmaz", "email": "yilmaz@memorial.com.tr"}
                        ],
                    },
                ],
            },
            "sponsorCollaboratorsModule": {
                "leadSponsor": {"name": "Pharma Corp"},
            },
            "armsInterventionsModule": {
                "interventions": [
                    {"type": "DRUG", "name": "Drug X"},
                    {"type": "DRUG", "name": "Placebo"},
                ],
            },
        },
    }


@pytest.fixture
def sample_pubmed_xml():
    """Sample PubMed efetch XML response."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38123456</PMID>
      <Article>
        <Journal>
          <Title>Journal of Clinical Oncology</Title>
          <JournalIssue>
            <PubDate><Year>2024</Year></PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Immunotherapy advances in NSCLC: a systematic review</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">Non-small cell lung cancer treatment has evolved.</AbstractText>
          <AbstractText Label="METHODS">We performed a systematic review of 50 trials.</AbstractText>
          <AbstractText Label="RESULTS">Immunotherapy improved OS by 30%.</AbstractText>
          <AbstractText Label="CONCLUSION">Immunotherapy is effective in NSCLC.</AbstractText>
        </Abstract>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.1234/jco.2024.001</ArticleId>
        <ArticleId IdType="pubmed">38123456</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
  <PubmedArticle>
    <MedlineCitation>
      <PMID>38654321</PMID>
      <Article>
        <Journal>
          <Title>The Lancet</Title>
          <JournalIssue>
            <PubDate><Year>2025</Year></PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Novel targeted therapies for lung adenocarcinoma</ArticleTitle>
        <Abstract>
          <AbstractText>Targeted therapy has shown promising results in lung adenocarcinoma.</AbstractText>
        </Abstract>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.5678/lancet.2025.002</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>"""


@pytest.fixture
def sample_europe_pmc_response():
    """Sample Europe PMC REST API response."""
    return {
        "resultList": {
            "result": [
                {
                    "pmid": "38999999",
                    "title": "PD-L1 expression in advanced NSCLC",
                    "abstractText": "PD-L1 biomarker analysis for immunotherapy.",
                    "journalTitle": "European Respiratory Journal",
                    "pubYear": "2024",
                    "doi": "10.9999/erj.2024.003",
                    "isOpenAccess": "Y",
                },
            ],
        },
    }
