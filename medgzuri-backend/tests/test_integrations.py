"""Tests for external API integrations — ClinicalTrials.gov, PubMed, Europe PMC."""

import json

import httpx
import pytest

from app.integrations.clinicaltrials_gov import ClinicalTrialsClient
from app.integrations.europe_pmc import EuropePMCClient
from app.integrations.eu_ctr import EUCTRClient
from app.integrations.pubmed import PubMedClient
from app.integrations.who_ictrp import WHOICTRPClient


# ═══════════════ ClinicalTrials.gov ═══════════════


class TestClinicalTrialsClient:
    """Tests for ClinicalTrials.gov API v2 integration."""

    def test_parse_study(self, sample_ct_study):
        """Test parsing of a ClinicalTrials.gov study response."""
        client = ClinicalTrialsClient()
        parsed = client._parse_study(sample_ct_study)

        assert parsed["nct_id"] == "NCT12345678"
        assert "Drug X" in parsed["title"] or "Lung Cancer" in parsed["title"]
        assert parsed["status"] == "RECRUITING"
        assert "PHASE3" in parsed["phase"]
        assert parsed["sponsor"] == "Pharma Corp"
        assert parsed["enrollment"] == 500
        assert len(parsed["locations"]) == 2
        assert parsed["locations"][0]["country"] == "Germany"
        assert parsed["locations"][0]["facility"] == "Charité University Hospital"
        assert parsed["locations"][1]["country"] == "Türkiye"
        assert len(parsed["interventions"]) == 2
        assert parsed["interventions"][0]["name"] == "Drug X"
        assert "clinicaltrials.gov/study/NCT12345678" in parsed["url"]
        assert parsed["eligibility"]["min_age"] == "18 Years"
        assert parsed["eligibility"]["sex"] == "ALL"
        assert parsed["dates"]["start"] == "2024-01-15"

    def test_build_params_basic(self):
        client = ClinicalTrialsClient()
        params = client._build_params(
            query="lung cancer", age_group="any", geography="worldwide",
            study_type="all", status="recruiting", max_results=20,
        )
        assert params["query.cond"] == "lung cancer"
        assert params["pageSize"] == "20"
        assert "RECRUITING" in params["filter.overallStatus"]
        assert "query.locn" not in params  # worldwide = no filter

    def test_build_params_europe(self):
        client = ClinicalTrialsClient()
        params = client._build_params(
            query="breast cancer", age_group="any", geography="europe",
            study_type="interventional", status="recruiting", max_results=10,
        )
        assert "query.locn" in params
        locn = params["query.locn"]
        assert "Germany" in locn
        assert "France" in locn
        assert "Spain" in locn
        assert params["filter.studyType"] == "INTERVENTIONAL"

    def test_build_params_turkey(self):
        client = ClinicalTrialsClient()
        params = client._build_params(
            query="brain tumor", age_group="any", geography="turkey",
            study_type="all", status="all", max_results=5,
        )
        locn = params.get("query.locn", "")
        assert "Türkiye" in locn
        assert "COMPLETED" in params["filter.overallStatus"]

    def test_build_params_max_results_capped(self):
        client = ClinicalTrialsClient()
        params = client._build_params(
            query="test", age_group="any", geography="worldwide",
            study_type="all", status="recruiting", max_results=100,
        )
        assert params["pageSize"] == "50"  # capped at 50

    @pytest.mark.asyncio
    async def test_search_api_error(self, httpx_mock):
        """Test graceful handling of API errors."""
        httpx_mock.add_response(status_code=500)
        client = ClinicalTrialsClient()
        result = await client.search("lung cancer")
        assert result == []

    @pytest.mark.asyncio
    async def test_search_timeout(self, httpx_mock):
        """Test graceful handling of timeouts."""
        httpx_mock.add_exception(httpx.TimeoutException("timeout"))
        client = ClinicalTrialsClient()
        result = await client.search("lung cancer")
        assert result == []

    @pytest.mark.asyncio
    async def test_search_success(self, httpx_mock, sample_ct_study):
        """Test successful search with mock response."""
        httpx_mock.add_response(json={"studies": [sample_ct_study], "totalCount": 1})
        client = ClinicalTrialsClient()
        result = await client.search("lung cancer")
        assert len(result) == 1
        assert result[0]["nct_id"] == "NCT12345678"


# ═══════════════ PubMed ═══════════════


