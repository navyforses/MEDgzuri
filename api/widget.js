/**
 * MedGzuri Embeddable Widget API
 *
 * ჩასაშენებელი ვიჯეტი გარე ვებსაიტებისთვის.
 * აბრუნებს HTML/JS კოდს, რომელიც ქმნის მცურავ ძიების ღილაკს და მოდალს.
 *
 * გამოყენება:
 *   <script src="https://medgzuri.com/api/widget?theme=light&lang=ka"></script>
 *
 * პარამეტრები:
 *   - theme: light | dark (default: light)
 *   - lang:  ka | en (default: ka)
 *   - types: comma-separated search types (default: research,symptoms,clinics)
 */

const { setSecurityHeaders, getClientIp, createRateLimiter } = require('../lib/security');

const widgetRateLimiter = createRateLimiter(30, 60 * 1000); // 30 req/min (static asset)

module.exports = async function handler(req, res) {
    // Widget-specific security headers (allow embedding)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // CSP allows inline styles/scripts for the widget, and connects to medgzuri.com
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://medgzuri.com https://www.medgzuri.com; font-src https://fonts.gstatic.com; img-src data:;"
    );

    // CORS — widget can be loaded from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting
    const clientIp = getClientIp(req);
    if (widgetRateLimiter(clientIp)) {
        return res.status(429).send('// Too many requests');
    }

    // Parse query params
    const theme = req.query.theme === 'dark' ? 'dark' : 'light';
    const lang = req.query.lang === 'en' ? 'en' : 'ka';
    const typesParam = req.query.types || 'research,symptoms,clinics';
    const types = typesParam.split(',').filter(t => ['research', 'symptoms', 'clinics'].includes(t.trim()));
    if (types.length === 0) types.push('research');

    // Translations
    const i18n = {
        ka: {
            title: 'MED&გზური',
            placeholder: 'შეიყვანეთ საძიებო ტერმინი...',
            search: 'ძიება',
            close: 'დახურვა',
            loading: 'მიმდინარეობს ძიება...',
            error: 'შეცდომა. გთხოვთ სცადოთ მოგვიანებით.',
            noResults: 'შედეგები ვერ მოიძებნა.',
            research: 'კვლევა',
            symptoms: 'სიმპტომები',
            clinics: 'კლინიკები',
            disclaimer: 'ეს ინფორმაცია არ არის სამედიცინო რჩევა.',
            poweredBy: 'MED&გზური'
        },
        en: {
            title: 'MED&Gzuri',
            placeholder: 'Enter search term...',
            search: 'Search',
            close: 'Close',
            loading: 'Searching...',
            error: 'Error. Please try again later.',
            noResults: 'No results found.',
            research: 'Research',
            symptoms: 'Symptoms',
            clinics: 'Clinics',
            disclaimer: 'This is not medical advice.',
            poweredBy: 'MED&Gzuri'
        }
    };

    const t = i18n[lang];
    const typesJson = JSON.stringify(types);

    // Theme colors
    const colors = theme === 'dark' ? {
        bg: '#1a1a2e',
        surface: '#16213e',
        text: '#e0e0e0',
        textSecondary: '#a0a0a0',
        primary: '#4ecca3',
        primaryHover: '#45b892',
        border: '#2a2a4a',
        shadow: 'rgba(0,0,0,0.5)',
        cardBg: '#1e2a45',
        btnBg: '#4ecca3',
        btnText: '#1a1a2e'
    } : {
        bg: '#ffffff',
        surface: '#f8f9fa',
        text: '#1a1a2e',
        textSecondary: '#666666',
        primary: '#2d6a4f',
        primaryHover: '#245a42',
        border: '#e0e0e0',
        shadow: 'rgba(0,0,0,0.15)',
        cardBg: '#f0f4f1',
        btnBg: '#2d6a4f',
        btnText: '#ffffff'
    };

    const html = `(function(){
if(document.getElementById('medgzuri-widget-root'))return;

var types=${typesJson};
var t=${JSON.stringify(t)};

var style=document.createElement('style');
style.textContent=\`
  #medgzuri-widget-btn{
    position:fixed;bottom:24px;right:24px;z-index:999998;
    width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;
    background:${colors.btnBg};color:${colors.btnText};
    font-size:20px;font-weight:700;
    box-shadow:0 4px 16px ${colors.shadow};
    transition:transform 0.2s;display:flex;align-items:center;justify-content:center;
  }
  #medgzuri-widget-btn:hover{transform:scale(1.1);}
  #medgzuri-widget-modal{
    display:none;position:fixed;bottom:90px;right:24px;z-index:999999;
    width:400px;max-width:calc(100vw - 48px);max-height:70vh;
    background:${colors.bg};border:1px solid ${colors.border};
    border-radius:12px;box-shadow:0 8px 32px ${colors.shadow};
    font-family:'Noto Sans Georgian',sans-serif;overflow:hidden;
    flex-direction:column;
  }
  #medgzuri-widget-modal.mgz-open{display:flex;}
  .mgz-header{
    display:flex;align-items:center;justify-content:space-between;
    padding:14px 16px;border-bottom:1px solid ${colors.border};
    background:${colors.surface};
  }
  .mgz-header h3{margin:0;font-size:16px;color:${colors.text};}
  .mgz-close{background:none;border:none;font-size:20px;cursor:pointer;color:${colors.textSecondary};padding:0 4px;}
  .mgz-body{padding:12px 16px;overflow-y:auto;flex:1;}
  .mgz-types{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
  .mgz-type-btn{
    padding:5px 12px;border-radius:16px;border:1px solid ${colors.border};
    background:${colors.surface};color:${colors.textSecondary};cursor:pointer;
    font-size:13px;transition:all 0.15s;font-family:inherit;
  }
  .mgz-type-btn.active{background:${colors.primary};color:${colors.btnText};border-color:${colors.primary};}
  .mgz-search-row{display:flex;gap:8px;margin-bottom:12px;}
  .mgz-input{
    flex:1;padding:8px 12px;border:1px solid ${colors.border};border-radius:8px;
    font-size:14px;background:${colors.surface};color:${colors.text};
    font-family:inherit;outline:none;
  }
  .mgz-input:focus{border-color:${colors.primary};}
  .mgz-search-btn{
    padding:8px 16px;border:none;border-radius:8px;cursor:pointer;
    background:${colors.btnBg};color:${colors.btnText};font-weight:600;
    font-size:14px;font-family:inherit;white-space:nowrap;
  }
  .mgz-search-btn:disabled{opacity:0.6;cursor:not-allowed;}
  .mgz-results{color:${colors.text};}
  .mgz-loading{text-align:center;padding:20px;color:${colors.textSecondary};font-size:14px;}
  .mgz-card{
    padding:10px 12px;margin-bottom:8px;border-radius:8px;
    background:${colors.cardBg};border:1px solid ${colors.border};
  }
  .mgz-card h4{margin:0 0 4px;font-size:14px;color:${colors.text};}
  .mgz-card p{margin:0;font-size:12px;color:${colors.textSecondary};line-height:1.4;}
  .mgz-card a{color:${colors.primary};text-decoration:none;font-size:12px;}
  .mgz-card .mgz-tags{margin-top:4px;}
  .mgz-card .mgz-tag{
    display:inline-block;padding:2px 6px;margin:2px 2px 0 0;border-radius:4px;
    background:${colors.surface};font-size:11px;color:${colors.textSecondary};
  }
  .mgz-disclaimer{
    padding:8px 16px;font-size:11px;color:${colors.textSecondary};
    border-top:1px solid ${colors.border};text-align:center;
    background:${colors.surface};
  }
  .mgz-error{color:#d9534f;text-align:center;padding:12px;font-size:13px;}
  @media(max-width:480px){
    #medgzuri-widget-modal{width:calc(100vw - 24px);right:12px;bottom:84px;max-height:75vh;}
    #medgzuri-widget-btn{bottom:16px;right:16px;width:48px;height:48px;font-size:16px;}
  }
\`;
document.head.appendChild(style);

// Font
if(!document.querySelector('link[href*="Noto+Sans+Georgian"]')){
  var link=document.createElement('link');
  link.rel='stylesheet';
  link.href='https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;600;700&display=swap';
  document.head.appendChild(link);
}

var root=document.createElement('div');
root.id='medgzuri-widget-root';

var typeButtons=types.map(function(tp){
  return '<button class="mgz-type-btn'+(tp===types[0]?' active':'')+'" data-type="'+tp+'">'+t[tp]+'</button>';
}).join('');

root.innerHTML=
  '<button id="medgzuri-widget-btn" aria-label="'+t.title+'">მგ</button>'+
  '<div id="medgzuri-widget-modal">'+
    '<div class="mgz-header"><h3>'+t.title+'</h3><button class="mgz-close" aria-label="'+t.close+'">&times;</button></div>'+
    '<div class="mgz-body">'+
      '<div class="mgz-types">'+typeButtons+'</div>'+
      '<div class="mgz-search-row">'+
        '<input class="mgz-input" placeholder="'+t.placeholder+'" />'+
        '<button class="mgz-search-btn">'+t.search+'</button>'+
      '</div>'+
      '<div class="mgz-results"></div>'+
    '</div>'+
    '<div class="mgz-disclaimer">'+t.disclaimer+' &mdash; '+t.poweredBy+'</div>'+
  '</div>';

document.body.appendChild(root);

var btn=document.getElementById('medgzuri-widget-btn');
var modal=document.getElementById('medgzuri-widget-modal');
var closeBtn=modal.querySelector('.mgz-close');
var input=modal.querySelector('.mgz-input');
var searchBtn=modal.querySelector('.mgz-search-btn');
var resultsDiv=modal.querySelector('.mgz-results');
var typeBtns=modal.querySelectorAll('.mgz-type-btn');
var currentType=types[0];

btn.addEventListener('click',function(){
  modal.classList.toggle('mgz-open');
  if(modal.classList.contains('mgz-open'))input.focus();
});
closeBtn.addEventListener('click',function(){modal.classList.remove('mgz-open');});

typeBtns.forEach(function(b){
  b.addEventListener('click',function(){
    typeBtns.forEach(function(x){x.classList.remove('active');});
    b.classList.add('active');
    currentType=b.getAttribute('data-type');
  });
});

input.addEventListener('keydown',function(e){
  if(e.key==='Enter')doSearch();
});
searchBtn.addEventListener('click',doSearch);

function doSearch(){
  var q=input.value.trim();
  if(!q)return;
  searchBtn.disabled=true;
  resultsDiv.innerHTML='<div class="mgz-loading">'+t.loading+'</div>';

  var payload={type:currentType,data:{}};
  if(currentType==='research')payload.data.diagnosis=q;
  else if(currentType==='symptoms')payload.data.symptoms=q;
  else if(currentType==='clinics')payload.data.condition=q;

  var apiBase=document.currentScript?document.currentScript.src.replace(/\\/api\\/widget.*$/,''):'https://medgzuri.com';
  fetch(apiBase+'/api/search',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  })
  .then(function(r){return r.json();})
  .then(function(data){
    searchBtn.disabled=false;
    if(data.items&&data.items.length>0){
      var html=data.items.map(function(item){
        var tags='';
        if(item.tags&&item.tags.length){
          tags='<div class="mgz-tags">'+item.tags.map(function(tg){return '<span class="mgz-tag">'+escHtml(tg)+'</span>';}).join('')+'</div>';
        }
        var link=item.url?'<a href="'+escHtml(item.url)+'" target="_blank" rel="noopener">&#8599;</a>':'';
        return '<div class="mgz-card"><h4>'+escHtml(item.title)+' '+link+'</h4>'+(item.source?'<p><strong>'+escHtml(item.source)+'</strong></p>':'')+'<p>'+escHtml((item.body||'').substring(0,200))+'</p>'+tags+'</div>';
      }).join('');
      resultsDiv.innerHTML=html;
    } else if(data.summary){
      resultsDiv.innerHTML='<div class="mgz-card"><p>'+escHtml(data.summary)+'</p></div>';
    } else {
      resultsDiv.innerHTML='<div class="mgz-loading">'+t.noResults+'</div>';
    }
  })
  .catch(function(){
    searchBtn.disabled=false;
    resultsDiv.innerHTML='<div class="mgz-error">'+t.error+'</div>';
  });
}

function escHtml(s){
  if(!s)return '';
  var d=document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

})();`;

    // Cache for 5 minutes (static-ish content)
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.status(200).send(html);
};
