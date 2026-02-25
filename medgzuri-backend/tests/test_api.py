"""End-to-end API tests — tests the FastAPI app with demo mode."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["demo_mode"] is True
        assert data["has_anthropic"] is False


class TestSearchEndpoint:
    @pytest.mark.asyncio
    async def test_research_old_format(self, client):
        """Test research search with old frontend format."""
        resp = await client.post("/api/search", json={
            "type": "research",
            "data": {"diagnosis": "ფილტვის კიბო"},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["isDemo"] is True
        assert len(data["items"]) > 0
        assert "disclaimer" in data

    @pytest.mark.asyncio
    async def test_symptoms_old_format(self, client):
        resp = await client.post("/api/search", json={
            "type": "symptoms",
            "data": {"symptoms": "თავის ტკივილი"},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["isDemo"] is True

    @pytest.mark.asyncio
    async def test_clinics_old_format(self, client):
        resp = await client.post("/api/search", json={
            "type": "clinics",
            "data": {"diagnosis": "brain tumor"},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["isDemo"] is True
        assert len(data["items"]) > 0

    @pytest.mark.asyncio
    async def test_research_new_format(self, client):
        """Test research search with new format."""
        resp = await client.post("/api/search", json={
            "source_tab": "research_search",
            "data": {"diagnosis": "lung cancer"},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["isDemo"] is True

    @pytest.mark.asyncio
    async def test_pipeline_metadata(self, client):
        """Response includes pipeline metadata."""
        resp = await client.post("/api/search", json={
            "type": "research",
            "data": {"diagnosis": "test"},
        })
        data = resp.json()
        assert "_pipeline" in data
        assert "ms" in data["_pipeline"]
        assert data["_pipeline"]["source"] == "agent-orchestra"

    @pytest.mark.asyncio
    async def test_invalid_json(self, client):
        resp = await client.post(
            "/api/search",
            content=b"not json",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_type(self, client):
        """Empty type returns error in Georgian."""
        resp = await client.post("/api/search", json={})
        assert resp.status_code == 200
        data = resp.json()
        # Should get an error-like response since type is empty
        assert "არასწორი" in data.get("meta", "")
