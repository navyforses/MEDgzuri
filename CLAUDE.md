# CLAUDE.md — MED&გზური (MedGzuri)

## Project Overview

MED&გზური is a Georgian-language medical research navigation service. It helps patients in Georgia find relevant medical research, understand symptoms, and locate appropriate clinics worldwide. The application is a static site with serverless API endpoints deployed on Vercel.

**Core functionality:**

- **Research Guide** — searches medical literature (PubMed, ClinicalTrials.gov) for a given diagnosis, returns structured results in Georgian
- **Symptom Navigator** — recommends medical tests and specialists based on described symptoms (does NOT diagnose)
- **Clinic Search** — finds hospitals/clinics globally with pricing estimates and treatment details

## Architecture

```
MEDgzuri/
├── index.html        # Landing/marketing page (horizontal scroll design)
├── product.html      # Main search interface with 3 tabs (research/symptoms/clinics)
├── login.html        # Authentication UI (frontend only, no backend)
├── admin.html        # Admin dashboard UI (frontend only, no backend)
├── crm.html          # CRM system UI (frontend only, no backend)
├── chatbot.js        # Rule-based customer support chatbot (Georgian)
├── api/
│   └── search.js     # Serverless API: orchestrates Perplexity + Claude pipeline
└── vercel.json       # Vercel deployment and routing configuration
```

**Stack:** Vanilla HTML/CSS/JS frontend, Node.js serverless functions on Vercel. No frameworks, no build tools, no package.json.

### API Pipeline (api/search.js)

1. Frontend POSTs to `/api/search` with `{ type, data }`
2. Perplexity API performs web search for medical information
3. Anthropic Claude structures, analyzes, and translates results into Georgian
4. Returns JSON with `meta`, `items[]`, and optional `summary`

Search types: `research`, `symptoms`, `clinics`

**Demo mode:** When API keys are not configured, the system returns mock data so the UI remains functional.

## Environment Variables

```
PERPLEXITY_API_KEY    # Perplexity AI — web search for medical data
ANTHROPIC_API_KEY     # Anthropic Claude — analysis and Georgian translation
OPENAI_API_KEY        # OpenAI (planned Phase 2 — fact-checking/verification)
```

No `.env` file in repo. Set these in the Vercel dashboard for production.

## Development

### Running Locally

There is no build step. Open HTML files directly in a browser for frontend work. For the API, use `vercel dev` (requires the Vercel CLI and environment variables set).

### Deployment

Push to the main branch — Vercel auto-deploys. Routes are defined in `vercel.json`:

| Route | Destination |
|-------|-------------|
| `/api/*` | Serverless functions |
| `/product` | `product.html` |
| `/login` | `login.html` |
| `/admin` | `admin.html` |
| `/crm` | `crm.html` |
| `/*` | Static files |

### Testing

No automated testing framework. Test manually in the browser. The demo mode (no API keys) provides mock results for frontend testing without external dependencies.

## Code Conventions

### Language

- **UI text:** Georgian throughout
- **Code comments:** Mixed Georgian/English
- **Variable/function names:** English

### Naming

- **JavaScript functions/variables:** camelCase (`startSearch`, `displayResults`, `collectFormData`)
- **CSS classes:** BEM-inspired kebab-case (`.result-card`, `.form-group`, `.section-header`)
- **HTML IDs:** kebab-case (`research-diagnosis`, `chatbot-widget`)
- **CSS custom properties:** kebab-case with semantic prefixes (`--color-primary`, `--color-text-secondary`)

### Code Style

- Inline `<style>` and `<script>` blocks within HTML files (no external CSS/JS bundles except `chatbot.js`)
- Section separators in JS: `// ═══════════════ SECTION ═══════════════`
- 4-space indentation in HTML, mixed 2-4 in CSS/JS
- No linter or formatter configured

### File Organization

- Flat structure: all HTML pages at project root for direct Vercel routing
- Single `api/` directory for serverless functions
- No component directories, state management libraries, or module bundlers

## Key Patterns

### Frontend State

- Simple global flags (`isSearching`, `currentTab`)
- Direct DOM manipulation — no virtual DOM or reactive framework
- Tab switching via radio-button style selection in `product.html`

### API Communication

```javascript
const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data })
});
```

### API Response Format

```json
{
  "meta": "Summary string",
  "items": [
    {
      "title": "Result title",
      "source": "Source/location",
      "body": "Detailed description",
      "tags": ["tag1", "tag2"],
      "url": "https://source-link.com"
    }
  ],
  "summary": "Optional text summary (fallback)"
}
```

### Error Handling & Fallbacks

- API gracefully degrades: if Claude fails, returns raw Perplexity results; if both fail, returns demo data
- Frontend uses `escapeHtml()` for XSS prevention on rendered results
- Medical disclaimer prominently displayed — the service explicitly does not replace medical professionals

### Chatbot (chatbot.js)

Rule-based keyword matching across 12+ knowledge base categories. All responses in Georgian. Auto-initializes on page load with a welcome message after 2 seconds.

## Important Notes for AI Assistants

- **Georgian language:** All user-facing text must be in Georgian (UTF-8). The font used is Noto Sans Georgian.
- **Medical safety:** Never generate content that could be interpreted as medical diagnosis. The system recommends tests and specialists only.
- **No package.json:** This project has no npm dependencies tracked. The API uses only Node.js built-ins and `fetch`.
- **Admin/CRM/Login pages are UI-only:** They have no backend functionality. Do not assume backend CRUD operations exist.
- **Claude model in use:** `claude-sonnet-4-5-20250514` in `api/search.js:247`
- **CORS:** API sets `Access-Control-Allow-Origin: *`
- **Currency:** Georgian Lari (₾)