class TestPubMedClient:
    """Tests for PubMed E-utilities integration."""

    def test_parse_xml(self, sample_pubmed_xml):
        """Test XML parsing of PubMed response."""
        client = PubMedClient()
        articles = client._parse_xml(sample_pubmed_xml)

        assert len(articles) == 2
        a1 = articles[0]
        assert a1["pmid"] == "38123456"
        assert "Immunotherapy" in a1["title"]
        assert a1["journal"] == "Journal of Clinical Oncology"
        assert a1["year"] == 2024
        assert a1["doi"] == "10.1234/jco.2024.001"
        assert "pubmed.ncbi.nlm.nih.gov/38123456" in a1["source_url"]
        # Abstract should have all parts
        assert "BACKGROUND" in a1["abstract"]
        assert "RESULTS" in a1["abstract"]

        a2 = articles[1]
        assert a2["pmid"] == "38654321"
        assert a2["year"] == 2025
        assert "adenocarcinoma" in a2["title"].lower()

    def test_parse_xml_invalid(self):
        """Test handling of invalid XML."""
        client = PubMedClient()
        articles = client._parse_xml("<invalid>xml</broken>")
        assert articles == []

    def test_parse_xml_empty(self):
        """Test handling of empty article set."""
        client = PubMedClient()
        articles = client._parse_xml(
            '<?xml version="1.0"?><PubmedArticleSet></PubmedArticleSet>'
        )
        assert articles == []

    @pytest.mark.asyncio
    async def test_esearch_success(self, httpx_mock):
        """Test successful esearch."""
        httpx_mock.add_response(json={
            "esearchresult": {
                "count": "2",
                "idlist": ["38123456", "38654321"],
            },
        })
        client = PubMedClient()
        pmids = await client._esearch("lung cancer", max_results=10, years_back=3, pub_types=None)
        assert pmids == ["38123456", "38654321"]

    @pytest.mark.asyncio
    async def test_efetch_success(self, httpx_mock, sample_pubmed_xml):
        """Test successful efetch."""
        httpx_mock.add_response(text=sample_pubmed_xml)
        client = PubMedClient()
        articles = await client._efetch(["38123456", "38654321"])
        assert len(articles) == 2

    @pytest.mark.asyncio
    async def test_search_full_flow(self, httpx_mock, sample_pubmed_xml):
        """Test full search flow: esearch → efetch."""
        # First response: esearch returns PMIDs
        httpx_mock.add_response(json={
            "esearchresult": {"count": "1", "idlist": ["38123456"]},
        })
        # Second response: efetch returns XML
        httpx_mock.add_response(text=sample_pubmed_xml)
        client = PubMedClient()
        result = await client.search("lung cancer")
        assert len(result) == 2  # XML has 2 articles

    @pytest.mark.asyncio
    async def test_search_no_results(self, httpx_mock):
        """Test search with no results."""
        httpx_mock.add_response(
            json={"esearchresult": {"count": "0", "idlist": []}},
        )
        client = PubMedClient()
        result = await client.search("nonexistent-condition-xyz")
        assert result == []


# ═══════════════ Europe PMC ═══════════════


class TestEuropePMCClient:
    """Tests for Europe PMC REST API integration."""

    @pytest.mark.asyncio
    async def test_search_success(self, httpx_mock, sample_europe_pmc_response):
        httpx_mock.add_response(json=sample_europe_pmc_response)
        client = EuropePMCClient()
        result = await client.search("NSCLC immunotherapy")
        assert len(result) == 1
        assert result[0]["pmid"] == "38999999"
        assert result[0]["is_open_access"] is True
        assert "europepmc.org" in result[0]["source_url"]

    @pytest.mark.asyncio
    async def test_search_timeout(self, httpx_mock):
        httpx_mock.add_exception(httpx.TimeoutException("timeout"))
        client = EuropePMCClient()
        result = await client.search("test")
        assert result == []


# ═══════════════ EU CTR ═══════════════


class TestEUCTRClient:
    @pytest.mark.asyncio
    async def test_search_unavailable(self, httpx_mock):
        """EU CTR returns empty list on error (best-effort)."""
        httpx_mock.add_response(status_code=503)
        client = EUCTRClient()
        result = await client.search("lung cancer")
        assert result == []

    @pytest.mark.asyncio
    async def test_search_success(self, httpx_mock):
        httpx_mock.add_response(json={
            "data": [
                {"ctNumber": "EU-CT-2024-001", "ctTitle": "EU Trial", "ctStatus": "Ongoing"},
            ],
        })
        client = EUCTRClient()
        result = await client.search("cancer")
        assert len(result) == 1
        assert result[0]["trial_id"] == "EU-CT-2024-001"
        assert result[0]["source_registry"] == "EU CTR"


# ═══════════════ WHO ICTRP ═══════════════


class TestWHOICTRPClient:
    @pytest.mark.asyncio
    async def test_search_returns_empty(self):
        """WHO ICTRP always returns empty (placeholder)."""
        client = WHOICTRPClient()
        result = await client.search("lung cancer")
        assert result == []
